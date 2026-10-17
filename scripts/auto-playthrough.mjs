#!/usr/bin/env node
// auto-playthrough.mjs —— 每小时模拟跑团调度器（最少优先轮询，尽可能不重复）
//
// 复用 tests/playthrough.mjs --only=<id> 跑单条叙事路线；维护历史计数，
// 每次挑"历史跑得最少"的路线，把转录归档到带时间戳文件（永不覆盖）。
//
// 运行：node scripts/auto-playthrough.mjs [--route=<id>] [--dry-run]
//   无参      → 自动选最少跑过的路线跑一条
//   --route=X → 指定路线（调试用）
//   --dry-run → 只打印将选的路线，不实跑
//
// 产物：
//   deliverables/auto-playthrough/history.json          历史计数与运行日志（增量更新）
//   deliverables/auto-playthrough/<ts>-<id>.md          本次转录归档（复制自 playthrough 产物）
//
// 路线清单从 tests/playthrough.mjs 动态获取（`--list-routes`，含 playthrough 手写路线
// 与 scripts/gen-routes.mjs 从 e2e 抽取的生成路线；二者相加当前 87 条）。
// 零漂移：playthrough 加路线 / 内容扩充后重跑 gen-routes，本脚本自动生效，无需改这里。
// C（存档读档）由 playthrough 无条件附带跑，是固定健康噪声，不计入"不重复"统计。
//
// 选线策略：从未跑过的里随机挑 → 都跑过则取 count 最小，并列随机。
// 这样 N 条叙事路线前 N 次绝不重复，之后才轮回最少跑过的。

import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLAYTHROUGH = join(root, 'tests', 'playthrough.mjs')
const ARCHIVE_DIR = join(root, 'deliverables', 'auto-playthrough')
const HISTORY = join(ARCHIVE_DIR, 'history.json')
const GSTACK = join(root, 'deliverables', 'gstack')
const HARD_TIMEOUT_MS = 240000 // 4 分钟硬超时（单条 + C 通常 < 90s）

function pad(n) { return String(n).padStart(2, '0') }

// ---- 1. 从 playthrough.mjs 动态取路线 id 清单 ----
// 首选 `--list-routes`（手写 + 生成路线的真实并集）；失败再回退到解析 ROUTES 字面量。
async function loadRouteIds() {
  const listed = await new Promise((resolve) => {
    try {
      const child = spawn(process.execPath, [PLAYTHROUGH, '--list-routes'], { cwd: root })
      let out = ''
      child.stdout.on('data', (d) => { out += d.toString() })
      child.on('exit', () => resolve(out))
      child.on('error', () => resolve(''))
    } catch { resolve('') }
  })
  const line = listed.trim().split('\n').filter(Boolean).pop() ?? ''
  try {
    const ids = JSON.parse(line)
    if (Array.isArray(ids) && ids.length) return ids
  } catch { /* 落到回退路径 */ }

  const src = readFileSync(PLAYTHROUGH, 'utf8')
  // 只在 ROUTES 数组块内提取 id，自动排除 runSaveLoad 返回的 { id: 'C' }（存档线，附带跑）
  const block = src.match(/const\s+ROUTES\s*=\s*\[([\s\S]*?)\n\]/)
  if (!block) throw new Error('未能定位 tests/playthrough.mjs 的 ROUTES 数组（结构变更？）')
  const ids = [...block[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
  if (ids.length === 0) throw new Error('ROUTES 数组内未提取到路线 id')
  return ids
}

// ---- 2. 历史读写 ----
function loadHistory() {
  if (!existsSync(HISTORY)) return { runs: [], counts: {} }
  try { return JSON.parse(readFileSync(HISTORY, 'utf8')) }
  catch { return { runs: [], counts: {} } } // 损坏则重置（不抛，保证可跑）
}
function saveHistory(h) {
  mkdirSync(ARCHIVE_DIR, { recursive: true })
  writeFileSync(HISTORY, JSON.stringify(h, null, 2) + '\n', 'utf8')
}

// ---- 3. 选路线：最少优先，并列随机 ----
function pickRoute(ids, counts) {
  const unrun = ids.filter((id) => !counts[id]) // count 0 或 undefined
  if (unrun.length) return unrun[Math.floor(Math.random() * unrun.length)]
  let min = Infinity
  for (const id of ids) if ((counts[id] ?? 0) < min) min = counts[id]
  const ties = ids.filter((id) => (counts[id] ?? 0) === min)
  return ties[Math.floor(Math.random() * ties.length)]
}

// ---- 4. 解析本次指定路线的状态（playthrough 打印 ✔/⚠/✘ 路线 <id>）----
function parseRouteStatus(stdout, routeId) {
  const esc = routeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = stdout.match(new RegExp(`([✔⚠✘])\\s*路线\\s+${esc}\\b(.*)`))
  if (!m) return { status: 'UNKNOWN', detail: '未在 stdout 找到路线状态行' }
  const sym = m[1]
  const rest = m[2].trim().replace(/^—\s*/, '')
  return { status: sym === '✔' ? 'OK' : sym === '⚠' ? 'WARN' : 'FAIL', detail: rest }
}

// ---- 主流程 ----
const ids = await loadRouteIds()
const h = loadHistory()
mkdirSync(ARCHIVE_DIR, { recursive: true })

const onlyArg = process.argv.find((a) => a.startsWith('--route='))
const dryRun = process.argv.includes('--dry-run')
const chosen = onlyArg ? onlyArg.slice('--route='.length) : pickRoute(ids, h.counts)

if (!ids.includes(chosen)) {
  console.error(`✘ 未知路线 id：${chosen}`)
  console.error(`  可用（${ids.length}）：${ids.join(', ')}`)
  process.exit(2)
}

const covered = Object.keys(h.counts).filter((k) => h.counts[k] > 0).length
console.log(`▶ 本次选定路线：${chosen}（共 ${ids.length} 条 | 已覆盖 ${covered}/${ids.length}）`)
if (dryRun) { console.log('（--dry-run：不实跑）'); process.exit(0) }

// spawn playthrough --only=<chosen>（不静音：stdout 与玩家实跑一致；音效临时目录由 playthrough 自管）
const ts = new Date()
const t0 = Date.now()
const res = await new Promise((resolve) => {
  const child = spawn(process.execPath, [PLAYTHROUGH, `--only=${chosen}`], { cwd: root, env: { ...process.env } })
  let out = '', err = ''
  child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d) })
  child.stderr.on('data', (d) => { err += d.toString(); process.stderr.write(d) })
  const timer = setTimeout(() => child.kill('SIGKILL'), HARD_TIMEOUT_MS)
  child.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out, err }) })
})

const { status, detail } = parseRouteStatus(res.out, chosen)
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

// 归档：复制 playthrough 产出的 md（按天写到 gstack/full-playthrough-...-DATE.md，会覆盖）
// 到带时间戳文件（永不覆盖）。playthrough 无论本次路线成败都会写 md（末尾无条件 writeFileSync）。
const localStamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
const archiveName = `${localStamp}-${chosen}.md`
const archivePath = join(ARCHIVE_DIR, archiveName)
let archived = null
try {
  const gfiles = existsSync(GSTACK)
    ? readdirSync(GSTACK).filter((f) => f.startsWith('full-playthrough-dict-scene-engine-') && f.endsWith('.md'))
    : []
  if (gfiles.length) {
    gfiles.sort() // 按名（含日期）排序，取最新
    copyFileSync(join(GSTACK, gfiles[gfiles.length - 1]), archivePath)
    archived = archivePath
  } else {
    // 兜底：playthrough 未产出 md，落 stdout 摘要
    writeFileSync(archivePath,
      `# 路线 ${chosen} 转录（兜底：playthrough 未产出 md）\n\n状态：${status} · 退出码：${res.code} · 耗时：${elapsed}s\n明细：${detail}\n\n## stdout\n\n\`\`\`\n${res.out}\n\`\`\`\n`,
      'utf8')
    archived = archivePath
  }
} catch (e) {
  console.error(`⚠ 归档失败：${e.message}`)
}

// 更新历史（失败也计数，避免卡在坏路线上反复重试）
h.counts[chosen] = (h.counts[chosen] ?? 0) + 1
h.runs.push({ ts: ts.toISOString(), route: chosen, status, exitCode: res.code, elapsed: `${elapsed}s`, archive: archiveName, detail })
saveHistory(h)

const coveredNow = ids.filter((id) => h.counts[id] > 0).length
console.log('\n' + '─'.repeat(60))
console.log(`✔ 路线 ${chosen} 完成 · 状态 ${status} · 耗时 ${elapsed}s · 退出码 ${res.code}`)
console.log(`  归档：${archived ?? '（无）'}`)
console.log(`  历史：${chosen} 已跑 ${h.counts[chosen]} 次 · 累计 ${h.runs.length} 次运行 · 覆盖 ${coveredNow}/${ids.length} 路线`)
if (detail) console.log(`  明细：${detail}`)
if (res.err.trim()) console.log(`  ⚠ stderr 非空（前 300 字）：${res.err.slice(0, 300)}`)

// 退出码沿用 playthrough（0=全绿；1=有 FAIL），便于上层判定
process.exit(res.code ?? 1)
