// 存档/读档插件 —— 演示「不改引擎代码，用事件扩展引擎能力」
//
// 做法：prepend 监听 engine/command（waterfall），在引擎默认处理器之前
// 拦截 save/load/slots 命令。这就是参考资料强调的插件化收益：
// 新能力 = 新插件 + 配置文件一行，核心代码零改动。
//
// 安全约束（全检报告 #6）：
//   - slot 白名单 /^[\w.\-]{1,64}$/ —— 防路径遍历（不受信任的输入不进文件名）
//   - resolve 后断言仍在 saves/ 内 —— 双保险，即便白名单被绕过
//   - 写入走 temp + rename —— 原子落盘，避免写一半中断导致存档截断
//   - 读档做 schema 校验 + scenes.has() 兜底 —— 坏档与内容改版都不会让游戏崩
//   副作用：白名单顺带挡掉了 slot 里的 ANSI 转义序列（终端输出注入）

import { Service } from 'cordis'
import { mkdir, readFile, writeFile, readdir, rename, unlink } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'save'

/** 存档位白名单：仅字母数字与 . _ - ，长度 1..64 */
const SLOT_PATTERN = /^[\w.\-]{1,64}$/

export class SaveService extends Service {
  // scenes 用于读档时校验存档指向的场景是否仍存在（内容改版兜底）；
  // achievements 用于把解锁列表写入存档 / 读档恢复（审计 F10，cordis 服务
  // 须经 inject 声明才能访问，否则代理抛 "without inject"）。
  static inject = ['state', 'engine', 'io', 'scenes', 'achievements']

  constructor(ctx, config) {
    super(ctx, 'save')
    this.config = config
    // 目录基准用 ctx 根（include 已锚定到项目根），而非 process.cwd()：
    // 保证从任意目录 `dse play`/`dse saves` 都读写同一份存档（硬编码审计 F1/F9）
    const root = fileURLToPath(this.ctx.root.baseUrl)
    this.dir = resolve(root, config.dir ?? './saves')
  }

  async [Service.init]() {
    // ⚠️ 顺序不可随意调整：`await mkdir` 必须留在注册之前。
    // cordis 的 prepend 是「后注册者排在链路最前」，save 因这个 await 注册得最晚，
    // 从而排在 combat/trade 之前 —— 战斗中（combat 接管输入时）save 才能被本插件处理。
    // 曾尝试把注册提到 await 之前，结果 combat 抢占 save，L9「战斗中存档成功」失败。
    // 启动窗口内 save 可能尚未就绪的问题，改由 console-io 在 ask() 让出宏任务解决。
    await mkdir(this.dir, { recursive: true })
    // prepend: 抢在引擎默认处理器之前拿到输入
    this.ctx.on('engine/command', (line, choices, next) => this.handle(line, choices, next), { prepend: true })
  }

  async handle(line, choices, next) {
    const [command, ...rest] = line.split(/\s+/)
    switch (command?.toLowerCase()) {
      case 'save':
      case '存': {
        const slot = rest[0] ?? 'auto'
        try {
          await this.save(slot)
          this.ctx.io.print(`  已保存到存档位 ${slot}`)
        } catch (error) {
          this.ctx.io.print(`  保存失败：${error.message}`)
        }
        return { type: 'rerender' }
      }
      case 'load':
      case '读': {
        const slot = rest[0] ?? 'auto'
        const ok = await this.load(slot)
        return ok ? { type: 'scene', id: this.ctx.engine.current } : { type: 'rerender' }
      }
      case 'slots':
      case '档': {
        try {
          const list = await this.list()
          this.ctx.io.print(list.length ? `  存档位: ${list.join(', ')}` : '  （暂无存档）')
        } catch (error) {
          this.ctx.io.print(`  读取存档列表失败：${error.message}`)
        }
        return { type: 'rerender' }
      }
      default:
        return next()
    }
  }

  /** 存档位 → 文件路径；同时做白名单与越界双重校验 */
  slotFile(slot) {
    if (typeof slot !== 'string' || !SLOT_PATTERN.test(slot)) {
      throw new Error(`存档位名称非法（只允许字母、数字、点、下划线、连字符，长度 1-64）`)
    }
    const file = resolve(this.dir, `${slot}.json`)
    const base = resolve(this.dir)
    if (file !== base && !file.startsWith(base + sep)) {
      throw new Error('存档路径越界')
    }
    return file
  }

  /** 取存档迁移服务（可选插件）；未启用时返回 null，行为与迁移机制引入前一致。
   *  刻意不写进 static inject —— 否则内容仓库若不注册 save-migrate，本插件会因
   *  依赖未满足而永不启动，等于存档功能凭空消失。可选增强就用可选方式取。
   */
  migrator() {
    try {
      const service = this.ctx['save-migrate']
      return service && typeof service.migrate === 'function' ? service : null
    } catch {
      return null // 服务未注入（cordis 对未声明服务的代理访问会抛错）
    }
  }

  async save(slot) {
    const file = this.slotFile(slot)
    const record = {
      slot,
      scene: this.ctx.engine.current,
      state: this.ctx.state.snapshot(),
      savedAt: new Date().toISOString(),
      // 成就解锁随档持久化（审计 F10）。inject 已声明 achievements，
      // 服务必然可用；直接展开其解锁集合写入存档。
      achievements: [...this.ctx.achievements.unlocked],
    }
    // 存档格式版本：由 save-migrate 插件盖章（未启用时不写，旧档语义不变）
    const migrator = this.migrator()
    if (migrator) record.version = migrator.version
    const tmp = file + '.tmp'
    try {
      await mkdir(this.dir, { recursive: true })
      await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8')
      await rename(tmp, file) // 原子替换：避免写一半中断导致存档截断
    } catch (error) {
      await unlink(tmp).catch(() => {})
      throw new Error(error.code === 'ENOENT' ? '存档目录不可用' : error.message)
    }
    this.ctx.emit('save/applied', slot, record)
    return record
  }

  /** 读档：白名单 + schema 校验 + 场景存在性兜底，任何失败都只提示不崩溃 */
  async load(slot) {
    try {
      const file = this.slotFile(slot)
      const raw = await readFile(file, 'utf8')
      let record = JSON.parse(raw)

      const problems = this.validateRecord(record)
      if (problems.length) throw new Error(`存档格式不合法：${problems.join('；')}`)

      // 存档版本迁移（骨架）：内容改版后旧档按版本链升级，而不是直接判死。
      // 未启用 save-migrate 插件时这一段恒等通过，行为与引入前一致。
      const migrator = this.migrator()
      if (migrator?.needsMigration(record)) {
        const result = migrator.migrate(record)
        record = result.record
        this.ctx.io.print(`  存档已从 v${result.from} 迁移到 v${result.to}`)
      }

      if (!this.ctx.scenes.has(record.scene)) {
        // 内容改版后存档指向的场景可能已删除：回退入口场景，不让游戏直接死掉
        // engine.entry 已含 DSE_ENTRY 覆盖逻辑，优先用它，保证与启动场景一致
        const fallback = this.ctx.engine.entry ?? this.ctx.engine.config?.entry ?? this.ctx.scenes.ids[0]
        this.ctx.io.print(`  存档场景 "${record.scene}" 已不存在，改为从 "${fallback}" 开始`)
        record.scene = fallback
      }

      this.ctx.state.restore(record.state)
      // 读档恢复成就解锁（内容改版后无效 id 由 achievements.restore 过滤）
      this.ctx.achievements.restore(record.achievements)
      this.ctx.engine.goto(record.scene)
      this.ctx.io.print(`  已读取存档位 ${slot}（场景: ${record.scene}）`)
      return true
    } catch (error) {
      const reason = error.code === 'ENOENT' ? '存档不存在' : error.message
      this.ctx.io.print(`  读取存档 ${slot} 失败: ${reason}`)
      return false
    }
  }

  /** 存档记录 schema 校验，返回问题列表（空数组 = 合法） */
  validateRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return ['存档内容不是对象']
    const problems = []
    if (typeof record.scene !== 'string' || !record.scene) problems.push('缺少 scene 字段')
    if (!record.state || typeof record.state !== 'object' || Array.isArray(record.state)) {
      problems.push('state 字段不是对象')
    }
    // 成就字段可选（旧档无），但一旦出现必须是字符串数组
    if (record.achievements !== undefined &&
      (!Array.isArray(record.achievements) || record.achievements.some((x) => typeof x !== 'string'))) {
      problems.push('achievements 字段不是字符串数组')
    }
    return problems
  }

  async list() {
    const files = await readdir(this.dir)
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .filter((slot) => SLOT_PATTERN.test(slot))
      .sort()
  }
}

export default SaveService
