// 日记回溯插件 —— 只读重读已走过的篇目（引擎零改动，M14 新增第三种 mode）
//
// 接入方式：场景字典声明 mode: 'diary' + diary: { onExit: '<场景ID>' }
//   引擎遇非 normal 模式 bail 'scene/mode'，本插件返回 true 宣告接管。
//   之后该场景输入由本插件处理（engine/command prepend 拦截）。
//
// 原型（M14 史料）：1916 年胡适在韦女士处借回自己三年间寄她的一百多封信，
//   「乃如读小说书，竟不肯放手……吾此两年中之思想感情之变迁多具于此百余书中，
//   他处决不能得此真我之真相也。」—— 唯一能让玩家回看「自己选了什么」的机制。
//
// ⚠️ 核心约束：**只读**。
//   重读绝不能走 engine.goto / 不能执行 scene.onEnter。否则每重读一次就会
//   重放一次副作用（扣金币、叠加道具、改写 flags），与存档后 rerender 曾
//   导致的「敲一次 stats 就再扣一次金币」是同一类 bug（见 engine.js 注释）。
//   本插件只取场景对象渲染 title + text，不触碰任何状态。
//
// 状态：state.diaryRead（已读篇目 ID 数组，有序去重；存档可恢复）
// 命令：<编号> 重读该篇 | back 返回 | help 帮助；全局命令（quit/save/...）放行

import { Service } from 'cordis'
import { isGlobalCommand } from './lib/global-commands.js'

export const name = 'diary'

export class DiaryService extends Service {
  static inject = ['state', 'engine', 'io', 'scenes']

  constructor(ctx, config) {
    super(ctx, 'diary')
    this.config = config
    /** 当前接管的回溯场景：{ id, onExit }；null 表示不在回溯中 */
    this.active = null
  }

  [Service.init]() {
    // 接管 diary 模式的场景（prepend：抢在其他 mode 监听之前判定）
    this.ctx.on('scene/mode', (sceneId, scene, mode) => {
      if (mode !== 'diary') return false
      this.active = { id: sceneId, onExit: scene.diary?.onExit ?? null }
      return true
    }, { prepend: true })

    // 记录已读篇目：进入任何场景都记一笔，供回溯列表展示。
    // 排除 diary 场景自身——重读目录里不该有目录本身。
    this.ctx.on('scene/enter', (id, scene) => {
      if (scene?.mode === 'diary') return
      this.markRead(id)
    })

    // 回溯中优先处理输入（抢在 save / achievements 之前）
    this.ctx.on('engine/command', (line, choices, next) => this.handle(line, next), { prepend: true })

    // 场景文本渲染完成后补画回溯列表
    this.ctx.on('scene/rendered', () => { if (this.active) this.render() })

    // 离开回溯场景时清理（exit 已清，这里兜底）
    this.ctx.on('scene/leave', () => { this.active = null })

    this.ctx.logger('diary').info('loaded')
  }

  /** 记一篇已读（有序、去重；未进过则追加） */
  markRead(id) {
    if (!id) return
    const list = this.readList()
    if (list.includes(id)) return
    this.ctx.state.set('diaryRead', [...list, id])
  }

  /** 已读 ID 列表（防御：存档里可能是 null 或非数组） */
  readList() {
    const value = this.ctx.state.get('diaryRead')
    return Array.isArray(value) ? value : []
  }

  /** 可重读的篇目：已读 ∩ 字典中仍存在（内容热重载删掉的场景自动剔除） */
  entries() {
    return this.readList().filter((id) => this.ctx.scenes.has(id))
  }

  /** 处理回溯中的输入命令 */
  handle(line, next) {
    if (!this.active) return next()
    const raw = String(line ?? '').trim()
    if (!raw) { this.render(); return { type: 'noop' } }

    const list = this.entries()
    const number = Number(raw)
    if (Number.isInteger(number) && number >= 1 && number <= list.length) {
      this.readEntry(list[number - 1])
      this.render()
      return { type: 'noop' }
    }

    switch (raw.toLowerCase()) {
      case 'back':
      case 'b':
      case 'q':
      case '返回':
      case '退出':
        return this.exit()
      case 'help':
      case '?':
        this.ctx.io.print('  札记指令: 输入编号重读该篇 | back 返回 | help 帮助')
        this.render()
        return { type: 'noop' }
      default:
        // 全局命令放行（名单集中在 plugins/lib/global-commands.js）
        if (isGlobalCommand(raw)) return next()
        this.ctx.io.print(`  札记中不可用：${raw}（指令: 编号 重读 | back 返回 | help 帮助）`)
        this.render()
        return { type: 'noop' }
    }
  }

  /**
   * 重读一篇：只读渲染 title + text。
   * 刻意不走 engine.goto —— 那是「进入场景」，会重放 onEnter 与 scene/leave/enter。
   */
  readEntry(id) {
    const scene = this.ctx.scenes.get(id)
    if (!scene) return
    const title = this.ctx.state.interpolate(scene.title ?? id)
    const text = this.ctx.state.interpolate(scene.text ?? '')
    this.ctx.io.blank()
    this.ctx.io.print(`  ── ${title} ──`)
    // 正文整体缩进两格，与列表层级区分开
    this.ctx.io.print(String(text).split('\n').map((line) => `  ${line}`).join('\n'))
    this.ctx.io.blank()
  }

  /** 退出回溯：回到场景声明的 diary.onExit（走正规流转，不绕过引擎） */
  exit() {
    const { onExit } = this.active ?? {}
    this.active = null
    if (onExit) {
      this.ctx.engine.goto(onExit)
      return { type: 'scene', id: onExit }
    }
    // 未声明 onExit：就地重绘（等价于刷新目录页）
    return { type: 'rerender' }
  }

  /** 渲染回溯目录 */
  render() {
    if (!this.active) return
    const list = this.entries()
    this.ctx.io.blank()
    // 标题刻意不与场景 title 同名：引擎已渲染过一次场景标题，重名会像重复渲染
    this.ctx.io.print('  ── 可重读的篇目 ──')
    if (!list.length) {
      this.ctx.io.print('  （还没有可重读的篇目。）')
    } else {
      list.forEach((id, index) => {
        const scene = this.ctx.scenes.get(id)
        const title = this.ctx.state.interpolate(scene?.title ?? id)
        this.ctx.io.print(`    [${index + 1}] ${title}`)
      })
    }
    this.ctx.io.blank()
    this.ctx.io.print('  指令: 编号 重读该篇 | back 返回 | help 帮助')
    this.ctx.io.blank()
  }
}

export default DiaryService
