// 引擎服务：字典场景解释器（游戏主循环）
//
// 事件驱动设计（其他插件可通过 ctx.on 扩展，无需改引擎代码）：
//   text/render     (waterfall) 文本渲染管道：插值 → 装饰，可层层包裹
//   engine/command  (waterfall) 输入命令分发：默认处理器匹配选项编号，
//                                其他插件 prepend 拦截自定义命令（如 save.js 的 存档/读档）
//   scene/enter     (emit)      进入场景后
//   scene/leave     (emit)      离开场景前
//   choice/made     (emit)      选项被选中、效果执行后
//   engine/start    (emit)      游戏开始
//   engine/end      (emit)      到达结局
//   engine/stop     (emit)      玩家退出
//
// 命令处理协议（engine/command 的返回值）：
//   { type: 'choice', index }  执行第 index 个选项
//   { type: 'scene', id }      直接跳转场景
//   { type: 'rerender' }       重新渲染当前场景（如存档成功后）
//   { type: 'quit' }           退出游戏
//   { type: 'nothing' }        未识别，重新渲染

import { Service } from 'cordis'

export const name = 'engine'

export class EngineService extends Service {
  static inject = ['scenes', 'state', 'io']

  constructor(ctx, config) {
    super(ctx, 'engine')
    this.config = config
    // CLI 的 --entry 通过环境变量透传（dse play --entry <场景ID>）：
    // 优先于 cordis.yml 的 engine.entry，便于脚本从任意场景起跑一段。
    this.entry = process.env.DSE_ENTRY || config.entry
    this.current = null
    this.running = false
  }

  [Service.init]() {
    // 用 setTimeout 让出 init：主循环不阻塞 loader，插件树全部就绪后才开局
    setTimeout(() => this.start(), 0)
  }

  /** 开始游戏（默认从配置的 entry 场景入场；DSE_ENTRY 可覆盖） */
  start(entryId = this.entry) {
    if (this.running) return
    this.running = true
    this.current = entryId
    this.ctx.emit('engine/start', entryId)
    // 进主循环前让出**两个**宏任务：确保其余插件的异步 init（如 save 的
    // `await mkdir`）在首条输入被处理前完成。只让出一个（setImmediate）实测不够 ——
    // mkdir 是线程池任务，要走到 poll 阶段才回调，于是开局第一条输入若是
    // 插件命令（save/load/achievements）会被判成「未识别的输入」。
    // 代价是开局晚约 1 个事件循环 tick，换"第一条命令就有效"。
    setImmediate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setImmediate(resolve))
      this.run().catch((error) => {
        // 全检 N1：引擎异常必须体现在进程退出码上，并且堆栈必须走 stderr。
        // 原先只 logger.error()（写入 stdout）就 stop()，导致：
        //   1) 崩溃的进程仍以退出码 0 结束 —— CI 把失败判成成功；
        //   2) 堆栈混进 stdout —— 违反 README 承诺的「stdout 只放结果、诊断走 stderr」。
        process.stderr.write(`[engine] ${error?.stack || error}\n`)
        process.exitCode = 1
        this.stop(1)
      })
    })
  }

  /** 跳转场景（下一轮循环生效） */
  goto(id) {
    this.current = id
  }

  /** 结束游戏：设置退出码并主动清理根作用域，让事件循环自然退出
   *  @param {number} exitCode 进程退出码。异常收尾传 1，正常退出为 0。
   */
  async stop(exitCode = 0) {
    if (!this.running) return
    this.running = false
    this.ctx.emit('engine/stop')
    this.ctx.io.blank()
    this.ctx.io.print('游戏已退出，感谢游玩！')

    // 不用 process.exit()（全检报告 #10）：它会跳过 cordis 的清理 effect
    // （音效临时文件残留在系统临时目录）、截断管道输出（npm start > log.txt
    // 丢掉尾部），也让引擎无法嵌入宿主程序。改为设置 exitCode 后主动 dispose
    // 根作用域，由 Node 在句柄清空后自然退出。
    // ⚠️ 不要无条件写 0：异常收尾时 stop(1) 传进来的退出码会被冲掉，
    // 导致崩溃的进程仍以 0 退出（全检 N1 首次修复就栽在这里）。
    process.exitCode = exitCode
    try {
      await this.ctx.root.fiber.dispose()
    } catch (error) {
      this.ctx.logger('engine').warn('清理资源时出错: %s', error.message)
    }
  }

  /** 主循环：进入场景 → 首次渲染 → 内层输入循环
   *
   *  「进入场景」与「重绘场景」是两条独立路径（全检报告 #4）：
   *    - 进入场景（外层）：emit scene/leave、执行 onEnter、emit scene/enter
   *      只在 current 真正变化后发生一次
   *    - 重绘场景（内层）：只重新输出界面，不触碰任何状态
   *  早先二者共用一条路径，导致每次 rerender 都重放 onEnter —— 表现为
   *  敲一次 stats 就再扣一次金币、物品无限叠加、战斗中存档让敌人满血复活。
   */
  async run() {
    outer: while (this.running) {
      let scene = this.ctx.scenes.get(this.current)

      // 1. 进入场景：离开旧场景 / 应用 onEnter 效果（每进入一次只做一次）
      this.ctx.emit('scene/leave', this.current)
      const changes = this.ctx.state.apply(scene.onEnter)
      for (const { path, from, to } of changes) {
        this.ctx.logger('engine').info('effect %s: %s -> %s', path, from, to)
      }

      // mode 扩展点：默认 normal（引擎渲染选项并判定结局）；
      // 其他 mode（如 battle）由插件接管界面与输入，返回 falsy 则引擎回退渲染。
      // bail 短路语义：监听返回非 null/false/undefined 即停（cordis isBailed）。
      // 返回值约定：
      //   true                        → 插件已接管界面（引擎不渲染选项）
      //   { redirect: <场景ID> }      → 请求立即正规流转到该场景（跳过渲染与
      //                                输入循环，重新走外层进入流程：scene/leave、
      //                                onEnter、scene/enter、结局判定）。
      //                                战斗插件在敌人配置缺失时用它直入 onWin，
      //                                替代旧"静默 goto"造成的半放行（审计 F4）。
      const mode = scene.mode ?? 'normal'
      const modeResult = mode === 'normal' ? false : this.ctx.bail('scene/mode', this.current, scene, mode)
      if (modeResult && typeof modeResult === 'object' && typeof modeResult.redirect === 'string') {
        this.goto(modeResult.redirect)
        continue
      }
      const handled = !!modeResult
      this.ctx.emit('scene/enter', this.current, scene)

      // 2. 首次渲染（纯输出，不改状态）
      let choices = this.render(scene, mode, handled)

      // 3. 结局判定：仅 normal 模式且无选项时算结局（battle 等模式由插件控制流转）
      if (mode === 'normal' && !choices.length) {
        this.ctx.emit('engine/end', this.current, scene)
        this.ctx.io.print('（完）')
        await this.ctx.io.ask('按回车结束游戏...')
        return this.stop()
      }

      // 重绘当前场景：重新取场景对象 —— 内容热重载可能已替换字典里的场景定义，
      // 若沿用进入时捕获的旧对象，改完内容包界面上仍是旧文本
      const redraw = () => {
        scene = this.ctx.scenes.get(this.current)
        return this.render(scene, mode, handled)
      }

      // 4. 内层输入循环：只有 choice / scene 才会跳出到外层（重进新场景）
      while (this.running) {
        const input = await this.ctx.io.ask(this.config.prompt ?? '>> ')
        if (!input) { choices = redraw(); continue } // 空输入=刷新界面
        const result = await this.ctx.waterfall('engine/command', input, choices, (line, list) => this.defaultCommand(line, list))

        if (!result) { choices = redraw(); continue }
        if (result.type === 'noop') continue // 插件已自行渲染界面，继续等待输入

        switch (result.type) {
          case 'choice': {
            const choice = choices[result.index]
            const effects = this.ctx.state.apply(choice.do)
            for (const { path, from, to } of effects) {
              this.ctx.logger('engine').info('effect %s: %s -> %s', path, from, to)
            }
            this.ctx.emit('choice/made', this.current, choice, effects)
            if (choice.goto !== undefined) {
              const target = String(choice.goto)
              if (target === '@restart') {
                // 全量重置回 entry（开局重玩）
                this.ctx.state.reset()
                this.goto(this.entry)
              } else if (target.startsWith('@loop:')) {
                // 时间循环（M11，见 CONTENT-EXPANSION-PLAN §16.2）：重置但保留
                // cordis.yml state.config.loopKeep 声明域的知识（如 clues.loop.*），
                // 回到循环起点场景。@restart 全清语义不受影响。
                const loopEntry = target.slice('@loop:'.length)
                this.ctx.state.reset({ keep: this.ctx.state.config.loopKeep })
                this.goto(loopEntry)
              } else {
                this.goto(target)
              }
            }
            break // 跳出内层循环 → 外层重新进入新场景
          }
          case 'scene':
            this.goto(result.id)
            break // 同上：场景已切换，交回外层重新进入
          case 'quit':
            return this.stop()
          case 'rerender':
            // 只重绘：onEnter 不重放、scene/leave 不触发、战斗状态保留
            choices = redraw()
            continue
          default:
            this.ctx.io.print('（未识别的输入，输入 help 查看帮助）')
            choices = redraw()
            continue
        }
        // choice / scene 走到这里：跳出内层循环，让外层重新进入（可能已切换的）场景
        break
      }
    }
  }

  /** 渲染当前场景界面（不产生任何状态变更），返回过滤后的选项列表 */
  render(scene, mode, handled) {
    // 文本渲染管道：插值 → waterfall 装饰
    let text = this.ctx.state.interpolate(scene.text)
    text = this.ctx.waterfall('text/render', text, (t) => t)

    // 条件求值过滤选项（每次重绘都重新求值，反映最新状态）
    const choices = (scene.choices ?? []).filter((choice) => this.ctx.state.check(choice.if))

    // 标题与选项文本同样走插值（E1）：可写"需 10 金币（你有 {gold}）"
    const title = this.ctx.state.interpolate(scene.title ?? this.current)

    this.ctx.io.blank()
    this.ctx.io.print(`── ${title} ──`)
    this.ctx.io.print(text)
    this.ctx.io.blank()

    // 页面渲染完成：插件可在此补充自己的界面（如战斗血条）
    this.ctx.emit('scene/rendered', this.current, scene, mode)

    // 选项渲染：normal 模式由引擎渲染；其他模式交给插件（handled 时跳过）
    if (mode === 'normal' || !handled) {
      choices.forEach((choice, index) => {
        this.ctx.io.print(`  [${index + 1}] ${this.ctx.state.interpolate(choice.text)}`)
      })
      this.ctx.io.blank()
    }
    return choices
  }

  /** 默认命令处理器：编号选项 + 内置命令 */
  defaultCommand(line, choices) {
    const number = Number(line)
    if (Number.isInteger(number) && number >= 1 && number <= choices.length) {
      return { type: 'choice', index: number - 1 }
    }
    switch (line.toLowerCase()) {
      case 'help':
      case '?':
        // 命令全集与实现清单集中在 plugins/lib/global-commands.js；
        // 这里提示玩家存在存档/成就命令（审计 F12：原文案只列 help/stats/quit）
        this.ctx.io.print('内置命令: 输入选项编号进行选择 | help 帮助 | stats 查看状态 | achievements 成就 | save/load/slots 存档 | quit 退出')
        return { type: 'rerender' }
      case 'stats':
      case 'status': {
        const get = (path) => this.ctx.state.get(path)
        this.ctx.io.print(`  ${get('name')} | HP ${get('hp')} | ATK ${get('atk')} | 金币 ${get('gold')}`)
        const held = Object.entries(get('items') ?? {}).filter(([, count]) => count > 0)
        this.ctx.io.print('  背包: ' + (held.length ? held.map(([k, v]) => `${k}×${v}`).join(', ') : '（空）'))
        return { type: 'rerender' }
      }
      case 'quit':
      case 'exit':
        return { type: 'quit' }
      default:
        return { type: 'nothing' }
    }
  }
}

export default EngineService
