// 引擎单元测试（库级，不 spawn 子进程）
//
// 覆盖：模式注册表 / 场景图分析 / 内容包注册表 / Schema / 状态服务 / 场景服务 /
//       本地化 / 存档迁移 / SDK 门面。
// 运行：node tests/unit.mjs

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { Context, Service } from 'cordis'
import StateService from '../plugins/state.js'
import SceneService from '../plugins/scenes.js'
import I18nService from '../plugins/i18n.js'
import SaveMigrateService from '../plugins/save-migrate.js'
import {
  MODE_REGISTRY, registerMode, modeEdges, modeEdgeTable, modeNames,
  isKnownMode, isSpecialGoto, resolveGoto,
} from '../lib/modes.mjs'
import { analyze, shortestPath, isEnding, edgesOf } from '../lib/graph.mjs'
import { loadPacks, normalizeManifest, validateManifest } from '../lib/registry.mjs'
import { loadDict } from '../lib/dict.mjs'

const root = process.cwd()
const results = []

/** 同步/异步用例统一入口 */
async function t(name, fn) {
  try {
    await fn()
    results.push({ ok: true, name })
  } catch (error) {
    results.push({ ok: false, name, message: error?.message ?? String(error) })
  }
}

// ── A. 模式注册表 ────────────────────────────────────────────────
await t('模式表内置 5 种', () => {
  const names = modeNames()
  for (const m of ['normal', 'battle', 'trade', 'diary', 'dialogue']) {
    assert.ok(names.includes(m), `缺少模式 ${m}`)
  }
})

await t('modeEdges 返回流转边字段', () => {
  assert.deepEqual(modeEdges('battle'), ['onWin', 'onLose', 'onFlee'])
  assert.deepEqual(modeEdges('trade'), ['onEnd'])
  assert.deepEqual(modeEdges('diary'), ['onExit'])
  assert.deepEqual(modeEdges('dialogue'), ['onEnd'])
  assert.deepEqual(modeEdges('normal'), [])
  assert.deepEqual(modeEdges('不存在'), [])
})

await t('registerMode 可扩展自定义模式', () => {
  registerMode('shop', { edges: ['onClose'], plugin: 'shop', desc: '商店' })
  assert.ok(isKnownMode('shop'))
  assert.deepEqual(modeEdges('shop'), ['onClose'])
  assert.ok(modeEdgeTable().shop)
  MODE_REGISTRY.delete('shop') // 还原，避免影响后续用例
  assert.ok(!isKnownMode('shop'))
})

await t('特殊跳转目标识别', () => {
  assert.ok(isSpecialGoto('@restart'))
  assert.ok(isSpecialGoto('@loop:forest.dawn'))
  assert.ok(!isSpecialGoto('@unknown'))
  assert.equal(resolveGoto('@loop:forest.dawn'), 'forest.dawn')
  assert.equal(resolveGoto('market'), 'market')
})

// ── B. 场景图分析 ────────────────────────────────────────────────
const { dict, entry } = await loadDict(root)

await t('图分析：无悬空、无不可达', () => {
  const report = analyze(dict, entry)
  assert.equal(report.dangling.length, 0, `悬空: ${JSON.stringify(report.dangling)}`)
  assert.equal(report.unreachable.length, 0, `不可达: ${report.unreachable.join(', ')}`)
  assert.equal(report.reachableCount, report.scenes)
})

await t('图分析：结局全部可达', () => {
  const report = analyze(dict, entry)
  assert.equal(report.endings.length, 5)
  assert.equal(report.endingsReachable.length, 5)
})

await t('shortestPath 能给出直达路径', () => {
  const path = shortestPath(dict, entry, 'end-hero')
  assert.ok(Array.isArray(path), '应能找到路径')
  assert.equal(path[0], entry)
  assert.equal(path.at(-1), 'end-hero')
})

await t('模式场景的流转边计入出边', () => {
  const edges = edgesOf('wolf-fight', dict['wolf-fight'])
  const targets = edges.map((e) => e.to)
  for (const target of ['forest-win', 'forest-lose', 'start']) {
    assert.ok(targets.includes(target), `battle 边缺少 ${target}`)
  }
  assert.equal(edges[0].kind, 'mode')
})

await t('isEnding 判定结局场景', () => {
  assert.ok(isEnding(dict['end-hero']))
  assert.ok(!isEnding(dict['start']))
  assert.ok(!isEnding(dict['wolf-fight'])) // 模式场景不算结局
})

// ── C. 内容包注册表 ──────────────────────────────────────────────
await t('loadPacks 读到 starter 的 manifest', async () => {
  const packs = await loadPacks(root)
  assert.equal(packs.length, 1)
  const [p] = packs
  assert.equal(p.manifest.id, 'starter')
  assert.equal(p.manifest.entry, 'start')
  assert.equal(p.manifest.version, '0.1.0')
  assert.deepEqual(p.manifest.modes, ['battle', 'dialogue', 'diary', 'trade'])
  assert.ok(p.manifest.requires.plugins.includes('combat'))
  assert.equal(p.count, 14)
})

await t('validateManifest 拦下非法 ID 与版本', () => {
  const bad = normalizeManifest({ id: 'Bad ID', version: 'x' }, 'content/bad.js', {})
  const problems = validateManifest(bad)
  assert.ok(problems.some((p) => p.includes('id')))
  assert.ok(problems.some((p) => p.includes('version')))
})

await t('validateManifest 拦下未注册模式', () => {
  const problems = validateManifest(normalizeManifest({ id: 'x', modes: ['batle'] }, 'a.js', {}))
  assert.ok(problems.some((p) => p.includes('未注册的模式')))
})

await t('normalizeManifest 补齐缺省字段', () => {
  const m = normalizeManifest({}, 'content/foo.js', { 'foo.a': { text: 'x' } })
  assert.equal(m.id, 'foo')
  assert.equal(m.name, 'foo')
  assert.equal(m.entry, 'foo.a')
  assert.equal(m.scenes, 1)
})

// ── D. Schema ────────────────────────────────────────────────────
await t('场景 Schema 可解析且字段完整', async () => {
  const raw = await readFile(new URL('../schema/scene.schema.json', import.meta.url), 'utf8')
  const schema = JSON.parse(raw)
  assert.ok(schema.definitions.Scene)
  assert.ok(schema.definitions.Choice)
  assert.ok(schema.definitions.PackManifest)
  assert.ok(schema.definitions.Scene.required.includes('text'))
  assert.ok(schema.definitions.Choice.required.includes('text'))
  // 场景 ID 命名规范与 lint 的 ID_PATTERN 保持一致
  assert.ok(schema.propertyNames.pattern.includes('a-z'))
})

// ── E. 状态服务 ──────────────────────────────────────────────────
const ctx = new Context()
ctx.baseUrl = pathToFileURL(root).href + '/'
const state = new StateService(ctx, {
  initial: { hp: 20, gold: 10, name: '旅人', items: { sword: 1 }, flags: { loop: {} }, clues: { loop: {} } },
})
await state[Service.init]?.()

await t('apply：数值=加减，非数值=赋值', () => {
  state.data = structuredClone({ hp: 20, name: '旅人' })
  state.apply({ hp: -5 })
  assert.equal(state.get('hp'), 15)
  state.apply({ name: '张三' })
  assert.equal(state.get('name'), '张三')
})

await t('apply：点路径深层写入与计数', () => {
  state.data = structuredClone({ items: { sword: 1 }, flags: {} })
  state.apply({ 'items.sword': +1, 'flags.doorOpen': true })
  assert.equal(state.get('items.sword'), 2)
  assert.equal(state.get('flags.doorOpen'), true)
})

await t('apply：原型污染路径被拒绝', () => {
  state.data = structuredClone({ hp: 1 })
  const changes = state.apply({ '__proto__.polluted': 1 })
  assert.equal(changes.length, 0)
  assert.equal({}.polluted, undefined)
  assert.equal(state.set('constructor.prototype.x', 1), false)
})

await t('interpolate：命中替换、缺失保留原样', () => {
  state.data = structuredClone({ name: '旅人', gold: 10 })
  assert.equal(state.interpolate('你好，{name}，你有 {gold} 金'), '你好，旅人，你有 10 金')
  assert.equal(state.interpolate('缺失 {nope}'), '缺失 {nope}')
})

await t('check：条件求值与异常兜底', () => {
  state.data = structuredClone({ hp: 20, gold: 0, items: { sword: 2 } })
  assert.equal(state.check('hp >= 10 && gold > 0'), false)
  assert.equal(state.check('items.sword >= 1'), true)
  assert.equal(state.check(undefined), true)   // 无条件恒真
  assert.equal(state.check('hp >='), false)    // 语法错误按 false
})

await t('reset({ keep })：保留域跨重置', () => {
  state.data = structuredClone({ hp: 20, gold: 10, clues: { loop: { a: true } }, flags: { loop: { n: 3 } } })
  state.reset({ keep: ['clues.loop', 'flags.loop'] })
  assert.equal(state.get('gold'), 10)
  assert.equal(state.get('clues.loop.a'), true)
  assert.equal(state.get('flags.loop.n'), 3)
  state.reset()
  assert.equal(state.get('flags.loop.n'), undefined) // 全量重置
})

// ── F. 场景服务 ──────────────────────────────────────────────────
const scenes = new SceneService(ctx, { packs: ['./content/starter.js'] })
await scenes[Service.init]()

await t('scenes 加载示例内容包', () => {
  assert.equal(scenes.size, 14)
  assert.ok(scenes.has('start'))
  assert.ok(scenes.has('wolf-fight'))
})

await t('validate：缺 text / 选项缺 text 报错', () => {
  const errors = scenes.validate({ 'a': { title: '无正文' }, 'b': { text: 'x', choices: [{ goto: 'a' }] } }, 'test')
  assert.ok(errors.some((e) => e.includes('缺少 text')))
  assert.ok(errors.some((e) => e.includes('选项缺少 text')))
})

await t('findDangling：未定义 goto 与缺失 goto', () => {
  const dangling = scenes.findDangling({
    a: { text: 'x', choices: [{ text: '走', goto: '不存在' }] },
    b: { text: 'x', choices: [{ text: '留下' }] },
  })
  assert.ok(dangling.some((d) => d.includes('不存在')))
  assert.ok(dangling.some((d) => d.includes('缺少 goto')))
})

await t('rebuild 双缓冲：校验失败不污染字典', () => {
  const before = scenes.size
  scenes.loaded.set('./broken.js', { x: { text: 'x', choices: [{ text: '走', goto: '不存在' }] } })
  scenes.packs.push('./broken.js')
  assert.throws(() => scenes.rebuild(), /未定义的场景跳转/)
  assert.equal(scenes.size, before, '失败后字典应保持原样')
  scenes.packs.pop()
  scenes.loaded.delete('./broken.js')
})

// ── G. 本地化（骨架）────────────────────────────────────────────
// 服务按名字注册到 ctx，同一 ctx 只能注册一次 —— 故只构造一个实例复用
const i18n = new I18nService(ctx, {
  defaultLocale: 'zh-CN',
  locales: {
    'zh-CN': { 'hi': '你好' },
    'en-US': { 'hi': 'Hello', 'starter.start.title': 'Village Road' },
  },
})

await t('i18n：未命中原样保留（不破坏既有内容）', () => {
  state.set('locale', 'zh-CN')
  assert.equal(i18n.translate('原文照写'), '原文照写')
  assert.equal(i18n.translate('未命中 @no.such.key@'), '未命中 @no.such.key@')
  assert.ok(i18n.missing().includes('no.such.key'))
})

await t('i18n：locale 切换后查对应表', () => {
  state.set('locale', 'en-US')
  assert.equal(i18n.translate('@hi@'), 'Hello')
  assert.equal(i18n.translate('@starter.start.title@'), 'Village Road')
  state.set('locale', 'zh-CN')
  assert.equal(i18n.translate('@hi@'), '你好')
  // 默认语言兜底：zh-CN 没这个 key，回退到默认语言（也是 zh-CN）→ 仍未命中
  assert.equal(i18n.translate('@starter.start.title@'), '@starter.start.title@')
})

// ── H. 存档迁移（骨架）───────────────────────────────────────────
const mig = new SaveMigrateService(ctx, { version: 3, migrations: {} })

await t('save-migrate：版本盖章与升级（无迁移函数时数据不动）', () => {
  const stamped = mig.stamp({ slot: 'auto', scene: 'start' })
  assert.equal(stamped.version, 3)
  assert.equal(mig.needsMigration({ version: 1 }), true)
  assert.equal(mig.needsMigration({ version: 3 }), false)
  const upgraded = mig.migrate({ version: 1, gold: 10 })
  assert.equal(upgraded.record.version, 3)
  assert.equal(upgraded.record.gold, 10)
})

await t('save-migrate：按版本链逐级执行迁移', () => {
  mig.migrations.set(2, (r) => ({ ...r, gold: (r.gold ?? 0) * 2 }))
  mig.migrations.set(3, (r) => ({ ...r, gold: (r.gold ?? 0) + 1 }))
  const result = mig.migrate({ version: 1, gold: 10 })
  assert.equal(result.record.gold, 21)
  assert.deepEqual(result.steps, [2, 3])
  assert.equal(result.to, 3)
})

await t('save-migrate：迁移抛错时回滚该步', () => {
  mig.migrations.clear()
  mig.migrations.set(2, () => { throw new Error('boom') })
  const result = mig.migrate({ version: 1, gold: 10 })
  assert.equal(result.record.gold, 10)
  assert.deepEqual(result.steps, [])
  mig.migrations.clear()
})

// ── I. SDK 门面 ──────────────────────────────────────────────────
await t('SDK 导出关键 API', async () => {
  const sdk = await import('../sdk/index.js')
  for (const key of ['createEngine', 'inspectProject', 'analyze', 'loadPacks', 'registerMode', 'loadDict', 'boot']) {
    assert.equal(typeof sdk[key], 'function', `SDK 缺少导出 ${key}`)
  }
  assert.ok(sdk.MODE_REGISTRY instanceof Map)
})

await t('SDK inspectProject 给出项目统计', async () => {
  const { inspectProject } = await import('../sdk/index.js')
  const report = await inspectProject(root)
  assert.equal(report.entry, 'start')
  assert.equal(report.scenes, 14)
  assert.equal(report.endings, 5)
  assert.equal(report.unreachable.length, 0)
  assert.equal(report.packs[0].id, 'starter')
})

// ── 汇总 ─────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length
const failed = results.length - passed
for (const r of results) {
  if (r.ok) process.stdout.write(`  ✔ ${r.name}\n`)
  else process.stderr.write(`  ✘ ${r.name}\n      ${r.message}\n`)
}
process.stdout.write(`\n单元测试：${passed} 通过 / ${failed} 失败（共 ${results.length}）\n`)
process.exit(failed ? 1 : 0)
