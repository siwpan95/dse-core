// 引擎 SDK —— 编程式入口（宿主程序 / 测试 / 工具链用）
//
// 引擎化之前，想驱动这个引擎只有一条路：`node game.js`（交互式）或
// `dse play --input`（脚本式），二者都以「进程 + 终端」为前提。
// SDK 把这层壳剥掉：宿主可以是 Web 服务、桌面应用、CI 脚本、另一个 Node 程序。
//
//   import { createEngine, analyze, loadPacks } from 'dse-core'
//   const ctx = await createEngine({ root: './my-game', input: '1,1' })
//   ctx.state.get('gold')
//
// 约定：SDK 不改变引擎行为，只是把 boot / 字典 / 图分析 / 注册表收成一个门面。

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, join } from 'node:path'
import { analyze } from '../lib/graph.mjs'
import { loadPacks } from '../lib/registry.mjs'

/** 引擎根目录（本模块 sdk/ 的上一级） */
export const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export { boot } from '../lib/boot.js'
export { loadDict, sceneChars, isEnding } from '../lib/dict.mjs'
export {
  analyze, reachableFrom, shortestPath, edgesOf, isEnding as isEndingScene,
} from '../lib/graph.mjs'
export {
  loadPacks, discoverPacks, normalizeManifest, validateManifest, readPackFiles,
} from '../lib/registry.mjs'
export {
  MODE_REGISTRY, registerMode, modeEdges, modeEdgeTable, modeNames, isKnownMode,
  isSpecialGoto, resolveGoto, SPECIAL_GOTO, LOOP_PREFIX,
} from '../lib/modes.mjs'

/** 引擎版本号（读 package.json，避免与包版本漂移） */
export async function version() {
  const pkg = JSON.parse(await readFile(join(engineRoot, 'package.json'), 'utf8'))
  return pkg.version
}

/**
 * 编程式启动引擎
 *
 * @param {object} options
 * @param {string} [options.root]     项目根（含 cordis.yml），缺省为本引擎目录
 * @param {string} [options.entry]    覆盖入口场景（等价于 DSE_ENTRY）
 * @param {string|string[]} [options.input] 脚本输入序列（用尽后引擎自动退出）
 * @param {boolean} [options.banner=true]   是否打印启动横幅
 * @param {boolean} [options.quiet=false]   是否关闭插件加载日志
 * @param {boolean} [options.mute=true]     是否静音（SDK 场景默认静音，避免宿主被音效子进程打扰）
 * @returns {Promise<import('cordis').Context>} 根 Context（ctx.state / ctx.scenes / ctx.engine …）
 */
export async function createEngine(options = {}) {
  const { root = engineRoot, entry, input, banner = false, quiet = true, mute = true } = options
  if (entry) process.env.DSE_ENTRY = String(entry)
  if (input !== undefined) {
    process.env.DSE_INPUT = Array.isArray(input) ? input.join(',') : String(input)
  } else if (options.interactive) {
    delete process.env.DSE_INPUT
  }
  if (mute) process.env.DSE_MUTE = '1'

  const { boot } = await import('../lib/boot.js')
  return boot({ root, banner, quiet })
}

/**
 * 只读地分析一个内容项目（不启动引擎、不占 stdin）
 * @param {string} [root] 项目根
 */
export async function inspectProject(root = engineRoot) {
  const { dict, ids, packFiles, entry } = await (await import('../lib/dict.mjs')).loadDict(root)
  const report = analyze(dict, entry)
  const packs = await loadPacks(root).catch(() => [])
  return {
    root,
    entry,
    packFiles,
    packs: packs.map((p) => p.manifest),
    scenes: ids.length,
    endings: report.endings.length,
    endingsReachable: report.endingsReachable.length,
    unreachable: report.unreachable,
    dangling: report.dangling,
  }
}
