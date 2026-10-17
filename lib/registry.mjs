// 内容包注册表（manifest）
//
// 引擎化之前：内容包只是一个「导出场景字典的 ESM 模块」，包本身没有身份 ——
// 不知道作者、版本、入口场景、依赖哪些模式与状态字段，也没法被工具链列举。
//
// 引擎化之后：内容包可以在模块里额外导出一份 `pack` 元数据（可选，缺省即
// 从文件推导出最小信息），由本模块统一读取、校验、列举。CLI 的 `dse packs`、
// 校验器、文档生成器都从这里取，避免各工具各解析一遍。
//
// 约定（content/<name>.js）：
//   export const pack = {
//     id: 'starter',            // 包 ID（缺省取文件名）
//     name: '启程',             // 展示名
//     version: '0.1.0',
//     entry: 'start',           // 本包推荐入口（缺省取第一个场景）
//     description: '……',
//     modes: ['battle'],        // 用到了哪些 scene.mode
//     requires: {               // 依赖声明（骨架：供 lint / 宿主预检消费）
//       plugins: ['combat'],    // 需要哪些能力插件接管
//       state: ['gold'],        // 需要 state.initial 预声明哪些顶层字段
//     },
//   }
//   export default { ...场景字典 }

import { readdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { basename, join, resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { modeNames } from './modes.mjs'

const stripExt = (file) => basename(file).replace(/\.(js|mjs|cjs|json|ya?ml)$/i, '')

/** 从 cordis.yml 读取 scenes 插件声明的内容包列表 */
export async function readPackFiles(cwd = process.cwd()) {
  const raw = await readFile(resolve(cwd, 'cordis.yml'), 'utf8')
  const manifest = loadYaml(raw)
  const list = Array.isArray(manifest) ? manifest : []
  const scenesEntry = list.find((item) => item?.id === 'scenes')
  return scenesEntry?.config?.packs ?? []
}

/**
 * 加载全部内容包（含 manifest 与场景字典）
 * @param {string} cwd 项目根
 * @returns {Promise<Array<{ file: string, id: string, manifest: object, scenes: object, count: number }>>}
 */
export async function loadPacks(cwd = process.cwd()) {
  const files = await readPackFiles(cwd)
  const packs = []
  for (const file of files) {
    const mod = await import(pathToFileURL(resolve(cwd, file)).href)
    const scenes = mod.default ?? {}
    const manifest = normalizeManifest(mod.pack ?? {}, file, scenes)
    packs.push({ file, id: manifest.id, manifest, scenes, count: Object.keys(scenes).length })
  }
  return packs
}

/** 补齐 manifest 缺省字段（id 取文件名，entry 取首个场景，modes 自动探测） */
export function normalizeManifest(raw, file, scenes = {}) {
  const id = String(raw.id ?? stripExt(file))
  const ids = Object.keys(scenes)
  const modes = new Set(raw.modes ?? [])
  for (const scene of Object.values(scenes)) {
    if (scene?.mode) modes.add(scene.mode)
  }
  return {
    id,
    name: raw.name ?? id,
    version: raw.version ?? '0.0.0',
    entry: raw.entry ?? ids[0] ?? null,
    description: raw.description ?? '',
    author: raw.author ?? '',
    modes: [...modes].sort(),
    requires: {
      plugins: raw.requires?.plugins ?? [],
      state: raw.requires?.state ?? [],
    },
    scenes: ids.length,
  }
}

/** 校验 manifest，返回问题列表（空数组 = 合法） */
export function validateManifest(manifest) {
  const problems = []
  if (!manifest || typeof manifest !== 'object') return ['manifest 不是对象']
  if (!/^[a-z][a-z0-9_-]*$/.test(String(manifest.id ?? ''))) {
    problems.push(`id "${manifest.id}" 不符合命名规范（小写字母开头，仅 a-z 0-9 _ -）`)
  }
  if (manifest.version != null && !/^\d+\.\d+\.\d+/.test(String(manifest.version))) {
    problems.push(`version "${manifest.version}" 不是语义化版本`)
  }
  for (const mode of manifest.modes ?? []) {
    if (!modeNames().includes(mode)) problems.push(`引用了未注册的模式 "${mode}"`)
  }
  return problems
}

/** 列出 content/ 目录下所有可用内容包文件（含未挂到 cordis.yml 的） */
export async function discoverPacks(cwd = process.cwd(), dir = 'content') {
  const base = resolve(cwd, dir)
  let files = []
  try {
    files = (await readdir(base)).filter((f) => /\.(js|mjs)$/i.test(f))
  } catch {
    return []
  }
  const declared = await readPackFiles(cwd).catch(() => [])
  return files.map((f) => ({
    file: join(dir, f),
    enabled: declared.includes(join(dir, f)) || declared.includes('./' + join(dir, f)),
  }))
}
