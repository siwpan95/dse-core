#!/usr/bin/env node
// dict-scene-engine 命令行接口（CLI）
//
// 目标：让引擎能被脚本/CI 驱动，而不只有交互式这一种用法。
//   dse play   --input "3,1,1"    非交互跑一条线路（逗号分隔的输入序列）
//   dse scenes --json             只读地列出场景字典（不启动主循环）
//   dse info   --json             项目统计
//   dse check                     内容校验（复用 scripts/lint-content.mjs）
//   dse saves                     列出存档位
//
// 设计要点：
//   1. play 与 game.js 共用 lib/boot.js，不写第二套启动流程；
//   2. 非交互靠环境变量 DSE_INPUT 传给 console-io（输入用尽自动 quit，
//      走引擎正常退出流程，不会卡在等待输入上）；
//   3. scenes/info 用 lib/dict.mjs 离线读字典，不进主循环、不占 stdin。

import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)))

const HELP = `字典场景引擎 CLI (dse)

用法:
  dse play [--input "1,2,a"] [--entry <场景ID>] [--quiet]   启动游戏
  dse scenes [--json] [--scene <ID>]                         列出场景 / 查看单个场景
  dse info [--json]                                          项目统计
  dse check                                                  内容校验（lint:content）
  dse saves                                                  列出存档位
  dse new <包名> [--template=branch] [--ns=<命名空间>] [--register]  生成内容包骨架
  dse packs [--json]                                          列出内容包 manifest
  dse doctor                                                  环境自检（依赖/配置/内容图）
  dse help                                                   显示本帮助

play 选项:
  --input, -i   逗号分隔的输入序列（选项编号或引擎命令，如 stats/quit）。
                序列用尽后自动 quit 退出；不传则为交互式。
  --entry, -e   指定起始场景（默认取 cordis.yml 的 engine.entry）
  --quiet, -q   关闭启动横幅与插件加载日志，便于机器解析输出

示例:
  dse play --input "3,1,1,1"           # 走官道 → 篷车 → ... → 结局
  dse scenes --json | jq 'length'      # 场景总数
  dse info --json                      # 结构化统计
`

/** 解析 argv：支持 --key=value / --key value / -k value / 布尔旗 */
function parseArgs(argv) {
  const out = { _: [], flags: {} }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('-')) { out._.push(token); continue }
    const eq = token.indexOf('=')
    let key = token.replace(/^--?/, '')
    let value
    if (eq > -1) {
      value = token.slice(eq + 1)
      key = token.slice(0, eq).replace(/^--?/, '')
    } else if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
      value = argv[++i]
    } else {
      value = true
    }
    out.flags[key] = value
  }
  return out
}

// 错误提示与用法都走 stderr（与 git 等 CLI 惯例一致：stdout 只放"结果"，
// 便于 `dse scenes --json | jq` 这类管道消费不被诊断信息污染）
const fail = (msg, code = 1) => {
  process.stderr.write(`dse: ${msg}\n`)
  process.exitCode = code
}

// ---------- scenes ----------
async function cmdScenes(args) {
  const { loadDict, sceneChars, isEnding } = await import(pathToFileURL(resolve(root, 'lib/dict.mjs')).href)
  const { dict, ids, packFiles } = await loadDict(root)

  if (args.flags.json) {
    const payload = ids.map((id) => ({
      id,
      title: dict[id].title ?? '',
      mode: dict[id].mode ?? 'normal',
      choices: (dict[id].choices ?? []).length,
      chars: sceneChars(dict[id]),
      ending: isEnding(dict[id]),
    }))
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    return
  }

  if (args.flags.scene) {
    const id = String(args.flags.scene)
    if (!dict[id]) { fail(`场景 "${id}" 不存在`); return }
    const s = dict[id]
    process.stdout.write(`── ${s.title ?? id} ──\n`)
    process.stdout.write(`${s.text ?? ''}\n`)
    process.stdout.write(`\n模式: ${s.mode ?? 'normal'} | 选项: ${(s.choices ?? []).length} | 字符: ${sceneChars(s)}\n`)
    for (const [i, c] of (s.choices ?? []).entries()) {
      process.stdout.write(`  [${i + 1}] ${c.text}${c.if ? `  (if: ${c.if})` : ''} → ${c.goto}\n`)
    }
    if (s.battle) process.stdout.write(`  battle: ${JSON.stringify(s.battle)}\n`)
    if (s.trade) process.stdout.write(`  trade: ${JSON.stringify(s.trade)}\n`)
    return
  }

  process.stdout.write(`场景 ${ids.length} 个（内容包 ${packFiles.length}）\n\n`)
  const groups = new Map()
  for (const id of ids) {
    const ns = id.includes('.') ? id.split('.')[0] : '(顶层)'
    if (!groups.has(ns)) groups.set(ns, [])
    groups.get(ns).push(id)
  }
  for (const [ns, list] of groups) {
    process.stdout.write(`${ns}  (${list.length})\n`)
    for (const id of list) {
      const s = dict[id]
      const mark = isEnding(s) ? '⚑' : (s.mode && s.mode !== 'normal' ? '⚔' : ' ')
      process.stdout.write(`  ${mark} ${id.padEnd(28, ' ')} ${s.title ?? ''}\n`)
    }
    process.stdout.write('\n')
  }
  process.stdout.write('⚑ = 结局  ⚔ = 模式接管场景（battle/trade）\n')
}

// ---------- info ----------
async function cmdInfo(args) {
  const { loadDict, sceneChars, isEnding } = await import(pathToFileURL(resolve(root, 'lib/dict.mjs')).href)
  const { dict, ids, packFiles, entry } = await loadDict(root)

  let chars = 0
  let endings = 0
  const modes = new Set()
  for (const id of ids) {
    chars += sceneChars(dict[id])
    if (isEnding(dict[id])) endings++
    modes.add(dict[id].mode ?? 'normal')
  }

  const stats = {
    scenes: ids.length,
    packs: packFiles.length,
    packFiles,
    chars,
    avgChars: Math.round(chars / ids.length),
    endings,
    modes: [...modes].sort(),
    entry,
  }

  if (args.flags.json) {
    process.stdout.write(JSON.stringify(stats, null, 2) + '\n')
    return
  }
  process.stdout.write(`场景     ${stats.scenes}（内容包 ${stats.packs}）\n`)
  process.stdout.write(`正文字数 ${stats.chars}（均长 ${stats.avgChars}）\n`)
  process.stdout.write(`结局     ${stats.endings}\n`)
  process.stdout.write(`模式     ${stats.modes.join(', ')}\n`)
  process.stdout.write(`入口     ${stats.entry}\n`)
  process.stdout.write(`内容包   ${packFiles.join(', ')}\n`)
}

// ---------- check ----------
function cmdCheck() {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(root, 'scripts/lint-content.mjs')], {
      cwd: root, stdio: 'inherit',
    })
    child.on('exit', (code) => { process.exitCode = code ?? 1; done() })
  })
}

// ---------- saves ----------
/** 读取 save 插件配置的存档目录（与 plugins/save.js 的 config.dir 对齐，缺省 ./saves）。
 *  此前这里硬编码 resolve(root,'saves')：改了 cordis.yml 的 save.dir 后
 *  `dse saves` 会列错目录（审计 F9）。解析失败/无 save 条目时回退默认。 */
function readSaveDir() {
  try {
    const raw = readFileSync(resolve(root, 'cordis.yml'), 'utf8')
    const manifest = loadYaml(raw)
    const entry = (Array.isArray(manifest) ? manifest : []).find((item) => item?.id === 'save')
    const dir = entry?.config?.dir
    return typeof dir === 'string' && dir ? dir : './saves'
  } catch {
    return './saves'
  }
}

function cmdSaves() {
  const dir = resolve(root, readSaveDir())
  if (!existsSync(dir)) { process.stdout.write('（暂无存档）\n'); return }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  if (!files.length) { process.stdout.write('（暂无存档）\n'); return }
  process.stdout.write(`存档位 ${files.length} 个：\n`)
  for (const f of files) process.stdout.write(`  ${f.slice(0, -5)}\n`)
}

// ---------- new（内容包脚手架）----------
/** 可用模板（与 templates/ 目录一一对应） */
const TEMPLATES = ['branch', 'hub', 'loop', 'battle', 'trade', 'diary', 'dialogue']

async function cmdNew(args) {
  const name = args._[0] ?? args.flags.name
  const template = String(args.flags.template ?? args.flags.t ?? 'branch')
  if (!name) {
    fail(`缺少包名。用法: dse new <包名> [--template=${TEMPLATES.join('|')}]`)
    return
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(String(name))) {
    fail(`包名 "${name}" 不合法（小写字母开头，仅 a-z 0-9 _ -）`)
    return
  }
  if (!TEMPLATES.includes(template)) {
    fail(`未知模板 "${template}"（可用: ${TEMPLATES.join(', ')}）`)
    return
  }
  const ns = String(args.flags.ns ?? args.flags.namespace ?? name.replace(/[-_]/g, ''))
  const src = resolve(root, 'templates', `${template}.js`)
  const target = resolve(root, 'content', `${name}.js`)
  if (existsSync(target)) { fail(`内容包已存在: content/${name}.js`); return }

  const code = readFileSync(src, 'utf8')
    .replaceAll('__PACK_ID__', name)
    .replaceAll('__NS__', ns)
  writeFileSync(target, code, 'utf8')
  process.stdout.write(`已生成 content/${name}.js（模板: ${template}，命名空间: ${ns}）\n`)
  process.stdout.write(`  填充入口: ${ns}.start 之类（模板里全是 TODO，照着替换即可）\n`)

  // --register：把包挂进 cordis.yml 的 packs 列表（文本插入，保住原有注释）
  if (args.flags.register) {
    try {
      const file = resolve(root, 'cordis.yml')
      let raw = readFileSync(file, 'utf8')
      const line = `      - ./content/${name}.js`
      if (raw.includes(line)) {
        process.stdout.write('  cordis.yml 已含该包，跳过注册\n')
      } else {
        raw = raw.replace(/^(\s*)packs:.*$(?:\n(?:\1\s+- .*$|\s*#.*$|\s*$))*/m, (block) => `${block}\n${line}`)
        writeFileSync(file, raw, 'utf8')
        process.stdout.write(`  已挂到 cordis.yml 的 scenes.config.packs: ${line.trim()}\n`)
      }
    } catch (error) {
      fail(`写入 cordis.yml 失败: ${error.message}`)
    }
  } else {
    process.stdout.write(`  手动挂载: 在 cordis.yml 的 scenes.config.packs 加一行 "- ./content/${name}.js"\n`)
  }
  process.stdout.write(`  校验: dse check\n`)
}

// ---------- packs（内容包 manifest 清单）----------
async function cmdPacks(args) {
  const { loadPacks, discoverPacks, validateManifest } = await import(pathToFileURL(resolve(root, 'lib/registry.mjs')).href)
  const [packs, found] = await Promise.all([
    loadPacks(root).catch(() => []),
    discoverPacks(root).catch(() => []),
  ])
  if (args.flags.json) {
    process.stdout.write(JSON.stringify(packs.map((p) => ({ file: p.file, ...p.manifest, scenes: p.count })), null, 2) + '\n')
    return
  }
  if (!packs.length) { process.stdout.write('（cordis.yml 未挂任何内容包）\n'); return }
  process.stdout.write(`已挂载 ${packs.length} 个内容包（content/ 下共 ${found.length} 个文件）\n\n`)
  for (const p of packs) {
    const m = p.manifest
    const problems = validateManifest(m)
    process.stdout.write(`${m.id.padEnd(16)} v${m.version}  场景 ${String(p.count).padStart(3)}  入口 ${m.entry ?? '-'}\n`)
    process.stdout.write(`  ${m.name}${m.description ? ' — ' + m.description : ''}\n`)
    if (m.modes.length) process.stdout.write(`  模式: ${m.modes.join(', ')}\n`)
    if (m.requires.plugins.length) process.stdout.write(`  依赖插件: ${m.requires.plugins.join(', ')}\n`)
    for (const problem of problems) process.stderr.write(`  ⚠ manifest: ${problem}\n`)
  }
  const disabled = found.filter((f) => !f.enabled)
  if (disabled.length) {
    process.stdout.write(`\n未挂载: ${disabled.map((d) => d.file).join(', ')}\n`)
  }
}

// ---------- doctor（环境自检）----------
async function cmdDoctor() {
  const checks = []
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail })

  add('Node 版本 >= 22', Number(process.versions.node.split('.')[0]) >= 22, process.versions.node)
  add('依赖已安装 (node_modules/cordis)', existsSync(resolve(root, 'node_modules/cordis')))
  add('插件清单 cordis.yml', existsSync(resolve(root, 'cordis.yml')))

  let dict = null
  let entry = 'start'
  try {
    const { loadDict } = await import(pathToFileURL(resolve(root, 'lib/dict.mjs')).href)
    const loaded = await loadDict(root)
    dict = loaded.dict
    entry = loaded.entry
    add('内容包可加载', true, `${loaded.packFiles.length} 个包 / ${loaded.ids.length} 场景`)
  } catch (error) {
    add('内容包可加载', false, error.message)
  }

  if (dict) {
    const { analyze } = await import(pathToFileURL(resolve(root, 'lib/graph.mjs')).href)
    const report = analyze(dict, entry)
    add('入口场景存在', entry in dict, entry)
    add('无悬空跳转', report.dangling.length === 0, `${report.dangling.length} 处`)
    add('全部场景可达', report.unreachable.length === 0, `${report.unreachable.length} 个不可达`)
    add('结局全部可达', report.endings.length === report.endingsReachable.length,
      `${report.endingsReachable.length}/${report.endings.length}`)
    add('无孤立场景', report.deadEnds.length === 0, `${report.deadEnds.length} 个`)
  }

  const { modeNames } = await import(pathToFileURL(resolve(root, 'lib/modes.mjs')).href)
  add('模式注册表', modeNames().length > 0, modeNames().join(', '))

  let failed = 0
  for (const c of checks) {
    if (!c.ok) failed++
    process.stdout.write(`  ${c.ok ? '✔' : '✘'} ${c.name}${c.detail ? `  (${c.detail})` : ''}\n`)
  }
  process.stdout.write(failed ? `\n${failed} 项未通过\n` : '\n全部通过\n')
  process.exitCode = failed ? 1 : 0
}

// ---------- play ----------
async function cmdPlay(args) {
  // 全检 M2：`dse play --help` 原先不打印帮助，而是直接启动游戏并卡在等待 stdin
  if (args.flags.help || args.flags.h || args._.includes('help')) {
    process.stdout.write(HELP)
    return
  }
  if (args.flags.input) {
    process.env.DSE_INPUT = String(args.flags.input)
  }
  if (args.flags.entry) {
    // 覆盖 engine.entry：引擎读 cordis.yml 的 engine 条目，这里用环境变量透传
    process.env.DSE_ENTRY = String(args.flags.entry)
  }
  const { boot } = await import(pathToFileURL(resolve(root, 'lib/boot.js')).href)
  try {
    await boot({ banner: !args.flags.quiet, quiet: !!args.flags.quiet })
  } catch (error) {
    // 启动失败（cordis.yml 缺失 / 内容包语法错等）：裸堆栈对用户不友好，
    // 按「诊断走 stderr」惯例输出一行摘要 + 完整堆栈，退出码 1。
    process.stderr.write(`dse: 启动失败: ${error?.message ?? error}\n`)
    if (error?.stack) process.stderr.write(`${error.stack}\n`)
    process.exitCode = 1
  }
}

// ---------- 主分发 ----------
const [command = 'help', ...rest] = process.argv.slice(2)

switch (command) {
  case 'help':
  case '--help':
  case '-h':
    process.stdout.write(HELP)
    break
  case 'play':
  case 'run':
    await cmdPlay(parseArgs(rest))
    break
  case 'scenes':
  case 'ls':
    await cmdScenes(parseArgs(rest))
    break
  case 'info':
  case 'stats':
    await cmdInfo(parseArgs(rest))
    break
  case 'check':
  case 'lint':
    await cmdCheck()
    break
  case 'saves':
  case 'slots':
    cmdSaves()
    break
  case 'new':
  case 'create':
    await cmdNew(parseArgs(rest))
    break
  case 'packs':
  case 'pkgs':
    await cmdPacks(parseArgs(rest))
    break
  case 'doctor':
    await cmdDoctor()
    break
  default:
    fail(`未知命令: ${command}\n\n${HELP}`)
}
