// AI 产线 · 语义裁决错误分类统计（P1）
//
// 用法：node scripts/ai/report.mjs [--json] [--write docs/ai-content-stats.md]
// 行为：跑 lint:content --json + traverse --json，按错误/警告前缀 [类别] 分类计数，
//       输出"哪类错误最多"表（用于改进约束与示例）；可落 docs/ 留档。
//
// 分类来源：
//   lint    [悬空] [可达] [结局] [契约] [成就] [厚度] [假选择] [命名] [账本] [死变量] [数值]
//   guard   （结构层在 batch.mjs）
//   traverse 的 missing 只作提示（其缺口由 e2e 补，见 coverage）

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const jsonMode = process.argv.includes('--json')
const writeFlag = process.argv.indexOf('--write')

const run = (script, args = []) =>
  JSON.parse(execFileSync(process.execPath, [join(root, script), ...args], { cwd: root, encoding: 'utf8' }))

const lint = run('scripts/lint-content.mjs', ['--json'])
const trav = run('tests/traverse.mjs', ['--json'])

const categorize = (arr) => {
  const by = {}
  for (const line of arr) {
    const m = /^\[([^\]]+)\]/.exec(line)
    const c = m ? m[1] : '未分类'
    by[c] = (by[c] ?? 0) + 1
  }
  return by
}
const errors = categorize(lint.errors)
const warnings = categorize(lint.warnings)

const summary = {
  lint: { errors, warnings, totalErrors: lint.errors.length, totalWarnings: lint.warnings.length },
  traverse: { endingsTotal: trav.endingsTotal, reached: trav.endingsReached, missing: trav.missing.length },
  coverageGate: '见 tests/coverage.mjs（双缺==0）',
  generatedAt: new Date().toISOString(),
}

if (jsonMode) { console.log(JSON.stringify(summary, null, 2)); process.exit(0) }

const lines = []
lines.push('# AI 内容产线 · 质量门分类统计')
lines.push('')
lines.push(`> 生成：${summary.generatedAt} · lint 错误 ${lint.errors.length}（警告 ${lint.warnings.length}）· traverse ${trav.endingsReached}/${trav.endingsTotal}`)
lines.push('')
lines.push('## lint 错误按类别')
lines.push('')
lines.push('| 类别 | 数量 |')
lines.push('|---|---|')
if (!lint.errors.length) lines.push('| （无错误） | 0 |')
for (const [k, v] of Object.entries(errors).sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`)
lines.push('')
lines.push('## lint 警告按类别')
lines.push('')
lines.push('| 类别 | 数量 |')
lines.push('|---|---|')
if (!lint.warnings.length) lines.push('| （无警告） | 0 |')
for (const [k, v] of Object.entries(warnings).sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`)
lines.push('')
lines.push('> 用途：错误最多的类别 → 加进 AI 起草的"硬约束清单"与示例（方案 §3）。')
const md = lines.join('\n') + '\n'

if (writeFlag > -1) writeFileSync(join(root, process.argv[writeFlag + 1]), md, 'utf8')
console.log(md)
