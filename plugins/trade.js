// 经营数值系统插件 —— 天数循环 + 库存买卖 + 确定性行情日程（引擎零改动）
//
// 接入方式：场景字典声明 mode: 'trade' + trade: { onEnd: '...' }
//   引擎遇非 normal 模式 bail 'scene/mode'，本插件返回 true 宣告接管。
//   之后该场景输入由本插件处理（engine/command prepend 拦截），
//   经营结束（第 N 天过完）调用 engine.goto(trade.onEnd) 流转剧情。
//
// 设计原则：**确定性优先**（对照 combat 的随机性）——
//   每日行情由 cordis.yml 的 schedule 表写死（行=商品，列=第 N 天卖出价），
//   玩家可从前一天的行情与场景提示里推演，而不是赌随机数；
//   这让经营策略可计算、e2e 断言可精确复现。
//
// 状态：state.gold（资金，复用）、state.stock（库存 dict）、state.tradeDay（天数，存档可恢复）
// 命令：buy <商品> [数量] 进货 | sell <商品> [数量] 出货（默认全部）
//       next 下一天 | info 行情与库存 | 全局命令（quit/save/...）放行

import { Service } from 'cordis'
import { isGlobalCommand } from './lib/global-commands.js'

export const name = 'trade'

/** 商品表默认值（可被 cordis.yml 覆盖） */
export const DEFAULT_GOODS = {
  tea:   { name: '茶', buy: 8 },
  salt:  { name: '盐', buy: 4 },
  cloth: { name: '布', buy: 2 },
}

/** 默认 5 天行情（行=商品，列=第 1..5 天卖出价） */
export const DEFAULT_SCHEDULE = [
  [12, 10, 15, 12, 11],   // 茶：第 3 天茶会涨价
  [5, 7, 5, 6, 5],        // 盐：第 2 天雨天涨价
  [3, 3, 2, 4, 6],        // 布：第 5 天集市涨价
]

export class TradeService extends Service {
  static inject = ['state', 'engine', 'io']

  constructor(ctx, config) {
    super(ctx, 'trade')
    this.config = config
    this.goods = config.goods ?? DEFAULT_GOODS
    this.schedule = config.schedule ?? DEFAULT_SCHEDULE
    /** 商品 ID 顺序（按 goods 表声明顺序） */
    this.ids = Object.keys(this.goods)
    /** 当前经营：{ days, onEnd } */
    this.active = null
  }

  [Service.init]() {
    // 接管 trade 模式的场景
    this.ctx.on('scene/mode', (sceneId, scene, mode) => {
      if (mode !== 'trade') return false
      this.begin(scene.trade ?? {})
      return true
    }, { prepend: true })

    // 经营中优先处理输入（抢在 save / achievements 之前）
    this.ctx.on('engine/command', (line, choices, next) => this.handle(line, next), { prepend: true })

    // 场景文本渲染完成后补画经营面板
    this.ctx.on('scene/rendered', () => { if (this.active) this.render() })

    // 离开经营场景时清理（结算跳转时 active 已清，这里兜底）
    this.ctx.on('scene/leave', () => { this.active = null })

    this.ctx.logger('trade').info('loaded %d goods over %d days', this.ids.length, (this.schedule[0] ?? []).length)
  }

  /** 开市：初始化天数与本金基线（存档恢复时不重置）
   *  ⚠️ 天数用 set 而非 apply：apply 对数值是"加减"语义（1 + 2 = 3），
   *  赋值必须走 state.set（见 state.js 效果语义注释）。 */
  begin(trade) {
    const s = this.ctx.state
    if (s.get('tradeDay') == null) {
      s.set('tradeDay', 1)
      // 开市基线：记录进铺时的资金，收市时结算净赚（tradeProfit）
      s.set('tradeBaseGold', s.get('gold') ?? 0)
    }
    if (s.get('stock') == null) s.set('stock', {})
    for (const id of this.ids) {
      if (s.get(`stock.${id}`) == null) s.set(`stock.${id}`, 0)
    }
    // 场所名参数化（审计 F6）：此前"东市"写死在渲染/收市文案里，复用本插件做
    // 第二个经营 Mod 只能改代码。现在由场景 trade.name 声明（缺省兼容历史内容），
    // 也可用插件 config.place 全局覆盖。
    this.active = {
      days: trade.days ?? 5,
      onEnd: trade.onEnd,
      name: trade.name ?? this.config.place ?? '东市',
    }
  }

  /** 当前天（1 起） */
  get day() { return this.ctx.state.get('tradeDay') ?? 1 }

  /** 今日某商品的卖出价 */
  priceOf(id, day = this.day) {
    const idx = this.ids.indexOf(id)
    if (idx < 0) return null
    return (this.schedule[idx] ?? [])[day - 1] ?? 0
  }

  /** 处理经营中的输入命令 */
  handle(line, next) {
    if (!this.active) return next()
    const raw = line.trim()
    const [cmd, ...args] = raw.toLowerCase().split(/\s+/)

    switch (cmd) {
      case 'buy':
      case 'b':
      case '进货':
        return this.doBuy(args)
      case 'sell':
      case 's':
      case '出货':
        return this.doSell(args)
      case 'next':
      case 'n':
      case '过':
      case '下一天':
        return this.nextDay()
      case 'info':
      case 'i':
      case '行情':
        this.render()
        return { type: 'noop' }
      case 'help':
      case '?':
        this.ctx.io.print('  经营指令: buy <商品> [数量] 进货 | sell <商品> [数量] 出货（默认全部）| next 下一天 | info 行情 | quit 退出')
        this.render()
        return { type: 'noop' }
      default:
        // 全局命令放行（名单集中在 plugins/lib/global-commands.js，审计 F2）
        if (isGlobalCommand(raw)) return next()
        this.ctx.io.print(`  经营中不可用：${raw || '(空)'}（指令: buy 进货 | sell 出货 | next 下一天 | info 行情 | help 帮助）`)
        this.render()
        return { type: 'noop' }
    }
  }

  /** 进货：buy <商品> [数量]，数量默认 1 */
  doBuy(args) {
    const id = this.normalizeId(args[0])
    if (!id) return this.badGoods(args[0])
    const n = this.parseCount(args[1], 1)
    if (n <= 0) {
      this.ctx.io.print('  数量至少为 1。')
      this.render()
      return { type: 'noop' }
    }
    const cost = this.goods[id].buy * n
    const gold = this.ctx.state.get('gold') ?? 0
    // 防御纵深（全检 S-1）：非有限数一律不进状态机。注意 `gold < NaN` 恒为 false，
    // 单靠下面的「金币不够」判断拦不住 NaN，必须前置拦截。
    if (!Number.isFinite(cost) || !Number.isFinite(gold)) {
      this.ctx.io.print('  金额异常，交易已取消（未扣款）。')
      this.render()
      return { type: 'noop' }
    }
    if (gold < cost) {
      this.ctx.io.print(`  金币不够：${this.goods[id].name} 进价 ${this.goods[id].buy}，${n} 件需 ${cost} 金，你只有 ${gold} 金。`)
      this.render()
      return { type: 'noop' }
    }
    this.ctx.state.apply({ gold: -cost, [`stock.${id}`]: +n })
    this.ctx.io.print(`  进货：${this.goods[id].name} ×${n}（-${cost} 金），库存 ${this.ctx.state.get(`stock.${id}`)}。`)
    this.render()
    return { type: 'noop' }
  }

  /** 出货：sell <商品> [数量]，数量默认全部 */
  doSell(args) {
    const id = this.normalizeId(args[0])
    if (!id) return this.badGoods(args[0])
    const stock = this.ctx.state.get(`stock.${id}`) ?? 0
    if (stock <= 0) {
      this.ctx.io.print(`  没有库存：${this.goods[id].name} 一件都没有，先 buy 进货吧。`)
      this.render()
      return { type: 'noop' }
    }
    const n = this.parseCount(args[1], stock)
    // 全检 N9：doBuy 有 n<=0 校验而 doSell 漏了，负数数量会变成「反向交易」
    if (n <= 0) {
      this.ctx.io.print('  数量至少为 1。')
      this.render()
      return { type: 'noop' }
    }
    if (n > stock) {
      this.ctx.io.print(`  库存不够：${this.goods[id].name} 只有 ${stock} 件。`)
      this.render()
      return { type: 'noop' }
    }
    const price = this.priceOf(id)
    const earn = price * n
    // 同上：非有限数不进状态机
    if (!Number.isFinite(price) || !Number.isFinite(earn)) {
      this.ctx.io.print('  金额异常，出货已取消。')
      this.render()
      return { type: 'noop' }
    }
    this.ctx.state.apply({ gold: +earn, [`stock.${id}`]: -n })
    this.ctx.io.print(`  出货：${this.goods[id].name} ×${n} @ ${price} 金（+${earn} 金），库存 ${this.ctx.state.get(`stock.${id}`)}。`)
    this.render()
    return { type: 'noop' }
  }

  /** 下一天；过完最后一天则结算跳转 */
  nextDay() {
    const { days, onEnd } = this.active
    const cur = this.day
    if (cur >= days) {
      const s = this.ctx.state
      const base = s.get('tradeBaseGold') ?? 0
      const gold = s.get('gold') ?? 0
      s.set('tradeProfit', gold - base)
      this.ctx.io.print(`  第 ${days} 天收市。你带着 ${gold} 金走出${this.active.name}，比进铺时多出 ${gold - base} 金。`)
      s.set('tradeDay', null)
      this.active = null
      if (onEnd) {
        this.ctx.engine.goto(onEnd)
        return { type: 'scene', id: onEnd }
      }
      return { type: 'noop' }
    }
    this.ctx.state.set('tradeDay', cur + 1)
    this.ctx.io.print(`  第 ${this.day} 天，开市。`)
    this.render()
    return { type: 'noop' }
  }

  /** 商品 ID 归一：支持中文名 / 前缀缩写 */
  normalizeId(input) {
    if (!input) return null
    // 全检 S-1：必须用「自有属性」判断，不能写 `if (this.goods[input])`。
    // 后者会被原型链上的 __proto__ / constructor / toString 等命中（分别返回
    // Object.prototype 与函数，皆为 truthy），使非法 ID 通过校验，后续
    // this.goods[id].buy 取到 undefined → 金额为 NaN → 金币被永久污染。
    if (Object.prototype.hasOwnProperty.call(this.goods, input)) return input
    for (const [id, g] of Object.entries(this.goods)) {
      if (g.name === input) return id
    }
    for (const id of this.ids) {
      if (id.startsWith(input)) return id
    }
    return null
  }

  parseCount(text, fallback) {
    if (text == null) return fallback
    const n = Number(text)
    return Number.isFinite(n) ? Math.floor(n) : fallback
  }

  badGoods(input) {
    const list = this.ids.map((id) => `${this.goods[id].name}(${id})`).join(' / ')
    this.ctx.io.print(`  没有这种货：${input ?? '(空)'}。可交易：${list}`)
    this.render()
    return { type: 'noop' }
  }

  /** 渲染经营面板：天数 + 今日行情 + 资金库存 */
  render() {
    if (!this.active) return
    const s = this.ctx.state
    this.ctx.io.blank()
    this.ctx.io.print(`  ── ${this.active.name} · 第 ${this.day} 天 ──`)
    this.ctx.io.print(`  今日行情（卖出价）：`)
    for (const id of this.ids) {
      const g = this.goods[id]
      const price = this.priceOf(id)
      const stock = s.get(`stock.${id}`) ?? 0
      const trend = this.trendText(id)
      this.ctx.io.print(`    ${g.name.padEnd(4, '　')} 进 ${String(g.buy).padStart(2)} 金 | 今日卖 ${String(price).padStart(2)} 金${trend} | 库存 ${stock}`)
    }
    this.ctx.io.blank()
    this.ctx.io.print(`  资金 ${s.get('gold')} 金`)
    this.ctx.io.blank()
    this.ctx.io.print('  指令: buy <商品> [数量] 进货 | sell <商品> [数量] 出货 | next 下一天 | info 行情')
    this.ctx.io.blank()
  }

  /** 明天涨跌提示（对比明日价），第 N 天显示"最后一天" */
  trendText(id) {
    const { days } = this.active
    const cur = this.day
    if (cur >= days) return '（最后一天）'
    const today = this.priceOf(id, cur)
    const tomorrow = this.priceOf(id, cur + 1)
    if (tomorrow > today) return ' ↑ 明日看涨'
    if (tomorrow < today) return ' ↓ 明日看跌'
    return ' → 明日持平'
  }
}

export default TradeService
