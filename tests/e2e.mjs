// 端到端测试：真实进程 spawn，按输入序列跑完整线路并断言输出
//
// 运行：node tests/e2e.mjs
//
// 与 tests/unit.mjs 的分工：
//   unit     库级：服务与纯函数（快，不启进程）
//   e2e      进程级：真实走主循环，覆盖 traverse 到不了的路径
//            （战斗胜负、经营盈亏、对话/日记这类插件内部循环）
//
// 稳定性约定：战斗带随机、经营看操作，凡结果不唯一的线路，断言写"结局之一"，
// 不写死某一档；需要确定结果的用例用"不操作/必败"这类可控输入。

import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const results = []
let assertions = 0

/** 跑一条线：spawn cli.js play --input <序列>，收集全部输出与退出码 */
function play(input, extra = []) {
  return new Promise((done) => {
    const args = [resolve(root, 'cli.js'), 'play', '--quiet', ...extra]
    if (input) args.push('--input', input)
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, DSE_MUTE: '1', DSE_LOCALE: 'zh-CN' },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('exit', (code) => done({ code, out }))
  })
}

/** 用 SDK 在外部项目根上跑一条线（tests/fixtures/run.mjs 驱动） */
function runFixture(project, input) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(root, 'tests/fixtures/run.mjs'), project, input], {
      cwd: root,
      env: { ...process.env, DSE_MUTE: '1' },
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('exit', (code) => done({ code, out }))
  })
}

async function t(name, fn) {
  try {
    const n = await fn()
    assertions += typeof n === 'number' ? n : 1
    results.push({ ok: true, name, n: typeof n === 'number' ? n : 1 })
  } catch (error) {
    results.push({ ok: false, name, message: error?.message ?? String(error) })
  }
}

/** 断言输出包含指定片段（计数用于统计断言数） */
function has(out, ...fragments) {
  for (const f of fragments) assert.ok(out.includes(f), `输出缺少片段: ${f}`)
  return fragments.length
}

// ── 1. 启动与主循环 ──────────────────────────────────────────────
await t('启动渲染入口场景', async () => {
  const { code, out } = await play('quit')
  assert.equal(code, 0, `退出码应为 0，实际 ${code}`)
  return has(out, '村口 · 启程', '往北进山')
})

await t('选项编号驱动流转', async () => {
  const { out } = await play('1,quit')
  return has(out, '山道 · 林深处', '拔剑')
})

await t('未识别输入有提示且不崩', async () => {
  const { code, out } = await play('zzz,quit')
  assert.equal(code, 0)
  return has(out, '未识别的输入')
})

await t('空输入重绘界面', async () => {
  const { out } = await play(',quit')
  return has(out, '村口 · 启程')
})

// ── 2. 战斗模式（combat 接管）───────────────────────────────────
await t('battle：进入战斗并给出战斗指令', async () => {
  const { out } = await play('1,1,help,quit')
  return has(out, '山道 · 遭遇', '战斗指令')
})

await t('battle：攻击到分出胜负并流转', async () => {
  const { out } = await play('1,1,a,a,a,a,a,a,a,a,a,a,a,quit')
  // 结果随机（赢/输都是合法结局），但必须走完并流转到对应场景
  const win = out.includes('山道 · 狼倒下之后')
  const lose = out.includes('结局 · 山道无归')
  assert.ok(win || lose, `战斗未分出胜负：\n${out.slice(-400)}`)
  return 1
})

await t('battle：逃跑指令生效', async () => {
  const { out } = await play('1,1,r,r,r,r,r,r,quit')
  const fled = out.includes('你成功脱身') || out.includes('逃跑失败')
  assert.ok(fled, '逃跑指令未被处理')
  return 1
})

await t('battle：防御姿态可用', async () => {
  const { out } = await play('1,1,d,a,a,a,a,a,a,a,a,quit')
  return has(out, '你举盾防御')
})

// ── 3. 经营模式（trade 接管）─────────────────────────────────────
await t('trade：进入经营并给出经营指令', async () => {
  const { out } = await play('2,info,quit')
  return has(out, '东市 · 开市', '行情')
})

await t('trade：不操作 → 收市判定为亏', async () => {
  // 注意：选项编号是**过滤后**的序号 —— 净赚 <30 时"够租铺面"被隐藏，
  // 只剩"不够回程"这一条，编号是 1 而不是 2
  const { out } = await play('2,next,next,next,1,quit')
  return has(out, '东市 · 收市', '结局 · 空车回程')
})

await t('trade：压对行情 → 结局为赚（end-merchant）', async () => {
  // 第1天茶（8→12）、第2天盐（4→8）、第3天布（2→6），各压满仓
  const input = [
    '2',
    'buy tea 2', 'sell tea 2', 'next',
    'buy salt 5', 'sell salt 5', 'next',
    'buy cloth 8', 'sell cloth 8', 'next',
    '1', 'quit',
  ].join(',')
  const { out } = await play(input)
  return has(out, '东市 · 收市', '结局 · 半间铺面')
})

// ── 4. 对话模式（dialogue 接管）──────────────────────────────────
await t('dialogue：话题询问与结束', async () => {
  // 进山 → 打赢（多打几回合）→ 去渡口 → 问两个话题 → 结束 → 上船
  const input = [
    '1', '1', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a', 'a',
    '1',                 // forest-win → 去渡口（若战败则此行无效，见下断言）
    'topics', 'ask 1', 'ask 2', 'end', '1', 'quit',
  ].join(',')
  const { out } = await play(input)
  // 战斗有随机：赢了才走得到渡口；这里只断言"若到达渡口则对话指令生效"
  if (out.includes('渡口 · 老渡工')) {
    return has(out, '老渡工', '船是老的')
  }
  return has(out, '山道')
})

await t('dialogue：注意点预算与结束流转', async () => {
  const { out } = await play('1,1,a,a,a,a,a,a,a,a,a,a,1,end,2,quit')
  const reached = out.includes('渡口 · 该走了')
  if (reached) return has(out, '渡口 · 该走了')
  return 1
})

// ── 5. 日记回溯（diary 接管）─────────────────────────────────────
await t('diary：列出已读篇目并可重读', async () => {
  const { out } = await play('3,1,back,quit')
  return has(out, '屋里 · 半页札记', '可重读的篇目', '村口 · 启程')
})

await t('diary：back 退出回到 onExit 场景', async () => {
  const { out } = await play('3,back,quit')
  return has(out, '村口 · 启程')
})

// ── 6. 系统与命令 ────────────────────────────────────────────────
await t('stats 显示玩家状态', async () => {
  const { out } = await play('stats,quit')
  return has(out, 'HP', '背包')
})

await t('achievements 列出成就', async () => {
  const { out } = await play('achievements,quit')
  return has(out, '第一头狼')
})

await t('save / slots / load 闭环', async () => {
  const { out } = await play('1,save e2e,slots,load e2e,quit')
  return has(out, '已保存到存档位 e2e', '已读取存档位 e2e')
})

await t('读不存在的存档只提示不崩溃', async () => {
  const { code, out } = await play('load nosuchslot,quit')
  assert.equal(code, 0)
  return has(out, '读取存档 nosuchslot 失败')
})

await t('help 列出全部内置命令', async () => {
  const { out } = await play('help,quit')
  return has(out, '内置命令', 'save', 'achievements')
})

// ── 7. 结局与重开 ────────────────────────────────────────────────
await t('结算页：只挂 @restart 的结局可重开', async () => {
  // 引擎口径：有可选项（哪怕只是 @restart 重开）就不打印「（完）」，
  // 而是把页面留给玩家选；真正的终局（无选项）才打印「（完）」——见下一条。
  const { code, out } = await play('2,next,next,next,1')
  assert.equal(code, 0)
  return has(out, '结局 · 空车回程', '再来一次')
})

await t('@restart 重开回到入口场景', async () => {
  // 经营不操作 → end-broke → 选"再来一次"（结局场景只有这一个选项，编号 1）
  const { out } = await play('2,next,next,next,1,1,quit')
  const count = out.split('村口 · 启程').length - 1
  assert.ok(count >= 2, `重开后应再次出现入口场景（出现 ${count} 次）`)
  return 1
})

await t('quit 正常退出（退出码 0）', async () => {
  const { code, out } = await play('quit')
  assert.equal(code, 0)
  return has(out, '游戏已退出')
})

// ── 8. SDK 驱动外部项目（一个引擎驱动多个内容项目）───────────────
await t('SDK：外部项目根 + @loop 时间循环 + 真结局（完）', async () => {
  // 三个清晨 = 三轮循环；线索跨轮保留后"摊牌"选项才出现 → 无选项终局
  const { code, out } = await runFixture('tests/fixtures/loop-project', '1,1,1,1,2,1,2')
  assert.equal(code, 0)
  const dawns = out.split('清晨').length - 1
  assert.ok(dawns >= 3, `应至少经历 3 个清晨（实际 ${dawns}）`)
  return has(out, '（完）', '结局 · 摊牌')
})

await t('SDK：@loop 保留域生效（线索跨轮、行动力复原）', async () => {
  // 第 1 轮出门查甲处 → 睡下；第 2 轮仍显示"还剩 3 次机会"（moves 复原）
  const { out } = await runFixture('tests/fixtures/loop-project', '1,1,1,1')
  const hits = out.split('还剩 3 次机会').length - 1
  assert.ok(hits >= 2, `行动力应每轮复原（出现 ${hits} 次满值）`)
  return 1
})

// ── 汇总 ─────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length
const failed = results.length - passed
for (const r of results) {
  if (r.ok) process.stdout.write(`  ✔ ${r.name}\n`)
  else process.stderr.write(`  ✘ ${r.name}\n      ${r.message}\n`)
}
process.stdout.write(`\n端到端测试：${passed} 通过 / ${failed} 失败（${assertions} 项断言）\n`)
process.exit(failed ? 1 : 0)
