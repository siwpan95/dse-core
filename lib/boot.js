// 引擎启动器（game.js 与 cli.js 共用）
//
// 抽出成模块的原因：CLI 需要在启动前设置环境变量（如 DSE_INPUT 脚本输入），
// 再走同一套启动流程，避免"游戏"与"命令行"两套启动代码漂移。
//
// 架构对齐 Cordis 官方 bin.js 模式：
//   1. 创建根 Context（服务容器）
//   2. 挂载 Loader 插件（提供 ctx.loader 声明式加载能力）
//   3. 通过 @cordisjs/plugin-include 加载 ./cordis.yml 插件清单

import { Context } from 'cordis'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 项目根 = 本模块（lib/）的上一级，固定锚点。
// 此前用 process.cwd()：`dse play` 在项目外目录运行会崩
// （"config file not found: <cwd>/cordis.yml"），而同 CLI 的 scenes/info
// 却绑模块目录 —— 同一命令两种根解析（见 deliverables 硬编码审计 F1）。
// include 插件会把 ctx.baseUrl 再精确到 cordis.yml 所在目录，两者一致。
const root = fileURLToPath(new URL('..', import.meta.url))

/**
 * 启动引擎（加载 cordis.yml 声明的全部插件并进入主循环）
 * @param {{ banner?: boolean, quiet?: boolean, root?: string }} options
 *        banner: 是否打印启动横幅（CLI 非交互模式下可关掉，便于机器解析输出）
 *        root:   项目根（含 cordis.yml）。缺省为引擎自身目录；宿主程序可用它
 *                 指向自己的内容项目，从而「一个引擎驱动多个游戏」。
 */
export async function boot(options = {}) {
  const { banner = true, quiet = false, root: rootOverride } = options
  const projectRoot = rootOverride ?? root
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(projectRoot).href + '/'

  if (banner) {
    // 全检 M1：版本从 package.json 读取，避免横幅与包版本漂移
    // （此前横幅硬编码 v0.1.0，而 package.json 已是 0.1.1）
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const title = `字 典 场 景 引 擎  v${version}`
    // 中日韩字符按 2 列宽计算，保证方框右边框对齐（框内可用宽度 42）
    const width = [...title].reduce((w, ch) => w + (ch.codePointAt(0) > 0x2e7f ? 2 : 1), 0)
    console.log('╔══════════════════════════════════════════╗')
    console.log(`║   ${title}${' '.repeat(Math.max(0, 39 - width))}║`)
    console.log('║   Dictionary Scene Engine (Cordis)       ║')
    console.log('╚══════════════════════════════════════════╝')
  }

  await ctx.plugin((await import('@cordisjs/plugin-loader')).default)
  await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: {
      path: './cordis.yml',
      enableLogs: !quiet,
    },
  })

  // 插件级 HMR（官方 @cordisjs/plugin-hmr，本地构建于 vendor/plugin-hmr）
  // 依赖 Node 内部模块加载器，必须以 --expose-internals 启动才可用。
  if (process.execArgv.includes('--expose-internals')) {
    await ctx.loader.create({
      name: './vendor/plugin-hmr/index.js',
      config: { root: ['.'], debounce: 200 },
    })
  } else if (banner) {
    console.log('ℹ  插件级 HMR 未启用：需 --expose-internals（npm run start:hmr）')
  }

  // 等待所有插件任务完成（加载失败只记日志不抛出）
  await ctx.loader.await()
  return ctx
}
