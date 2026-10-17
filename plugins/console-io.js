// 终端 IO 适配器：把「输入/输出」抽象为 ctx.io 服务
// 换 UI（Web / Discord / TTS）时只需替换本插件，引擎与其他插件不动。
// 参考资料要点：插件是能力的独立单元，通过服务 key（ctx.io）解耦。
//
// 输入实现说明：不直接用 rl.question()（win32 管道下每行只返回首字符，
// 自动化测试/管道输入不可靠），改用 readline async iterator + 等待队列。
//
// 脚本输入（CLI 非交互模式）：设置环境变量 DSE_INPUT 为逗号分隔的输入序列
// （如 DSE_INPUT="3,1,a,a"），ask() 会按序取出并回显；序列用尽后自动返回
// 'quit'，让引擎走正常退出流程（打印提示 → dispose → 退出码 0），
// 而不是卡在等待输入上。这样 CLI 可以在 CI/脚本里无交互地跑完整条线路。

import { Service } from 'cordis'
import { createInterface } from 'node:readline'

export const name = 'io'

export class ConsoleIO extends Service {
  static inject = []

  constructor(ctx, config) {
    super(ctx, 'io')
    this.rl = null
    this.lines = []
    this.waiters = []
    this.eof = false // stdin 是否已耗尽（EOF）
    // 脚本输入队列；null = 交互模式
    this.scripted = process.env.DSE_INPUT
      ? String(process.env.DSE_INPUT).split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
      : null
  }

  [Service.init]() {
    // 脚本模式下不创建 readline：stdin 无需消费，避免进程挂在等待输入上
    if (this.scripted) {
      this.ctx.root.effect(() => () => { process.stdin.pause() })
      this.ctx.logger('io').info('scripted input: %d steps', this.scripted.length)
      return
    }
    this.rl = createInterface({ input: process.stdin, output: process.stdout })
    // 清理挂在根上下文的 effect 上 —— 引擎不再调用 process.exit()，
    // 而是 dispose 根作用域后让事件循环自然退出，因此这里必须释放 stdin 句柄，
    // 否则进程会一直挂在等待输入上退不出去（管道与 TTY 下均如此）。
    this.ctx.root.effect(() => () => {
      this.rl?.close()
      process.stdin.pause()
    })

    // 后台泵：逐行读入，喂给等待中的 ask()；EOF 时放行所有等待者（空输入）
    ;(async () => {
      for await (const line of this.rl) {
        const waiter = this.waiters.shift()
        if (waiter) waiter.resolve(line.trim())
        else { this.lines.push(line.trim()) }
      }
      for (const waiter of this.waiters.splice(0)) waiter.resolve('')
      // 全检 N5：标记 stdin 已耗尽。此后 ask() 若再无缓冲输入，直接返回 quit
      // 走引擎正常退出流程，而不是把空串交给主循环（空串=重绘 → 死循环挂起）。
      this.eof = true
    })().catch((error) => this.ctx.logger('io').error(error))
  }

  print(text = '') {
    process.stdout.write(String(text) + '\n')
  }

  /** 输出空行 */
  blank() {
    this.print('')
  }

  async ask(prompt = '> ') {
    // 脚本模式：按序取用，用尽后以 quit 收尾（走引擎的正常退出流程）
    if (this.scripted) {
      const next = this.scripted.length ? this.scripted.shift() : 'quit'
      process.stdout.write(`${prompt}${next}\n`)
      // 全检 S-2/N1：必须让出一个宏任务。
      // 否则引擎主循环会退化成纯 microtask 循环，永不把控制权交回事件循环，
      // 导致 setTimeout / fs 回调 / 其余插件的 async init 被永久饿死 ——
      // 表现为脚本模式下 save/sound 等插件从未就绪，命令静默回落成「未识别的输入」。
      await new Promise((resolve) => setImmediate(resolve))
      return next
    }
    // 交互模式：即便缓冲区里已有输入，也先让出一个宏任务。
    // 否则管道/极速输入会在异步 init（如 save 插件的 await mkdir）完成之前送达，
    // 该命令尚未注册即被判为「未识别的输入」。
    await new Promise((resolve) => setImmediate(resolve))
    process.stdout.write(prompt)
    if (this.lines.length) return this.lines.shift()
    // stdin 已耗尽：不再挂起等待，交给引擎走正常退出流程（见 [Service.init] 的 eof 标记）
    if (this.eof) return 'quit'
    return new Promise((resolve) => this.waiters.push({ resolve }))
  }

  /** 注入一条虚拟输入（热重载等场景用来打断等待、触发重渲染） */
  wake(text = '') {
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(text)
    else this.lines.push(text)
  }
}

export default ConsoleIO
