// 内容热重载插件 —— 「改字典，游戏内即时生效」
//
// watch 内容包目录，.js 文件变化时（防抖后）：
//   1. 带时间戳重新 import（绕过 ESM 模块缓存）
//   2. ctx.scenes.reload(path) 重建场景字典（旧场景即时替换）
//   3. emit 'hot-reload/applied' 通知其他插件
//   4. ctx.io.wake('') 注入空输入 → 引擎立即用新字典重渲染当前场景
//
// 这正是 Cordis 论文「时空可组合性」的落地体验：运行时动态替换内容，
// 玩家状态（时间轴上的状态）完全保留，只有空间（场景字典）被更新。
//
// 注意：官方 @cordisjs/plugin-hmr 尚未发布到 npm 且要求 --expose-internals
// 内部 API；本插件只用公开 API 实现文字游戏最常用的「内容热重载」场景。

import { Service } from 'cordis'
import { watch } from 'chokidar'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertInsideProject } from './lib/safe-path.js'

export const name = 'hot-reload'

export class HotReloadService extends Service {
  static inject = ['scenes', 'io']

  constructor(ctx, config) {
    super(ctx, 'hot-reload')
    this.config = config
  }

  [Service.init]() {
    // 路径白名单：只监听项目内的目录（见 plugins/lib/safe-path.js）
    const paths = (this.config.paths ?? ['./content'])
      .map((p) => assertInsideProject(p, this.ctx.root.baseUrl, '热重载监听路径'))
    const watcher = watch(paths, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
    })
    // close() 是异步的：必须 await，否则 FSWatcher 句柄残留会让进程退出后仍挂住
    this.ctx.root.effect(() => async () => { await watcher.close() })

    let timer = null
    watcher.on('all', (event, file) => {
      if (!file.endsWith('.js')) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        this.apply(file).catch((error) => this.ctx.logger('hot-reload').error(error))
      }, this.config.debounce ?? 200)
    })
    this.ctx.logger('hot-reload').info('watching %s', paths.join(', '))
  }

  async apply(file) {
    // 转为配置里 packs 的相对路径形式（./content/xxx.js，正斜杠）。
    // 基准是 ctx 根（include 锚定的项目根）而非 process.cwd()：
    // 从项目外目录启动时 cwd ≠ 项目根，relative(cwd, file) 会得到
    // 一串 ../.. 前缀，导致 scenes.reload 找不到该包而热更静默失效（审计 F1）。
    const root = fileURLToPath(this.ctx.root.baseUrl)
    const rel = './' + relative(root, file).replaceAll('\\', '/')
    const ok = await this.ctx.scenes.reload(rel)
    if (!ok) return
    this.ctx.io.print(`  ⚡ 内容已热更新：${rel}（场景总数 ${this.ctx.scenes.size}）`)
    this.ctx.emit('hot-reload/applied', rel)
    this.ctx.io.wake('')
  }
}

export default HotReloadService
