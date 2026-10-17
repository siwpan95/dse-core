// 路径安全守卫（被 scenes.js 与 hot-reload.js 共用，本身不是插件）
//
// 背景（全检报告 #12 / #16）：scenes.packs 与 hot-reload.paths 直接来自
// cordis.yml，若不做约束，`../../`、`file:///`、`node:fs`、绝对路径都能被
// import() 解析到项目之外。Node 自身只会拒绝远程 URL —— 那是兜底，不是控制。
//
// 规则（白名单，非黑名单）：
//   1. 必须是字符串且以 './' 开头（拒绝包说明符、node: 内置、绝对路径、URL）
//   2. resolve 后必须仍位于项目根目录内（拒绝 ../ 逃逸）

import { fileURLToPath } from 'node:url'
import { resolve, sep } from 'node:path'

/** 校验路径安全，返回解析后的绝对路径；不合法则抛错
 *  @param {string} path 待校验的（相对）路径
 *  @param {string} baseUrl 项目根的 file: URL（ctx.baseUrl）
 *  @param {string} label 用于错误信息的字段名
 */
export function assertInsideProject(path, baseUrl, label = '路径') {
  if (typeof path !== 'string' || !path.startsWith('./')) {
    throw new Error(`${label} 必须以 "./" 开头（拒绝包说明符、node: 内置模块、绝对路径与 URL）: ${String(path)}`)
  }
  const root = fileURLToPath(baseUrl).replace(/[\\/]+$/, '')
  const target = resolve(root, path)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`${label} 越出项目目录（拒绝 ../ 逃逸）: ${path} -> ${target}`)
  }
  return target
}
