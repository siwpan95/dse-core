// 场景图分析（纯函数，不依赖运行时）
//
// 从「场景字典 + 入口」出发做静态图分析：可达性、结局、悬空边、入度、深度。
// 引擎化之前这些逻辑散落在 scripts/lint-content.mjs 与 tests/traverse.mjs 里
// 各写一份（BFS 口径还不一致），现在收敛到一处，两个消费者共用。

import { isSpecialGoto, resolveGoto, modeEdges } from './modes.mjs'

/** 结局判定：normal 模式且无选项，或所有选项都是特殊目标（@restart 等） */
export function isEnding(scene) {
  if (!scene) return false
  if (scene.mode && scene.mode !== 'normal') return false
  const choices = scene.choices ?? []
  return choices.length === 0 || choices.every((c) => String(c?.goto ?? '').startsWith('@'))
}

/** 单个场景的全部出边（选项 goto + 模式流转边） */
export function edgesOf(id, scene) {
  const out = []
  for (const choice of scene?.choices ?? []) {
    const raw = String(choice?.goto ?? '')
    if (!raw) continue
    const target = resolveGoto(raw)
    if (!target || target.startsWith('@')) continue // @restart 不参与可达
    out.push({ from: id, to: target, kind: 'choice', raw })
  }
  for (const key of modeEdges(scene?.mode ?? 'normal')) {
    const target = scene?.[scene.mode]?.[key]
    if (target !== undefined) {
      out.push({ from: id, to: String(target), kind: 'mode', raw: `${scene.mode}.${key}` })
    }
  }
  return out
}

/** 从 entry 出发 BFS，返回 { reachable, order, depth } */
export function reachableFrom(dict, entry) {
  const reachable = new Set()
  const depth = new Map()
  const queue = [[entry, 0]]
  while (queue.length) {
    const [id, d] = queue.shift()
    if (reachable.has(id) || !(id in dict)) continue
    reachable.add(id)
    depth.set(id, d)
    for (const edge of edgesOf(id, dict[id])) {
      if (!reachable.has(edge.to)) queue.push([edge.to, d + 1])
    }
  }
  return { reachable, order: [...reachable], depth }
}

/** 全图分析：可达性 + 悬空 + 结局 + 入度统计 */
export function analyze(dict, entry) {
  const { reachable, order, depth } = reachableFrom(dict, entry)
  const dangling = []
  const endingIds = []
  const inDegree = new Map()

  for (const [id, scene] of Object.entries(dict)) {
    if (isEnding(scene)) endingIds.push(id)
    for (const edge of edgesOf(id, scene)) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
      if (!(edge.to in dict)) {
        dangling.push({ from: id, to: edge.to, kind: edge.kind, raw: edge.raw })
      }
    }
    // 特殊目标自身的合法性（@loop: 目标必须存在）
    for (const choice of scene?.choices ?? []) {
      const raw = String(choice?.goto ?? '')
      if (raw.startsWith('@') && !isSpecialGoto(raw)) {
        dangling.push({ from: id, to: raw, kind: 'special', raw })
      } else if (raw.startsWith('@loop:')) {
        const target = resolveGoto(raw)
        if (!(target in dict)) dangling.push({ from: id, to: target, kind: 'loop', raw })
      }
    }
  }

  const unreachable = Object.keys(dict).filter((id) => !reachable.has(id))
  return {
    scenes: Object.keys(dict).length,
    reachable,
    reachableCount: reachable.size,
    unreachable,
    order,
    depth,
    dangling,
    endings: endingIds,
    endingsReachable: endingIds.filter((id) => reachable.has(id)),
    deadEnds: order.filter((id) => (inDegree.get(id) ?? 0) === 0 && id !== entry),
  }
}

/** 从 entry 到指定场景的一条最短路径（供测试生成"直达路线"） */
export function shortestPath(dict, entry, targetId) {
  const prev = new Map()
  const queue = [entry]
  const seen = new Set([entry])
  while (queue.length) {
    const id = queue.shift()
    if (id === targetId) break
    for (const edge of edgesOf(id, dict[id])) {
      if (seen.has(edge.to)) continue
      seen.add(edge.to)
      prev.set(edge.to, id)
      queue.push(edge.to)
    }
  }
  if (!seen.has(targetId)) return null
  const path = [targetId]
  while (path[0] !== entry) path.unshift(prev.get(path[0]))
  return path
}
