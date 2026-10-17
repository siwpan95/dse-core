// 玩家状态服务：属性/背包/标志位 + 效果执行 + 条件求值
//
// 效果（effects）语义 —— 一个普通对象：
//   { hp: -5 }            数值   → 加减
//   { 'name': '勇者' }     字符串 → 赋值
//   { 'flags.metKing': true }  点路径 → 深层赋值
//   { 'items.sword': +1 } 点路径 + 数值 → 深层计数
//
// 条件（if）语义 —— 一个字符串表达式，用 new Function 求值：
//   'hp >= 10 && gold > 0'      'items.sword >= 1'      '!flags.doorLocked'
//
// ⚠️ 这不是沙箱。new Function 的作用域参数不构成任何隔离 —— 裸标识符
// `process`、`globalThis.fetch` 等全局对象在表达式里直接可达，无需任何
// "逃逸"技巧。触发面仅限内容包、cordis.yml 的 when 字段与敌人 drops；
// 玩家在终端里输入的内容不会进入这里。因此信任边界是：**只运行可信内容包**。

import { Service } from 'cordis'

export const name = 'state'

/** 危险路径段：写入这些段会污染 Object.prototype（原型污染） */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const hasUnsafeKey = (path) => String(path).split('.').some((key) => UNSAFE_KEYS.has(key))

export class StateService extends Service {
  static inject = []

  constructor(ctx, config) {
    super(ctx, 'state')
    this.config = config
    /** 深层快照，用于存档 */
    this.data = structuredClone(config.initial ?? {})
  }

  /** 读取点路径，如 'items.sword'；缺失或危险路径返回 undefined */
  get(path) {
    if (hasUnsafeKey(path)) return undefined
    return path.split('.').reduce((obj, key) => obj?.[key], this.data)
  }

  /** 写入点路径（自动创建中间对象）
   *  @returns {boolean} 是否写入成功（危险路径会被拒绝）
   */
  set(path, value) {
    if (hasUnsafeKey(path)) {
      this.ctx.logger('state').warn('拒绝写入危险路径（原型污染防护）: %s', path)
      return false
    }
    const keys = path.split('.')
    let obj = this.data
    while (keys.length > 1) {
      const key = keys.shift()
      if (typeof obj[key] !== 'object' || obj[key] === null) obj[key] = {}
      obj = obj[key]
    }
    obj[keys[0]] = value
    return true
  }

  /** 执行一个效果对象，返回变更记录 [{ path, from, to }]
   *  被拒绝的路径（如 __proto__）不会产生变更记录，也不会污染状态
   */
  apply(effects) {
    const changes = []
    if (!effects) return changes
    for (const [path, value] of Object.entries(effects)) {
      const from = this.get(path)
      let to = value
      if (typeof value === 'number' && typeof from === 'number') {
        to = from + value
      } else if (typeof value === 'number' && from === undefined) {
        to = value
      }
      if (!this.set(path, to)) continue // 被原型污染防护拒绝
      changes.push({ path, from, to })
    }
    return changes
  }

  /** 求值条件表达式；无条件时恒真；异常按 false 处理并告警
   *  @param {string} expr 表达式（基于状态作用域）
   *  @param {object} extra 附加上下文（如 { scene, choice, effects }），合并进作用域
   */
  check(expr, extra = {}) {
    if (expr === undefined || expr === null || expr === '') return true
    try {
      const fn = new Function('with (this) { return (' + expr + ') }')
      return !!fn.call({ ...this.view(), ...extra })
    } catch (error) {
      this.ctx.logger('state').warn('条件求值失败 "%s": %s', expr, error.message)
      return false
    }
  }

  /** 扁平化状态视图：把 items.sword 暴露为 items.sword 可访问的对象 */
  view() {
    const build = (obj) => {
      if (obj === null || typeof obj !== 'object') return obj
      if (Array.isArray(obj)) return obj
      const proxy = {}
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && typeof value === 'object') {
          proxy[key] = build(value)
        } else {
          proxy[key] = value
        }
      }
      return proxy
    }
    return build(this.data)
  }

  /** 用状态值插值文本：'你好，{name}！' */
  interpolate(text) {
    return String(text).replace(/\{([\w.]+)\}/g, (raw, path) => {
      const value = this.get(path)
      return value === undefined ? raw : String(value)
    })
  }

  /** 重置状态为 initial 快照
   *  @param {{ keep?: string[] }} [options] keep：点路径前缀数组。重置后，
   *        旧状态中命中前缀的字段被回填（递归合并子树），用于时间循环的
   *        "知识跨轮保留"（见 CONTENT-EXPANSION-PLAN §16.2）。
   *        缺省/空数组 = 全量重置（@restart 语义不变）。
   */
  reset({ keep = [] } = {}) {
    const old = this.data
    this.data = structuredClone(this.config.initial ?? {})
    if (!keep.length) return
    // 收集旧状态中命中 keep 前缀的子树（命中即整棵保留，不再下钻）
    const kept = []
    const collect = (obj, base = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const path = base ? `${base}.${key}` : key
        if (keep.some((p) => path === p || path.startsWith(p + '.'))) {
          kept.push([path, value])
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          collect(value, path)
        }
      }
    }
    collect(old)
    // 用 set 回填（复用原型污染防护与中间对象创建）
    for (const [path, value] of kept) this.set(path, structuredClone(value))
  }

  snapshot() {
    return structuredClone(this.data)
  }

  restore(data) {
    this.data = structuredClone(data)
  }
}

export default StateService
