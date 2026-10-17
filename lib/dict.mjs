// 场景字典离线加载器（CLI 用）
//
// 用途：让 `dse scenes` / `dse info` 这类只读命令不必启动整个引擎
// （不进主循环、不占用 stdin），直接读 cordis.yml + 合并内容包即可。
// 与 lint-content.mjs 走同一份配置，避免两处解析逻辑漂移。

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { load as loadYaml } from 'js-yaml'

/** 从 cordis.yml 插件清单里取出指定 id 的插件条目 */
function findPluginEntry(manifest, id) {
  const list = Array.isArray(manifest) ? manifest : []
  return list.find((item) => item && item.id === id)
}

/**
 * 加载场景字典
 * @param {string} cwd 项目根目录
 * @returns {Promise<{ dict: object, ids: string[], packFiles: string[], entry: string, config: object }>}
 */
export async function loadDict(cwd = process.cwd()) {
  const raw = await readFile(resolve(cwd, 'cordis.yml'), 'utf8')
  const manifest = loadYaml(raw)

  const scenesEntry = findPluginEntry(manifest, 'scenes')
  const engineEntry = findPluginEntry(manifest, 'engine')
  if (!scenesEntry) throw new Error('cordis.yml 中未找到 scenes 插件条目')

  const packFiles = scenesEntry.config?.packs ?? []
  const dict = {}
  for (const p of packFiles) {
    const url = pathToFileURL(resolve(cwd, p)).href
    const mod = await import(url)
    // 同 ID 后者覆盖前者（与 scenes 插件的叠加语义一致）
    Object.assign(dict, mod.default ?? mod)
  }

  return {
    dict,
    ids: Object.keys(dict),
    packFiles,
    entry: engineEntry?.config?.entry ?? 'start',
    config: scenesEntry.config ?? {},
  }
}

/** 场景正文长度（title + text + 各选项文本），与校验器口径一致 */
export function sceneChars(scene) {
  const choices = scene?.choices ?? []
  return (scene?.title ?? '').length + (scene?.text ?? '').length +
    choices.reduce((n, c) => n + (c?.text ?? '').length, 0)
}

/** 结局判定：无选项，或所有选项都是重开入口（@ 开头） */
export function isEnding(scene) {
  const choices = scene?.choices ?? []
  if (scene?.mode && scene.mode !== 'normal') return false
  return choices.length === 0 || choices.every((c) => String(c?.goto ?? '').startsWith('@'))
}
