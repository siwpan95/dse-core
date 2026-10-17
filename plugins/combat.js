// 战斗数值系统插件 —— 回合制战斗 + 数值公式（引擎零改动）
//
// 接入方式：场景字典声明 mode: 'battle' + battle: { enemy, onWin, onLose }
//   引擎遇到非 normal 模式会 bail 'scene/mode' 事件，本插件返回 true 宣告接管：
//   之后该场景的输入全部由本插件处理（engine/command prepend 拦截），
//   战斗结束调用 engine.goto(onWin/onLose) 流转剧情。
//
// 数值设计（可在 cordis.yml 覆盖 formula 参数）：
//   伤害 = max(1, round((atk * 随机波动 - def * 减伤系数) * 暴击倍率 * 姿态系数))
//   姿态：attack 正常受击；defend 本回合减伤 50%；flee 成功率 fleeChance
// 事件：battle/start、battle/hit、battle/crit、battle/end（音效插件订阅这些事件发声）

import { Service } from 'cordis'
import { isGlobalCommand } from './lib/global-commands.js'

export const name = 'combat'

/** 默认数值公式参数 */
export const DEFAULT_FORMULA = {
  variance: 0.2,     // 伤害随机波动 ±20%
  defenseFactor: 0.5, // 每点防御抵消的伤害
  critMult: 1.8,     // 暴击倍率
  defendCut: 0.5,    // 防御姿态减伤 50%
  fleeChance: 0.45,  // 逃跑成功率
}

export class CombatService extends Service {
  static inject = ['state', 'engine', 'io']

  constructor(ctx, config) {
    super(ctx, 'combat')
    this.config = config
    this.formula = { ...DEFAULT_FORMULA, ...(config.formula ?? {}) }
    this.enemies = config.enemies ?? {}
    /** 武器加成表：{ [itemId]: { name, atk } }，按背包数量累加到玩家 atk */
    this.weapons = config.weapons ?? {}
    /** 当前战斗：{ id, enemy, hp, maxHp, turn } */
    this.active = null
    this.lastRoll = null   // 最近一次伤害结算明细（供测试与调试）
  }

  [Service.init]() {
    // 接管 battle 模式的场景。返回值协议见 engine.js scene/mode 注释：
    // begin 成功 → true（接管）；缺敌人有 onWin → { redirect } 立即流转；
    // 缺敌人无 onWin → false（回退 normal 渲染）
    this.ctx.on('scene/mode', (sceneId, scene, mode) => {
      if (mode !== 'battle') return false
      return this.begin(scene.battle ?? {})
    }, { prepend: true })

    // 战斗中优先处理输入（抢在 save / achievements 之前）
    this.ctx.on('engine/command', (line, choices, next) => this.handle(line, next), { prepend: true })

    // 场景文本渲染完成后补画战斗界面（保持画面顺序：场景文本 → 战斗面板）
    this.ctx.on('scene/rendered', () => { if (this.active) this.render() })

    // 离开战斗场景时清理战斗状态
    this.ctx.on('scene/leave', () => { this.active = null })

    this.ctx.logger('combat').info('loaded %d enemies', Object.keys(this.enemies).length)
  }

  /** 开战：读取敌人字典，初始化战斗状态，渲染首屏
   *  @returns {boolean | { redirect: string }} true=已接管；{redirect}=缺敌人时
   *           请求引擎立即正规进入 onWin；false=无 onWin 可回退（不接管）
   */
  begin(battle) {
    const id = battle.enemy ?? 'dummy'
    const enemy = this.enemies[id]
    if (!enemy) {
      // 契约错误：内容包 battle.enemy 引用未在 combat.enemies 配置的敌人。
      // 审计 F4 实测旧实现（goto + 静默放行）会让引擎停在原场景，玩家任意
      // 输入才经 redraw 跳到 onWin，且 scene/leave、onEnter、结局判定全被跳过；
      // 现在返回 { redirect } 走引擎正规流转。开发期还应由 lint 交叉校验拦截
      // （scripts/lint-content.mjs：battle.enemy ↔ cordis.yml combat.enemies）。
      if (battle.onWin) {
        this.ctx.io.print(`  （战斗配置错误：未定义敌人 "${id}"，直接进入后续场景）`)
        return { redirect: battle.onWin }
      }
      this.ctx.io.print(`  （战斗配置错误：未定义敌人 "${id}" 且无 onWin 回退）`)
      return false
    }
    this.active = {
      id,
      battle,
      enemy,
      hp: enemy.hp,
      maxHp: enemy.hp,
      turn: 1,
      defending: false,
    }
    // 界面由 'scene/rendered' 统一渲染（保证「场景文本 → 战斗面板」的顺序）
    this.ctx.emit('battle/start', id, enemy)
    return true
  }

  /** 玩家战斗属性：基础属性 + 背包武器加成 */
  get playerStats() {
    const s = this.ctx.state
    let atk = s.get('atk') ?? 1
    const bonus = []
    for (const [id, count] of Object.entries(s.get('items') ?? {})) {
      const weapon = this.weapons[id]
      if (!weapon || !(count > 0)) continue
      atk += (weapon.atk ?? 0) * count
      bonus.push(`${weapon.name ?? id}+${weapon.atk * count}`)
    }
    return {
      atk,
      bonus,
      def: s.get('def') ?? 0,
      crit: s.get('crit') ?? 0.05,
    }
  }

  /** 伤害结算：返回 { dmg, crit } */
  rollDamage(attacker, defender) {
    const f = this.formula
    const variance = 1 + (Math.random() * 2 - 1) * f.variance
    const crit = Math.random() < (attacker.crit ?? 0)
    const raw = (attacker.atk ?? 1) * variance - (defender.def ?? 0) * f.defenseFactor
    const base = Math.max(1, Math.round(raw))
    const dmg = Math.max(1, Math.round(base * (crit ? f.critMult : 1)))
    return { dmg, crit }
  }

  /** 处理战斗中的输入命令 */
  handle(line, next) {
    if (!this.active) return next()
    const command = line.trim().toLowerCase()

    switch (command) {
      case 'a':
      case '1':
      case '攻击':
        return this.playerTurn('attack')
      case 'd':
      case '2':
      case '防御':
        return this.playerTurn('defend')
      case 'r':
      case '3':
      case '逃跑':
        return this.playerTurn('flee')
      case 'help':
      case '?':
        this.ctx.io.print('  战斗指令: a 攻击 | d 防御（减伤 50%）| r 逃跑 | help 帮助 | quit 退出')
        this.render()
        return { type: 'noop' }
      default:
        // 全局命令放行（名单集中在 plugins/lib/global-commands.js，审计 F2）。
        // 前提：#4 已把「重绘」与「重进场景」拆开，这些命令返回的 rerender 不再
        // 触发 scene/leave → 战斗状态不会被清空，敌人也不会满血重开。
        // 若回退 #4，下面这行必须一并收回，否则就是「敲个 help 敌人回血」。
        if (isGlobalCommand(command)) return next()
        // 其余输入维持拦截，但把「静默吞掉」变成「明确拒绝」（方案二保底）
        this.ctx.io.print(`  战斗中不可用：${line.trim() || '(空)'}（战斗指令: a 攻击 | d 防御 | r 逃跑 | help 帮助 | quit 退出）`)
        this.render()
        return { type: 'noop' }
    }
  }

  playerTurn(action) {
    const { enemy, battle } = this.active
    const me = this.playerStats

    // 1. 玩家行动
    if (action === 'flee') {
      if (Math.random() < this.formula.fleeChance) {
        this.ctx.io.print('  你成功脱身，逃之夭夭。')
        this.active = null
        if (battle.onFlee) { this.ctx.engine.goto(battle.onFlee); return { type: 'scene', id: battle.onFlee } }
        return { type: 'noop' }
      }
      this.ctx.io.print('  逃跑失败！敌人挡住了退路。')
    } else if (action === 'defend') {
      this.active.defending = true
      this.ctx.io.print('  你举盾防御，本回合受到的伤害将大幅减少。')
    } else {
      const { dmg, crit } = this.rollDamage(me, enemy)
      this.active.hp = Math.max(0, this.active.hp - dmg)
      this.lastRoll = { side: 'player', dmg, crit }
      this.ctx.emit(crit ? 'battle/crit' : 'battle/hit', 'player', dmg, crit)
      this.ctx.io.print(crit
        ? `  暴击！你对${enemy.name}造成 ${dmg} 点伤害！`
        : `  你对${enemy.name}造成 ${dmg} 点伤害。`)
      this.active.defending = false
    }

    // 2. 胜负判定
    if (this.active.hp <= 0) return this.finish(true, battle)

    // 3. 敌人反击
    const incoming = this.rollDamage(enemy, me)
    const cut = this.active?.defending ? this.formula.defendCut : 1
    const taken = Math.max(1, Math.round(incoming.dmg * cut))
    this.ctx.state.apply({ hp: -taken })
    this.lastRoll = { side: 'enemy', dmg: taken, crit: incoming.crit }
    this.ctx.emit(incoming.crit ? 'battle/crit' : 'battle/hit', 'enemy', taken, incoming.crit)
    this.ctx.io.print(incoming.crit
      ? `  ${enemy.name}暴击！你受到 ${taken} 点伤害！`
      : `  ${enemy.name}反击，你受到 ${taken} 点伤害。`)
    this.active.defending = false

    // 4. 玩家阵亡判定
    if ((this.ctx.state.get('hp') ?? 0) <= 0) return this.finish(false, battle)

    this.active.turn++
    this.render()
    return { type: 'noop' }
  }

  /** 战斗结束：结算掉落 + 跳转分支 */
  finish(isWin, battle) {
    const { enemy } = this.active
    this.ctx.emit('battle/end', isWin, enemy)
    if (isWin && enemy.drops) {
      const changes = this.ctx.state.apply(enemy.drops)
      for (const { path, from, to } of changes) {
        this.ctx.io.print(`  战利品：${path} ${from ?? '无'} → ${to}`)
      }
    }
    this.ctx.io.print(isWin ? `  你击败了${enemy.name}！` : `  你被${enemy.name}击倒了...`)
    this.active = null
    const target = isWin ? battle.onWin : battle.onLose
    if (target) {
      this.ctx.engine.goto(target)
      return { type: 'scene', id: target }
    }
    return { type: 'noop' }
  }

  /** 渲染战斗界面（血条 + 玩家状态） */
  render() {
    if (!this.active) return
    const { enemy, hp, maxHp, turn } = this.active
    const bar = (current, max, width = 20) => {
      const filled = Math.max(0, Math.round((current / max) * width))
      return '█'.repeat(filled) + '░'.repeat(width - filled)
    }
    const me = this.playerStats
    const myHp = this.ctx.state.get('hp')
    const myMaxHp = this.ctx.state.get('maxHp') ?? myHp
    const bonus = me.bonus.length ? ` (ATK ${me.atk} 含${me.bonus.join(',')})` : ''
    this.ctx.io.blank()
    this.ctx.io.print(`  ⚔ 第 ${turn} 回合`)
    this.ctx.io.print(`  ${enemy.name.padEnd(8, '　')} ${bar(hp, maxHp)} ${hp}/${maxHp}`)
    this.ctx.io.print(`  ${String(this.ctx.state.get('name')).padEnd(8, '　')} ${bar(myHp, myMaxHp)} ${myHp}/${myMaxHp}${bonus}`)
    this.ctx.io.blank()
    this.ctx.io.print('  指令: [a] 攻击   [d] 防御   [r] 逃跑   [help] 帮助')
    this.ctx.io.blank()
  }
}

export default CombatService
