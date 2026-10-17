// 模式注册表（scene.mode 的唯一真源）
//
// 背景（原 dict-scene-engine 的已知坑）：新增一种 mode 时要改 4 个地方，其中
// lint-content.mjs 的 MODE_EDGES 与 tests/traverse.mjs 的 MODE_NEXT 是两份
// 互不共享的表，靠人工同步 —— 漏改一处即出现「lint 说可达、traverse 说不可达」。
//
// 引擎化做法：把模式契约收敛为一张可注册的表，所有消费者（引擎校验器 reach
// 分析、图遍历、CLI、文档）都从这里读。第三方能力插件在注册自己接管的 mode
// 时同时声明流转边，引擎侧零改动。

/** 特殊跳转目标（引擎语义，非场景） */
export const SPECIAL_GOTO = new Set(['@restart'])
export const LOOP_PREFIX = '@loop:'

/** @param {string} target */
export const isSpecialGoto = (target) =>
  SPECIAL_GOTO.has(target) || String(target).startsWith(LOOP_PREFIX)

/** 解出 @loop:<id> 的真实目标；普通目标原样返回 */
export function resolveGoto(target) {
  const raw = String(target ?? '')
  if (raw.startsWith(LOOP_PREFIX)) return raw.slice(LOOP_PREFIX.length)
  return raw
}

/**
 * 内置模式契约表：mode → { edges, plugin, desc }
 * edges = 该模式场景上「由插件控制流转」的跳转字段（参与悬空检查与可达性 BFS）
 */
export const MODE_REGISTRY = new Map(Object.entries({
  normal: { edges: [], plugin: null, desc: '引擎默认渲染：选项 + 结局判定' },
  battle: { edges: ['onWin', 'onLose', 'onFlee'], plugin: 'combat', desc: '回合制战斗' },
  trade: { edges: ['onEnd'], plugin: 'trade', desc: '经营/买卖（天数循环 + 行情）' },
  diary: { edges: ['onExit'], plugin: 'diary', desc: '日记回溯（只读重读已走过的篇目）' },
  dialogue: { edges: ['onEnd'], plugin: 'dialogue', desc: '对话/谈判（话题询问 + 注意点预算）' },
}))

/** 注册一个自定义模式（能力插件在自己 init 时调用，或在 cordis.yml 声明）
 *  @param {string} mode   模式名
 *  @param {{ edges?: string[], plugin?: string|null, desc?: string }} spec
 */
export function registerMode(mode, spec = {}) {
  const prev = MODE_REGISTRY.get(mode) ?? { edges: [], plugin: spec.plugin ?? null, desc: '' }
  MODE_REGISTRY.set(mode, {
    edges: spec.edges ?? prev.edges,
    plugin: spec.plugin ?? prev.plugin,
    desc: spec.desc ?? prev.desc,
  })
  return MODE_REGISTRY.get(mode)
}

/** 模式的流转边字段名（未注册模式返回空数组） */
export function modeEdges(mode) {
  return MODE_REGISTRY.get(mode)?.edges ?? []
}

/** 是否已知模式（未知模式会被校验器判为错误：多半是拼写错误） */
export function isKnownMode(mode) {
  return MODE_REGISTRY.has(mode ?? 'normal')
}

/** 全部已知模式名 */
export function modeNames() {
  return [...MODE_REGISTRY.keys()]
}

/** 兼容旧调用方：返回 { mode: [edges] } 形状的普通对象 */
export function modeEdgeTable() {
  const table = {}
  for (const [mode, spec] of MODE_REGISTRY) {
    if (spec.edges.length) table[mode] = [...spec.edges]
  }
  return table
}
