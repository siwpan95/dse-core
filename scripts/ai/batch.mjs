// AI 产线 · 批量转换 + 结构错误分类统计（P1）
//
// 用法：node scripts/ai/batch.mjs [--dir scripts/ai/examples] [--out content] [--json]
// 行为：遍历 --dir 下 *.draft.json，逐个 convertDraft 到 --out/<ns>.js；
//       收集每份草稿的结构护栏错误并按 [类别] 前缀分类计数（命名/危险路径/结构），
//       输出汇总；全部成功退出 0，有 GUARD 错误退出 1（不写出该文件）。
//
// 语义裁决（悬空/契约/数值/账本等）不在本层——注册后由 lint/traverse/coverage
// 执行，见 scripts/ai/report.mjs 的分类统计。

import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertDraft, guard } from './convert.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dirFlag = process.argv.indexOf('--dir')
const outFlag = process.argv.indexOf('--out')
const jsonMode = process.argv.includes('--json')
const dir = dirFlag > -1 ? process.argv[dirFlag + 1] : 'scripts/ai/examples'
const outDir = outFlag > -1 ? process.argv[outFlag + 1] : join(root, 'content')

const files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.draft.json')).sort()
const results = []
let ok = 0
for (const f of files) {
  const rel = join(dir, f)
  const nsGuess = /^([a-z0-9]+)\.draft\.json$/.exec(f)?.[1]
  let entry
  try {
    const r = convertDraft(rel, join(outDir, `${nsGuess ?? 'pack'}.js`))
    results.push({ file: rel, status: 'ok', scenes: r.scenes, errors: [] })
    ok++
  } catch (e) {
    const errors = e?.code === 'GUARD' ? e.errors : [`[结构] ${e.message}`]
    results.push({ file: rel, status: e?.code === 'GUARD' ? 'guard' : 'fail', errors })
  }
}

// 分类计数（按错误行首 [类别]）
const classify = (errs) => {
  const m = /^\[([^\]]+)\]/.exec(errs)
  return m ? m[1] : '其他'
}
const byClass = {}
for (const r of results) for (const e of r.errors) {
  const c = classify(e)
  byClass[c] = (byClass[c] ?? 0) + 1
}

if (jsonMode) {
  console.log(JSON.stringify({ total: files.length, ok, byClass, results }, null, 2))
  process.exit(ok === files.length ? 0 : 1)
}
console.log(`批量转换：${files.length} 份草稿 → 成功 ${ok}`)
for (const r of results) {
  console.log(`${r.status === 'ok' ? '✔' : '✘'} ${r.file}（${r.status === 'ok' ? r.scenes + ' 场景' : r.errors.length + ' 项错误'}）`)
  for (const e of r.errors) console.log(`    - ${e}`)
}
console.log('错误分类（结构层）：' + (Object.keys(byClass).length
  ? Object.entries(byClass).map(([k, v]) => `${k}=${v}`).join('  ')
  : '无'))
process.exit(ok === files.length ? 0 : 1)
