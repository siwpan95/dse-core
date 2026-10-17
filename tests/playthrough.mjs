// 逐线实跑转录（交付留存层）
//
// 运行：node tests/playthrough.mjs               跑全部路线
//       node tests/playthrough.mjs --only=A,B    只跑指定路线
//       node tests/playthrough.mjs --list-routes 只打印路线 id
//       node tests/playthrough.mjs --dry-run     只打印将跑哪些
//
// 定位：把每条剧情线**真的跑一遍**，stdout 落盘 `deliverables/playthrough/<id>.md`，
//      供人工阅读留存（"这条线现在是什么样"）。它与测试的分工：
//        e2e        断言"对不对"（机器判定，红/绿）
//        playthrough 记录"是什么样"（人读的剧本，不作通过门）
//
// 路线来源：① 本文件手写的 ROUTES；② scripts/routes.generated.json（由
//       `npm run gen:routes` 从 tests/e2e.mjs 抽取，启动自动载入，重跑即同步）。

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(root, 'deliverables', 'playthrough')
const GENERATED = join(root, 'scripts', 'routes.generated.json')

/** 手写路线：id / title / input（脚本输入序列）/ expect（输出应包含的关键字，任一命中即可） */
const ROUTES = [
  {
    id: 'A',
    title: '战斗线 · 上山拔剑',
    input: '1,1,a,a,a,a,a,a,a,a,a,a',
    expect: ['山道 · 狼倒下之后', '结局 · 山道无归'],
  },
  {
    id: 'B',
    title: '经营线 · 压对行情',
    input: '2,buy tea 2,sell tea 2,next,buy salt 5,sell salt 5,next,buy cloth 8,sell cloth 8,next,1',
    expect: ['结局 · 半间铺面'],
  },
  {
    id: 'C',
    title: '经营线 · 按兵不动',
    input: '2,next,next,next,1',
    expect: ['结局 · 空车回程'],
  },
  {
    id: 'D',
    title: '对话线 · 渡口问话',
    input: '1,1,a,a,a,a,a,a,a,a,a,a,1,topics,ask 1,ask 2,end,1',
    expect: ['渡口 · 老渡工', '结局 · 过河的人', '结局 · 山道无归'],
  },
  {
    id: 'E',
    title: '日记线 · 回溯重读',
    input: '3,1,back,quit',
    expect: ['可重读的篇目', '村口 · 启程'],
  },
  {
    id: 'F',
    title: '系统线 · 存档读档',
    input: '1,save auto1,slots,load auto1,quit',
    expect: ['已保存到存档位 auto1', '已读取存档位 auto1'],
  },
]

// ── 参数 ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const onlyArg = argv.find((a) => a.startsWith('--only='))
const listOnly = argv.includes('--list-routes')
const dryRun = argv.includes('--dry-run')

// 生成路线（来自 e2e）自动并入
let routes = [...ROUTES]
if (existsSync(GENERATED)) {
  try {
    const gen = JSON.parse(readFileSync(GENERATED, 'utf8'))
    const known = new Set(routes.map((r) => r.id))
    for (const r of gen.routes ?? []) {
      if (known.has(r.id)) continue
      routes.push({ id: r.id, title: r.title ?? r.id, input: (r.steps ?? []).join(','), expect: r.ending ? [r.ending] : [] })
    }
  } catch (error) {
    process.stderr.write(`⚠ 读取生成路线失败：${error.message}\n`)
  }
}

if (onlyArg) {
  const wanted = new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean))
  routes = routes.filter((r) => wanted.has(r.id))
}

if (listOnly) {
  process.stdout.write(routes.map((r) => r.id).join('\n') + '\n')
  process.exit(0)
}

if (dryRun) {
  for (const r of routes) process.stdout.write(`  ${r.id.padEnd(4)} ${r.title}\n`)
  process.stdout.write(`\n共 ${routes.length} 条（--dry-run：不实跑）\n`)
  process.exit(0)
}

/** 跑一条线，返回 { ok, out } */
function run(input) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(root, 'cli.js'), 'play', '--quiet', '--input', input], {
      cwd: root, env: { ...process.env, DSE_MUTE: '1' },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('exit', (code) => done({ code, out }))
  })
}

mkdirSync(OUT_DIR, { recursive: true })
let passed = 0
const failed = []

for (const route of routes) {
  const { code, out } = await run(route.input)
  const hit = route.expect.length === 0 || route.expect.some((k) => out.includes(k))
  const ok = hit && code === 0
  if (ok) passed++
  else failed.push(route.id)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(OUT_DIR, `${route.id}.md`)
  const head = [
    `# 路线 ${route.id} · ${route.title}`,
    '',
    `> 生成：${stamp} · 输入序列：\`${route.input}\``,
    `> 预期关键字：${route.expect.join(' / ') || '（无）'} · 结果：${ok ? '✔ 命中' : '⚠ 未命中'} · 退出码 ${code}`,
    '',
    '```',
    out.trim(),
    '```',
    '',
  ].join('\n')
  writeFileSync(file, head, 'utf8')

  process.stdout.write(`${ok ? '✔' : '⚠'} 路线 ${route.id} ${route.title} → ${file.replace(root + '\\', '')}\n`)
}

process.stdout.write(`\n转录完成：${passed}/${routes.length} 条命中预期${failed.length ? `（未命中: ${failed.join(', ')}）` : ''}\n`)
process.stdout.write(`产物目录：deliverables/playthrough/\n`)
