#!/usr/bin/env node
// gen-routes.mjs —— 从 tests/e2e.mjs 抽取「叙事路线」为数据，供 playthrough 直接驱动
//
// 背景：内容扩充后（587 场景 / 135 结局 / 39 包），playthrough.mjs 的手写路线还停在
// M14 之前，M15–M22 与 P5/P6 的 21 个新包零转录覆盖。e2e.mjs 里其实已有这些新内容的
// 实测输入序列（waitFor 场景标题 + choose 选项文本 + send 命令），本脚本把它抽成数据，
// 避免手写几十条 drive 函数、且内容再扩充时可一键重生成。
//
// 运行：node scripts/gen-routes.mjs [--dry-run]
// 产物：scripts/routes.generated.json（playthrough.mjs 启动时自动载入）
//
// 抽取规则（只认这几种语句，其余形式一律把该路线标为 skipped 并写明原因，绝不猜）：
//   await g.waitFor('T')                        → { wait: 'T' }
//   assert(await g.waitFor('T'), 'msg')         → { wait: 'T' }（msg 里可能含结局场景 id）
//   await choose(g, 'KW')                       → { pick: 'KW' }
//   assert(await choose(g, 'KW'), 'msg')        → { pick: 'KW' }
//   g.send('CMD')                               → { send: 'CMD' }
//   await quit(g, 'msg')                        → 忽略（playthrough 自行收尾）
//
// 排除：
//   - INFRA：F 热重载 / G 音效 / I 官方 HMR / K 存档安全 / L 重放 / M 退出竞态 / N 校验器
//   - 已在 playthrough.mjs ROUTES 里手写的路线（A/B/D/E/H/J/O~DD…）
//   - 用 DSE_ENTRY 直达的路线（playthrough 统一从 entry「村庄 · 晨雾」起跑，直达类不适配）

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const E2E = join(root, 'tests', 'e2e.mjs')
const PLAYTHROUGH = join(root, 'tests', 'playthrough.mjs')
const OUT = join(root, 'scripts', 'routes.generated.json')

const INFRA = new Set(['F', 'G', 'I', 'K', 'L', 'M', 'N'])

// playthrough.mjs 里已有的手写路线 id（避免重复）
function handWrittenIds() {
  const src = readFileSync(PLAYTHROUGH, 'utf8')
  const block = src.match(/const\s+ROUTES\s*=\s*\[([\s\S]*?)\n\]/)
  if (!block) return new Set()
  return new Set([...block[1].matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]))
}

// 单条语句识别（保序）
const STMT = new RegExp([
  /assert\(\s*await\s+choose\(g,\s*'(?<pickA>[^']*)'\)\s*,\s*'(?<msgA>[^']*)'\)/.source,
  /await\s+choose\(g,\s*'(?<pickB>[^']*)'\)/.source,
  /assert\(\s*await\s+g\.waitFor\('(?<waitA>[^']*)'(?:\s*,\s*\d+)?\)\s*,\s*'(?<msgB>[^']*)'\)/.source,
  /await\s+g\.waitFor\('(?<waitB>[^']*)'(?:\s*,\s*\d+)?\)/.source,
  /(?<![\w.])g\.send\('(?<send>[^']*)'\)/.source,
  /await\s+quit\(g/.source,
].join('|'), 'g')

function parseBlocks(src) {
  const lines = src.split('\n')
  const starts = []
  for (let i = 0; i < lines.length; i++) {
    // 标题可能是「路线 U/V/W：…」这类一次声明多条
    const m = lines[i].match(/^\/\/ -+ 路线 ([A-Z0-9-]+(?:\s*\/\s*[A-Z0-9-]+)*)：(.+?) -+$/)
    if (m) starts.push({ line: i, id: m[1], title: m[2] })
  }
  return starts.map((s, i) => ({
    ...s,
    index: i,
    blockEnd: i + 1 < starts.length ? starts[i + 1].line : lines.length,
  }))
}

// 一个块里可能有多次 launch（如「路线 S：商队三结局」），按 launch 切成独立子路线，
// 否则所有子线的步骤会被串成一条永不成立的路线。
function splitSegments(body) {
  const lines = body.split('\n')
  const idx = []
  for (let i = 0; i < lines.length; i++) if (/const\s+g\s*=\s*launch\(/.test(lines[i])) idx.push(i)
  if (!idx.length) return []
  const segs = []
  for (let k = 0; k < idx.length; k++) {
    const end = k + 1 < idx.length ? idx[k + 1] : lines.length
    segs.push(lines.slice(idx[k], end).join('\n'))
  }
  return segs
}

// 子路线 id：块声明了多条（U/V/W）就按顺序取；否则单条用块 id、多条补序号
function segmentIds(block, count) {
  if (block.id.includes('/')) {
    const list = block.id.split('/').map((s) => s.trim())
    if (list.length === count) return list
  }
  if (count === 1) return [block.id]
  return Array.from({ length: count }, (_, i) => `${block.id}${i + 1}`)
}

// e2e 里有「重复 N 次」的循环（如《深巷·低语》听墙 ×5 才扣够 sanity），
// 静态扫一遍只能拿到一次迭代 —— 必须在抽取前把 for 循环展开成 N 份，否则步骤缺失。
function expandLoops(body) {
  const lines = body.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*(\d+);\s*i\+\+\s*\)\s*\{\s*$/)
    if (!m) { out.push(lines[i]); continue }
    const n = Number(m[1])
    const inner = []
    let depth = 1
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      const d = (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length
      depth += d
      if (depth <= 0) { end = j; break }
      inner.push(l)
    }
    const expanded = expandLoops(inner.join('\n'))
    for (let k = 0; k < n; k++) out.push(expanded)
    i = end
  }
  return out.join('\n')
}

function extract(block) {
  const steps = []
  let ending = null
  let endingId = null
  for (const m of expandLoops(block.body).matchAll(STMT)) {
    const g = m.groups
    if (g.pickA || g.pickB) steps.push({ pick: g.pickA ?? g.pickB })
    else if (g.waitA || g.waitB) {
      const t = g.waitA ?? g.waitB
      steps.push({ wait: t })
      if (/^结局/.test(t)) {
        ending = t
        const msg = g.msgA ?? g.msgB ?? ''
        const idm = msg.match(/([a-z][a-z0-9]*(?:[.-][a-z0-9]+)+)\s*$/)
        if (idm) endingId = idm[1]
      }
    } else if (g.send) steps.push({ send: g.send })
    // quit → 忽略
  }
  return { steps, ending, endingId }
}

/**
 * 新结构（dse-core 的 e2e）抽取：`await t('<标题>', async () => { ... play('<序列>') })`
 * 老结构基于 launch()/g.send()/choose()，对 dse-core 的 e2e 一条也抽不到 ——
 * 补这一路，让"内容扩充后重跑生成器即可同步"这条承诺在新仓库同样成立。
 */
function extractInputs(body) {
  const out = []
  // 形式 1：play('1,2,a')
  for (const m of body.matchAll(/\bplay\(\s*'([^']*)'/g)) out.push(m[1])
  // 形式 2：['1','2'].join(',')（长序列分行写）
  for (const m of body.matchAll(/\[([\s\S]*?)\]\s*\.join\(','\)/g)) {
    const items = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1])
    if (items.length) out.push(items.join(','))
  }
  return out
}

const src = readFileSync(E2E, 'utf8')
const blocks = parseBlocks(src)
const existing = handWrittenIds()
// 手写路线有 S-KING / T-RECON / Y1 / BB3 这类形式：子路线 id 去掉尾部序号后再比对
// （S1/S2/S3 对应手写的 S-KING/S-HERMIT/S-BROKE，BB7 对应 BB1~BB6 里的同结局，都是重复）
// 三种写法都归一：S1 / S-KING / S 都算同一族（避免 S1~S3 与 S-KING/S-HERMIT/S-BROKE 重复）
const normExisting = new Set([...existing].flatMap((e) => [e, e.replace(/\d+$/, ''), e.split('-')[0]]))
const isHandWritten = (id) => normExisting.has(id) || normExisting.has(id.replace(/\d+$/, ''))
const routes = []
const skipped = []

for (const b of blocks) {
  const body = src.split('\n').slice(b.line, b.blockEnd).join('\n')
  const segs = splitSegments(body)
  if (!segs.length) { skipped.push({ id: b.id, title: b.title, reason: '块内无 launch()（非玩家流程）' }); continue }
  const ids = segmentIds(b, segs.length)

  segs.forEach((segBody, k) => {
    const id = ids[k]
    const reason = []
    if (INFRA.has(id) || INFRA.has(b.id)) reason.push('基建路线（非玩家流程，e2e 已覆盖）')
    if (isHandWritten(id)) reason.push(`playthrough 已手写（${id}）`)
    if (/DSE_ENTRY/.test(segBody)) reason.push('DSE_ENTRY 直达（与 playthrough 从 entry 起跑不兼容）')
    if (/internals:\s*true/.test(segBody)) reason.push('需要 --expose-internals（官方 HMR）')

    const { steps, ending, endingId } = extract({ body: segBody })
    if (!reason.length) {
      if (!steps.length) reason.push('未抽到任何输入语句')
      else if (!ending) reason.push('未抽到结局断言（非完整叙事线）')
    }
    if (reason.length) { skipped.push({ id, title: b.title, reason: reason.join('；') }); return }

    // 多子线的块，标题补上结局名以便区分
    const title = segs.length > 1 ? `${b.title} → ${ending}` : b.title
    routes.push({ id, title, ending, endingId, steps })
  })
}

// 老结构一条都没抽到时，退回新结构抽取（dse-core 的 e2e）
if (!routes.length) {
  const re = /await\s+t\(\s*'([^']+)'\s*,\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\n\}\)/g
  let n = 0
  for (const m of src.matchAll(re)) {
    const title = m[1]
    const body = m[2]
    const inputs = extractInputs(body)
    if (!inputs.length) { skipped.push({ id: '—', title, reason: '未抽到 play() 输入序列' }); continue }
    const frags = [...body.matchAll(/has\(\s*out\s*,\s*([^)]*)\)/g)]
      .flatMap((x) => [...x[1].matchAll(/'([^']+)'/g)].map((y) => y[1]))
    const ending = frags.find((f) => f.includes('结局')) ?? frags.at(-1) ?? ''
    // 只保留"真叙事线"：基建类用例（启动渲染 / 未识别输入 / stats…）是断言而非
    // 剧本，转成转录路线只会制造噪音
    if (!ending.includes('结局') && !title.includes('线') && !title.includes('结局')) {
      skipped.push({ id: '—', title, reason: '非叙事线（基建/命令类用例）' })
      continue
    }
    const steps = inputs.join(',').split(',')
    // 与 playthrough 手写路线重复（同输入序列）的不再生成
    const written = [...readFileSync(PLAYTHROUGH, 'utf8').matchAll(/input:\s*'([^']*)'/g)].map((x) => x[1])
    if (written.includes(steps.join(','))) {
      skipped.push({ id: '—', title, reason: '与 playthrough 手写路线同序列' })
      continue
    }
    n++
    routes.push({ id: `R${n}`, title, ending, endingId: '', steps })
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'tests/e2e.mjs',
  note: '由 scripts/gen-routes.mjs 从 e2e 实测序列抽取；内容扩充后重跑本脚本即可同步。',
  routes,
  skipped,
}

if (process.argv.includes('--dry-run')) {
  console.log(`将生成 ${routes.length} 条路线，跳过 ${skipped.length} 条：`)
  for (const r of routes) console.log(`  ✔ ${r.id.padEnd(4)} ${r.title} → ${r.ending}（${r.steps.length} 步）`)
  for (const s of skipped) console.log(`  – ${s.id.padEnd(4)} ${s.title} —— ${s.reason}`)
  process.exit(0)
}

writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')
console.log(`✔ 已生成 ${routes.length} 条路线 → ${OUT}`)
console.log(`  跳过 ${skipped.length} 条（已在 playthrough 手写 / 基建 / 直达）：${skipped.map((s) => s.id).join(', ')}`)
