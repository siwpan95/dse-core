// 成就插件 —— 零侵入扩展示例：不改引擎一行代码，只监听事件 + 拦截命令
//
// 1. 成就表在 cordis.yml 配置里声明（数据驱动，与场景字典同哲学）
// 2. 监听 choice/made、scene/enter 事件检查解锁条件
// 3. prepend 拦截 engine/command 提供 achievements 命令
// 4. 解锁时 emit 'achievement/unlock'，其他插件（音效/弹窗）可自行订阅

import { Service } from 'cordis'

export const name = 'achievements'

export class AchievementsService extends Service {
  static inject = ['state', 'engine', 'io']

  constructor(ctx, config) {
    super(ctx, 'achievements')
    this.config = config
    /** @type {Set<string>} */
    this.unlocked = new Set()
    /** 成就表：{ id: { name, desc, when } }，when 为条件表达式字符串 */
    this.table = Object.create(null)
  }

  [Service.init]() {
    for (const item of this.config.list ?? []) {
      this.table[item.id] = item
    }
    this.ctx.logger('achievements').info('registered %d achievements', Object.keys(this.table).length)

    // 场景进入与选项选中时检查成就条件
    this.ctx.on('scene/enter', (scene) => this.check(scene))
    this.ctx.on('choice/made', (scene, choice, effects) => this.check(scene, choice, effects))

    // 拦截 achievements 命令
    this.ctx.on('engine/command', (line, choices, next) => {
      if (!/^(achievements|成就)$/i.test(line)) return next()
      this.show()
      return { type: 'rerender' }
    }, { prepend: true })
  }

  /** 检查所有成就条件；条件上下文包含场景 ID、选项与效果 */
  check(scene, choice, effects) {
    for (const [id, item] of Object.entries(this.table)) {
      if (this.unlocked.has(id)) continue
      if (this.ctx.state.check(item.when, { scene, choice, effects })) {
        this.unlock(id)
      }
    }
  }

  unlock(id) {
    const item = this.table[id]
    if (!item || this.unlocked.has(id)) return
    this.unlocked.add(id)
    this.ctx.emit('achievement/unlock', id, item)
    this.ctx.io.print(`  ★ 成就解锁：${item.name} —— ${item.desc}`)
  }

  /** 读档恢复解锁集合（审计 F10）：只保留仍在成就表中的 id（内容改版兜底）。
   *  旧档 / achievements 插件缺失时该字段为 undefined，直接忽略。 */
  restore(list) {
    if (!Array.isArray(list)) return
    for (const id of list) {
      if (typeof id === 'string' && this.table[id] && !this.unlocked.has(id)) {
        this.unlocked.add(id)
      }
    }
  }

  show() {
    const list = Object.entries(this.table)
    if (!list.length) return this.ctx.io.print('  （暂无成就）')
    for (const [id, item] of list) {
      const state = this.unlocked.has(id) ? '✓' : ' '
      this.ctx.io.print(`  [${state}] ${item.name} —— ${item.desc}`)
    }
  }
}

export default AchievementsService
