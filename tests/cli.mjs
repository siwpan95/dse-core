// CLI 接口测试：dse 的各条命令是否按契约工作
//
// 运行：node tests/cli.mjs
//
// 与 e2e 的分工：e2e 关心"游戏跑得对不对"，本文件关心"命令行接口对不对" ——
// 退出码、stdout 可管道消费（--json）、诊断走 stderr、子命令存在性。

import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync, rmSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []

/** 跑一条 CLI 命令，分别收集 stdout / stderr / 退出码 */
function dse(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(root, 'cli.js'), ...args], {
      cwd: root, env: { ...process.env, DSE_MUTE: '1' },
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('exit', (code) => done({ code, out, err }))
  })
}

async function t(name, fn) {
  try {
    await fn()
    results.push({ ok: true, name })
  } catch (error) {
    results.push({ ok: false, name, message: error?.message ?? String(error) })
  }
}

// ── 只读查询命令 ─────────────────────────────────────────────────
await t('scenes：列出场景并标注结局/模式', async () => {
  const { code, out } = await dse(['scenes'])
  assert.equal(code, 0)
  assert.ok(out.includes('场景 14 个'), out.slice(0, 200))
  assert.ok(out.includes('⚑'))
  assert.ok(out.includes('⚔'))
})

await t('scenes --json 可被 JSON.parse 消费', async () => {
  const { code, out } = await dse(['scenes', '--json'])
  assert.equal(code, 0)
  const list = JSON.parse(out)
  assert.ok(Array.isArray(list))
  assert.equal(list.length, 14)
  const start = list.find((s) => s.id === 'start')
  assert.equal(start.title, '村口 · 启程')
  assert.equal(start.mode, 'normal')
  assert.equal(start.ending, false)
  const ending = list.find((s) => s.id === 'end-hero')
  assert.equal(ending.ending, true)
})

await t('scenes --scene <ID> 查看单个场景', async () => {
  const { code, out } = await dse(['scenes', '--scene', 'wolf-fight'])
  assert.equal(code, 0)
  assert.ok(out.includes('山道 · 遭遇'))
  assert.ok(out.includes('battle'))
})

await t('scenes --scene 不存在的场景 → 退出码 1', async () => {
  const { code, err } = await dse(['scenes', '--scene', 'nope'])
  assert.equal(code, 1)
  assert.ok(err.includes('不存在'))
})

await t('info：项目统计', async () => {
  const { code, out } = await dse(['info'])
  assert.equal(code, 0)
  assert.ok(out.includes('场景'))
  assert.ok(out.includes('结局'))
})

await t('info --json 结构化输出', async () => {
  const { code, out } = await dse(['info', '--json'])
  assert.equal(code, 0)
  const stats = JSON.parse(out)
  assert.equal(stats.scenes, 14)
  assert.equal(stats.endings, 5)
  assert.equal(stats.entry, 'start')
  assert.ok(stats.modes.includes('battle'))
})

// ── 校验与自检 ───────────────────────────────────────────────────
await t('check：内容校验通过（退出码 0）', async () => {
  const { code, out } = await dse(['check'])
  assert.equal(code, 0)
  assert.ok(out.includes('无错误'))
})

await t('doctor：环境自检通过（退出码 0）', async () => {
  const { code, out } = await dse(['doctor'])
  assert.equal(code, 0)
  assert.ok(out.includes('全部通过'))
  assert.ok(out.includes('内容包可加载'))
})

// ── 内容包 manifest ──────────────────────────────────────────────
await t('packs：列出内容包 manifest', async () => {
  const { code, out } = await dse(['packs'])
  assert.equal(code, 0)
  assert.ok(out.includes('starter'))
  assert.ok(out.includes('入口'))
  assert.ok(out.includes('combat'))
})

await t('packs --json 结构化输出', async () => {
  const { code, out } = await dse(['packs', '--json'])
  assert.equal(code, 0)
  const list = JSON.parse(out)
  assert.equal(list[0].id, 'starter')
  assert.equal(list[0].entry, 'start')
  assert.ok(list[0].modes.includes('battle'))
})

// ── 脚手架 ───────────────────────────────────────────────────────
await t('new：按模板生成内容包骨架', async () => {
  const target = resolve(root, 'content/clitest.js')
  rmSync(target, { force: true })
  const { code, out } = await dse(['new', 'clitest', '--template=hub', '--ns=ctest'])
  assert.equal(code, 0)
  assert.ok(existsSync(target), '未生成文件')
  const src = readFileSync(target, 'utf8')
  assert.ok(src.includes("id: 'clitest'"), 'pack.id 未替换')
  assert.ok(src.includes('ctest.hub'), '命名空间未替换')
  assert.ok(!src.includes('__NS__'), '存在未替换占位符')
  rmSync(target, { force: true })   // 清理，避免污染 content/ 与后续校验
})

await t('new：非法包名被拒绝', async () => {
  const { code, err } = await dse(['new', 'Bad Name'])
  assert.equal(code, 1)
  assert.ok(err.includes('不合法'))
})

await t('new：未知模板被拒绝', async () => {
  const { code, err } = await dse(['new', 'x', '--template=nope'])
  assert.equal(code, 1)
  assert.ok(err.includes('未知模板'))
})

// ── 存档与运行 ───────────────────────────────────────────────────
await t('saves：列出存档位（无档时给提示）', async () => {
  const { code, out } = await dse(['saves'])
  assert.equal(code, 0)
  assert.ok(/存档位|暂无存档/.test(out))
})

await t('play --input：脚本驱动跑一条线', async () => {
  const { code, out } = await dse(['play', '--input', '1,quit', '--quiet'])
  assert.equal(code, 0)
  assert.ok(out.includes('山道 · 林深处'))
})

await t('play --entry：从指定场景起跑', async () => {
  const { code, out } = await dse(['play', '--entry', 'market', '--input', 'info,quit', '--quiet'])
  assert.equal(code, 0)
  assert.ok(out.includes('东市 · 开市'))
})

await t('help / 未知命令', async () => {
  const help = await dse(['help'])
  assert.equal(help.code, 0)
  assert.ok(help.out.includes('用法'))
  const bad = await dse(['nosuchcmd'])
  assert.equal(bad.code, 1)
  assert.ok(bad.err.includes('未知命令'))
})

const passed = results.filter((r) => r.ok).length
const failed = results.length - passed
for (const r of results) {
  if (r.ok) process.stdout.write(`  ✔ ${r.name}\n`)
  else process.stderr.write(`  ✘ ${r.name}\n      ${r.message}\n`)
}
process.stdout.write(`\nCLI 测试：${passed} 通过 / ${failed} 失败（共 ${results.length}）\n`)
process.exit(failed ? 1 : 0)
