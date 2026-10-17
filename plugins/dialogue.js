// 对话/谈判模式插件 —— 多角色对话界面（引擎零改动，仿 trade.js）
//
// 接入方式：场景字典声明 mode: 'dialogue' + dialogue: { onEnd, npc, topics }
//   topics: [{ id, name, reply, effect }] —— 玩家"问"一个话题，显示 reply、
//   执行 effect（记线索/立场）。对话结束（`end` 或注意点耗尽）调用
//   engine.goto(onEnd) 流转剧情。
//   引擎遇非 normal 模式 bail 'scene/mode'，本插件返回 true 宣告接管。
//   之后该场景输入由本插件处理（engine/command prepend 拦截）。
//
// 设计原则：**确定性优先** —— 话题 reply 与 effect 全部数据驱动（写死在场景
//   dialogue.topics），e2e 断言可精确复现；注意点预算（dialogue.notes，可选）
//   约束"每轮取舍"：问满 notes 个话题后强制结束（0 = 不限）。
//
// 状态：state.dialogueAsked（已问话题 ID 数组，防重复，存档可恢复）
// 命令：ask <话题ID|编号> 询问 | topics 话题列表 | again 重看 | end 结束对话
//       全局命令（quit/save/...）放行

import { Service } from 'cordis'
import { isGlobalCommand } from './lib/global-commands.js'

export const name = 'dialogue'

export class DialogueService extends Service {
  static inject = ['state', 'engine', 'io']

  constructor(ctx, config) {
    super(ctx, 'dialogue')
    this.config = config
    /** 当前对话：{ onEnd, npc, notes, topics, asked, used } */
    this.active = null
  }

  [Service.init]() {
    // 接管 dialogue 模式的场景
    this.ctx.on('scene/mode', (sceneId, scene, mode) => {
      if (mode !== 'dialogue') return false
      this.begin(scene.dialogue ?? {})
      return true
    }, { prepend: true })

    // 对话中优先处理输入（抢在 save / achievements 之前）
    this.ctx.on('engine/command', (line, choices, next) => this.handle(line, next), { prepend: true })

    // 场景文本渲染完成后补画话题面板
    this.ctx.on('scene/rendered', () => { if (this.active) this.render() })

    // 离开对话场景时清理（结束跳转时 active 已清，这里兜底）
    this.ctx.on('scene/leave', () => { this.active = null })

    this.ctx.logger('dialogue').info('loaded')
  }

  /** 开谈：登记场景声明的对话配置 */
  begin(dlg) {
    const s = this.ctx.state
    if (s.get('dialogueAsked') == null) s.set('dialogueAsked', [])
    this.active = {
      onEnd: dlg.onEnd,
      npc: dlg.npc ?? '那人',
      notes: dlg.notes ?? 0,   // 注意点预算：0 = 不限
      topics: dlg.topics ?? [],
      asked: s.get('dialogueAsked') ?? [],
      used: 0,                 // 本场已问次数（插件内计数，不进 state）
    }
  }

  /** 处理对话中的输入命令 */
  handle(line, next) {
    if (!this.active) return next()
    const raw = line.trim()
    const [cmd, ...args] = raw.split(/\s+/)

    switch (cmd) {
      case 'ask':
      case 'a':
      case '问':
        return this.doAsk(args.join(' '))
      case 'topics':
      case 't':
      case '话题':
        this.render()
        return { type: 'noop' }
      case 'again':
      case '再看':
        this.render()
        return { type: 'noop' }
      case 'end':
      case 'n':
      case 'next':
      case '结束':
        return this.finish()
      case 'help':
      case '?':
        this.ctx.io.print('  对话指令: ask <话题编号或名称> 询问 | topics 话题列表 | end 结束')
        this.render()
        return { type: 'noop' }
      default:
        // 全局命令放行（名单集中在 plugins/lib/global-commands.js）
        if (isGlobalCommand(raw)) return next()
        this.ctx.io.print(`  对话中不可用：${raw || '(空)'}（指令: ask <话题> | topics | end）`)
        this.render()
        return { type: 'noop' }
    }
  }

  /** 当前可见话题（按 if 条件过滤；编号随可见列表重排。M16 时序锁用） */
  visible() {
    if (!this.active) return []
    const s = this.ctx.state
    return this.active.topics.filter((t) => !t.if || s.check(t.if))
  }

  /** 询问话题：显示 reply、执行 effect、标记已问 */
  doAsk(input) {
    const a = this.active
    if (!input) {
      this.render()
      return { type: 'noop' }
    }
    const topic = this.visible().find((t, i) =>
      t.id === input || t.name === input || String(i + 1) === input)
    if (!topic) {
      this.ctx.io.print(`  没有这个话题：${input}。输入 topics 看话题列表。`)
      this.render()
      return { type: 'noop' }
    }
    if (a.asked.includes(topic.id)) {
      this.ctx.io.print(`  「${topic.name}」——你已经问过了，他不再多说。`)
      this.render()
      return { type: 'noop' }
    }
    if (a.notes > 0 && a.used >= a.notes) {
      this.ctx.io.print('  你的注意点用尽了，只能结束这场对话。')
      return this.finish()
    }
    this.ctx.io.print(`  【${a.npc}】${topic.reply}`)
    const s = this.ctx.state
    s.apply(topic.effect ?? {})
    a.asked.push(topic.id)
    s.set('dialogueAsked', [...a.asked])
    a.used += 1
    this.ctx.io.blank()
    this.render()
    return { type: 'noop' }
  }

  /** 结束对话：按场景声明流转剧情 */
  finish() {
    const { onEnd, npc } = this.active
    this.ctx.io.print(`  你与${npc}的对话告一段落。`)
    this.active = null
    if (onEnd) {
      this.ctx.engine.goto(onEnd)
      return { type: 'scene', id: onEnd }
    }
    return { type: 'noop' }
  }

  /** 渲染话题面板：话题列表 + 已问标记 + 注意点余量 */
  render() {
    if (!this.active) return
    const a = this.active
    this.ctx.io.blank()
    this.ctx.io.print(`  ── 与${a.npc}对话 ──`)
    const rows = this.visible()
      .map((t, i) => `    ${a.asked.includes(t.id) ? '·' : String(i + 1) + '.'} ${t.name}${a.asked.includes(t.id) ? '（已问过）' : ''}`)
      .join('\n')
    this.ctx.io.print(rows || '    （无话可问）')
    if (a.notes > 0) {
      this.ctx.io.print(`  注意点余量：${Math.max(0, a.notes - a.used)} / ${a.notes}`)
    }
    this.ctx.io.print('  指令: ask <话题编号或名称> 询问 | topics 话题列表 | end 结束')
    this.ctx.io.blank()
  }
}

export default DialogueService
