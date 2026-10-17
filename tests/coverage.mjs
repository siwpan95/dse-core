// 剧情线结局覆盖审计（总门：traverse ∪ e2e 双缺 == 0）
//
// 运行：node tests/coverage.mjs            打印覆盖矩阵；双缺非空 → 退出码 1
//       node tests/coverage.mjs --json     机器可读
//
// 覆盖来源：
//   traverse  结构-状态遍历（tests/traverse.mjs）——执行每条 goto 边/效果/条件
//   e2e       真实进程路径断言（tests/e2e.mjs）——按标题 waitFor 实跑到结局
// 结论："全部剧情线（主+支）都测到、且留存" = 43 个结局里每个至少有一个来源。
// 后续新增内容：新结局只要入口挂上 start（lint 可达强制），traverse 能自动到的
// 归 traverse；到不了（插件/多轮/计数类）必须补一条 e2e 直达路径，否则本审计红。

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadDict } from '../lib/dict.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const jsonMode = process.argv.includes('--json')

const { dict } = await loadDict(root)
const endings = Object.entries(dict)
  .filter(([, s]) => (s.mode == null || s.mode === 'normal') &&
    ((s.choices ?? []).length === 0 || (s.choices ?? []).every((c) => String(c?.goto ?? '').startsWith('@restart'))))
  .sort(([a], [b]) => (a < b ? -1 : 1))

// traverse 覆盖
const tr = JSON.parse(execFileSync(process.execPath, [join(root, 'tests/traverse.mjs'), '--json'],
  { cwd: root, encoding: 'utf8' }))
const reachedTraverse = new Set(tr.reached)

// e2e 断言 token：同时兼容两种写法
//   1) waitFor('标题片段')            —— 旧式（交互进程等待式断言）
//   2) has(out, '标题片段', ...)      —— 新式（spawn 后对整段输出做包含断言）
const e2eSrc = readFileSync(join(root, 'tests/e2e.mjs'), 'utf8')
const tokens = new Set([
  ...[...e2eSrc.matchAll(/waitFor\('([^']+)'\)/g)].map((m) => m[1]),
  ...[...e2eSrc.matchAll(/has\(\s*out\s*,\s*([^)]*)\)/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])),
])
const isEndingHitBy = (title, token) =>
  token.length >= 4 && (title.includes(token) || token.includes(title))

const rows = endings.map(([id, s]) => {
  const title = s.title ?? ''
  const e2eHit = [...tokens].some((tok) => isEndingHitBy(title, tok))
  const travHit = reachedTraverse.has(id)
  return { id, title, e2eHit, travHit }
})

const bothNone = rows.filter((r) => !r.e2eHit && !r.travHit).map((r) => r.id)
const covered = rows.filter((r) => r.e2eHit || r.travHit)

if (jsonMode) {
  console.log(JSON.stringify({
    total: rows.length,
    covered: covered.length,
    byE2E: rows.filter((r) => r.e2eHit).length,
    byTraverse: rows.filter((r) => r.travHit).length,
    missing: bothNone,
    rows,
  }, null, 2))
  process.exit(bothNone.length ? 1 : 0)
}

// 非 JSON：打印矩阵并落盘留档
const now = new Date().toISOString().slice(0, 10)
const lines = []
lines.push('# 剧情线结局覆盖矩阵（TEST-COVERAGE）')
lines.push('')
lines.push(`> 生成：${now} · ${rows.length} 个结局 · 覆盖 ${covered.length}/${rows.length} · 生成器：node tests/coverage.mjs`)
lines.push('> 覆盖来源：**T** = tests/traverse.mjs（结构-状态遍历，执行每条边/效果/条件）')
lines.push('>          **E** = tests/e2e.mjs（真实进程路径断言，按标题 waitFor 实跑）')
lines.push('> 门：两栏皆空（T✗ E✗）时退出码 1 —— 新结局必须至少落进其中一个来源。')
lines.push('')
lines.push('| 结局 | 标题 | T | E |')
lines.push('|---|---|---|---|')
for (const r of rows) {
  lines.push(`| \`${r.id}\` | ${r.title} | ${r.travHit ? '✓' : '✗'} | ${r.e2eHit ? '✓' : '✗'} |`)
}
lines.push('')
if (bothNone.length) {
  lines.push(`⚠ **双缺 ${bothNone.length} 个**（需补 e2e 直达路径或使 traverse 可达）：\`${bothNone.join('`, `')}\``)
} else {
  lines.push('✔ 全部结局至少有一个覆盖来源（traverse 或 e2e）。')
}
writeFileSync(join(root, 'docs/TEST-COVERAGE.md'), lines.join('\n') + '\n')

console.log(lines.join('\n'))
console.log(`\n${bothNone.length ? `✘ 双缺 ${bothNone.length}: ${bothNone.join(', ')}` : '✔ 全部结局已覆盖'}`)
process.exit(bothNone.length ? 1 : 0)
