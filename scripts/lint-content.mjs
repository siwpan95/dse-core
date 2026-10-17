// 内容校验器（M0 基建）—— 内容扩容后逻辑不失控的关键工具
//
// 用法：npm run lint:content       （或 node scripts/lint-content.mjs）
//       node scripts/lint-content.mjs --json   以 JSON 输出，便于接入 CI
//
// 检查项：
//   1. 悬空 goto     —— 跳转目标不存在（'@' 前缀走白名单）
//   2. 不可达场景    —— 从 entry 出发 BFS 到不了的场景
//   3. 结局可达性    —— 每个 ending.* 至少一条可达路径
//   4. 变量一致性    —— 内容引用的 flags/items 必须在叙事账本声明；
//                       账本声明但内容从不读取的 → 死变量告警
//   5. 内容厚度      —— 场景文本过短告警
//   6. 疑似假选择    —— 无副作用且与其他选项同归宿的选项
//   7. ID 命名       —— 符合命名空间规范
//
// 退出码：存在 error → 1；仅 warning → 0（warning 不阻塞，但应清零）

import { readFile } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
// 引擎化：模式契约与图分析收敛到 lib/ 的唯一真源（原实现在本文件与
// tests/traverse.mjs 各写一份 MODE_EDGES/MODE_NEXT，靠人工同步，漏改即
// 出现「lint 说可达、traverse 说不可达」）。现在两边都读同一份。
import { modeEdgeTable, isSpecialGoto, LOOP_PREFIX, isKnownMode } from '../lib/modes.mjs'
import { analyze } from '../lib/graph.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const jsonMode = process.argv.includes('--json')

const errors = []
const warnings = []
const stats = {}

const err = (msg) => errors.push(msg)
const warn = (msg) => warnings.push(msg)

/** '@' 开头的特殊跳转目标白名单（引擎实现见 engine.js）：
 *  @restart 全量重置回 entry；@loop:<sceneId> 时间循环部分保留后回指定场景（M11）
 */
// 模式契约表来自 lib/modes.mjs（可注册）：新增模式时改那里一处即可，
// 校验器、图遍历、CLI 自动同步。
const MODE_EDGES = modeEdgeTable()

/** ID 命名空间：<标识>[.<标识>]*，标识为小写字母数字（允许 - _ 连接）
 *  新内容推荐用 '.' 分层（castle.gallery），历史内容用 '-'（starport-hub）同样合法
 */
const ID_PATTERN = /^[a-z][a-z0-9]*([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/

// ---------- 数值域字段校验的辅助（审计 F5） ----------
// 允许的动态域前缀：账本 §1.3/内容里以点路径分层的状态字段。
// 顶层裸字段（gold/hp/karma/...）必须已在 cordis.yml state.initial 声明。
const NUM_DYNAMIC = new Set(['flags', 'items', 'clues', 'testimony', 'case2clues',
  'case2testimony', 'case2flags', 'stock', 'visits', 'rep'])
// 条件表达式作用域里非状态字段的标识符（引擎注入的 extra 上下文 + JS 字面量/关键字）
const EXPR_EXTRA = new Set(['scene', 'choice', 'effects', 'true', 'false', 'null',
  'undefined', 'NaN', 'Infinity', 'typeof', 'instanceof', 'void', 'delete', 'new',
  'in', 'of', 'function', 'return', 'if', 'else', 'Math', 'Number', 'String',
  'Object', 'Array', 'JSON', 'length'])
/** 提取表达式里的点路径标识符 token（'gold >= 10' → ['gold']；'flags.a' → ['flags.a']） */
// ⚠️ 先剥离字符串字面量再取标识符：否则 `flags.hushi.questionWord === "both"`
//    里的 "both" 会被当成顶层数值字段，报「cordis.yml 未声明」的假警告
//    （M14 引入字面量比较时发现并修复）。
const exprPathTokens = (expr) =>
  String(expr)
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
    .match(/[A-Za-z_$][\w$]*(?:\.[\w$]+)*/g) ?? []
/** effects 键是否是动态域（flags.xxx / clues.xxx / ...）或引擎字段 */
const isNumDynamicKey = (key) => NUM_DYNAMIC.has(String(key).split('.')[0])

// ---------- 载入配置与内容 ----------
const config = loadYaml(await readFile(join(root, 'cordis.yml'), 'utf8'))
const engineEntry = config.find((e) => e.id === 'engine')?.config?.entry ?? 'start'
const packs = config.find((e) => e.id === 'scenes')?.config?.packs ?? []
// 模式场景 ↔ 插件配置的交叉校验数据（审计 F3/F5）：
// 内容包的 battle.enemy / trade.days 与 cordis.yml 的 combat/trade 配置是
// 跨文件契约，运行时才炸的错误应在开发期被 lint 拦下。
const stateCfg = config.find((e) => e.id === 'state')?.config?.initial ?? {}
const enemyTable = config.find((e) => e.id === 'combat')?.config?.enemies ?? {}
const tradeGoods = config.find((e) => e.id === 'trade')?.config?.goods ?? {}
const tradeSchedule = Array.isArray(config.find((e) => e.id === 'trade')?.config?.schedule)
  ? config.find((e) => e.id === 'trade')?.config?.schedule
  : []
const scheduleDays = tradeSchedule[0]?.length ?? 0
const achList = config.find((e) => e.id === 'achievements')?.config?.list ?? []

const dict = Object.create(null)
for (const path of packs) {
  const mod = await import(pathToFileURL(join(root, path)).href)
  Object.assign(dict, mod.default ?? {})
}
const ids = Object.keys(dict)

// ---------- 1. ID 命名 ----------
for (const id of ids) {
  if (!ID_PATTERN.test(id)) err(`[命名] 场景 ID 不符合规范: ${id}`)
}

// ---------- 1b. 模式是否注册 ----------
// 未注册的 mode（多半是 mode: 'batle' 这类拼写错误）过去被静默按 normal 处理，
// 表现为"插件没接管、引擎渲染了一堆空选项"。引擎化后模式是可注册的表，此处拦截。
for (const [id, scene] of Object.entries(dict)) {
  const mode = scene.mode ?? 'normal'
  if (!isKnownMode(mode)) {
    err(`[模式] 场景 ${id} 声明了未注册的模式 "${mode}"（拼写错误？自定义模式请用 lib/modes.mjs 的 registerMode 注册）`)
  }
}

// ---------- 2. 文本厚度 ----------
let totalChars = 0
for (const [id, scene] of Object.entries(dict)) {
  const len = (scene.title ?? '').length + (scene.text ?? '').length +
    (scene.choices ?? []).reduce((n, c) => n + (c.text ?? '').length, 0)
  totalChars += len
  if (len < 120) {
    // 模式接管场景（battle/trade）的文本通常较短，降为告警而非错误
    const level = scene.mode && scene.mode !== 'normal' ? warn : err
    level(`[厚度] 场景 ${id} 正文仅 ${len} 字（目标 ≥ 120）`)
  }
}
stats.scenes = ids.length
stats.chars = totalChars
stats.avgChars = Math.round(totalChars / ids.length)

// ---------- 3. 收集跳转与变量引用 ----------
const varRefs = { read: new Set(), write: new Set() }
const endings = []
// 数值域裸字段引用（审计 F5）：{ read: Set<string>, write: Set<string> }，顶层无点路径
const numRead = new Set()
const numWrite = new Set()

const collectExprVars = (expr, target) => {
  // 收集完整点路径（'flags.loop.n >= 3' → flags.loop.n，M11 引入多级 flags 后
  // 修：旧实现只抓首段，把 flags.loop.n 截成 flags.loop 导致账本误报）
  for (const m of String(expr).matchAll(/\b(flags|items)(?:\.[\w]+)+/g)) {
    target.add(m[0])
  }
}
const collectEffectVars = (effects) => {
  for (const key of Object.keys(effects ?? {})) {
    if (key.startsWith('flags.') || key.startsWith('items.')) varRefs.write.add(key)
  }
}

for (const [id, scene] of Object.entries(dict)) {
  collectEffectVars(scene.onEnter)
  const choices = scene.choices ?? []
  // 结局判定：无选项，或所有选项都是"重开"（@restart）——后者是结算后的重玩入口
  // 模式接管场景（battle/trade）由插件终结，不在此判为结局
  const isEnding = (scene.mode == null || scene.mode === 'normal') &&
    (choices.length === 0 || choices.every((c) => String(c?.goto ?? '').startsWith('@')))
  if (isEnding) endings.push(id)
  for (const choice of choices) {
    if (choice.if) collectExprVars(choice.if, varRefs.read)
    collectEffectVars(choice.do)
    // 数值域裸字段（审计 F5）：效果键直接写顶层；条件里读裸标识符
    for (const key of Object.keys(choice.do ?? {})) {
      if (!isNumDynamicKey(key) && !key.includes('.')) numWrite.add(key)
    }
    if (choice.if) {
      for (const p of exprPathTokens(choice.if)) {
        const head = p.split('.')[0]
        if (!NUM_DYNAMIC.has(head) && !EXPR_EXTRA.has(head) && !p.includes('.')) numRead.add(p)
      }
    }
  }
  // onEnter 效果的数值字段写入
  for (const key of Object.keys(scene.onEnter ?? {})) {
    if (!isNumDynamicKey(key) && !key.includes('.')) numWrite.add(key)
  }
}

// ---------- 4. 悬空 goto ----------
for (const [id, scene] of Object.entries(dict)) {
  for (const [i, choice] of (scene.choices ?? []).entries()) {
    const target = choice?.goto
    if (target === undefined) {
      // error（审计 F11）：运行时选中无 goto 选项 = 重进当前场景 → onEnter 副作用
      // 重复执行（与 scenes.js findDangling 的运行时拦截同口径；曾仅为 warn 不阻塞）
      err(`[悬空] ${id} 第 ${i + 1} 个选项没有 goto（选中后无法流转，会重放 onEnter）`)
      continue
    }
    const t = String(target)
    if (t.startsWith('@')) {
      if (!isSpecialGoto(t)) {
        err(`[悬空] ${id} -> ${t} 不是引擎支持的特殊目标（白名单: @restart / @loop:<场景ID>）`)
      } else if (t.startsWith(LOOP_PREFIX)) {
        // @loop: 的后缀必须是已定义场景，否则运行时 goto 会崩（§16.2 规格）
        const loopScene = t.slice(LOOP_PREFIX.length)
        if (!(loopScene in dict)) err(`[悬空] ${id} -> @loop:${loopScene} 目标场景 "${loopScene}" 未定义`)
      }
      continue
    }
    if (!(t in dict)) err(`[悬空] ${id} 第 ${i + 1} 个选项 -> "${t}" 未定义`)
  }
  // 模式接管场景的流转分支同样是跳转边（battle.onWin/onLose/onFlee、trade.onEnd）
  for (const [mode, keys] of Object.entries(MODE_EDGES)) {
    for (const key of keys) {
      const t = scene[mode]?.[key]
      if (t !== undefined && !(String(t) in dict)) {
        err(`[悬空] ${id} 的 ${mode}.${key} -> "${t}" 未定义`)
      }
    }
  }
}

// ---------- 4b. 模式场景 ↔ 插件配置契约（跨文件，审计 F3） ----------
// battle.enemy 必须存在于 combat.enemies；trade.days 不得超出行情表列数。
// 这些此前只在运行时暴露（缺敌人曾导致"半放行"卡场景，见 combat.js begin）。
for (const [id, scene] of Object.entries(dict)) {
  if (scene.mode === 'battle') {
    const enemy = scene.battle?.enemy
    if (enemy === undefined) {
      err(`[契约] ${id} 是 battle 场景但未声明 battle.enemy`)
    } else if (!(enemy in enemyTable)) {
      err(`[契约] ${id} 的 battle.enemy "${enemy}" 未在 cordis.yml combat.enemies 中定义（运行时会拒绝开战）`)
    }
  }
  if (scene.mode === 'trade') {
    const days = scene.trade?.days ?? 5
    if (scheduleDays > 0 && days > scheduleDays) {
      err(`[契约] ${id} 的 trade.days=${days} 超出行情表列数 ${scheduleDays}（第 ${scheduleDays + 1} 天起卖出价为 0）`)
    }
  }
}
const goodsCount = Object.keys(tradeGoods).length
if (tradeSchedule.length && goodsCount && tradeSchedule.length !== goodsCount) {
  err(`[契约] 行情表行数 ${tradeSchedule.length} 与商品数 ${goodsCount} 不一致（第 ${goodsCount + 1} 个商品无行情，卖出价恒 0）`)
}

// ---------- 4c. 成就 when 的场景引用（审计 F3） ----------
for (const item of achList) {
  const when = item?.when
  if (typeof when !== 'string') continue
  for (const m of when.matchAll(/scene\s*===\s*['"]([^'"]+)['"]/g)) {
    if (!(m[1] in dict)) err(`[成就] "${item.id}" 的 when 引用了不存在的场景 "${m[1]}"（成就将永不触发）`)
  }
}

// ---------- 5. 可达性（复用 lib/graph.mjs，口径与 tests/traverse.mjs 一致）----------
if (!(engineEntry in dict)) err(`[可达] entry 场景 "${engineEntry}" 不存在`)
const graph = analyze(dict, engineEntry)
const reachable = graph.reachable
for (const id of ids) {
  if (!reachable.has(id)) err(`[可达] 场景 ${id} 从 entry 不可达`)
}
// 悬空边：analyze 已按统一的出边口径（选项 goto + 模式流转边）算过一遍，
// 这里补报第 4 节没覆盖到的形态（如 mode 边指向不存在的场景）
for (const edge of graph.dangling) {
  if (edge.kind === 'mode') {
    err(`[悬空] ${edge.from} 的 ${edge.raw} -> "${edge.to}" 未定义`)
  }
}
// 孤立场景：除 entry 外零入度 —— 多半是漏挂入口或写错了跳转目标
for (const id of graph.deadEnds) {
  warn(`[孤立] 场景 ${id} 没有任何入边（除 entry 外应至少被引用一次）`)
}

// ---------- 6. 结局可达性 ----------
for (const id of endings) {
  if (!reachable.has(id)) err(`[结局] ${id} 不可达`)
}
stats.endings = endings.length
stats.endingsReachable = endings.filter((id) => reachable.has(id)).length

// ---------- 7. 疑似假选择 ----------
for (const [id, scene] of Object.entries(dict)) {
  const choices = scene.choices ?? []
  const seen = new Map()
  for (const [i, choice] of choices.entries()) {
    const hasEffect = !!choice?.do
    const hasCond = !!choice?.if
    const key = String(choice?.goto ?? '')
    if (!hasEffect && !hasCond && key) {
      if (seen.has(key)) {
        warn(`[假选择] ${id} 第 ${i + 1} 个选项与第 ${seen.get(key)} 个选项同归宿且无副作用`)
      } else {
        seen.set(key, i + 1)
      }
    }
  }
}

// ---------- 8. 与叙事账本的一致性 ----------
let ledgerDeclared = new Set()
try {
  const raw = await readFile(join(root, 'docs/NARRATIVE-LEDGER.md'), 'utf8')
  // 只解析「生效中」章节：规划中（M2/M3 才接入）的变量不参与死变量判定
  const start = raw.indexOf('## 1. 状态清单')
  const end = raw.indexOf('## 2.')
  const ledger = start >= 0 ? raw.slice(start, end > start ? end : undefined) : raw
  // 收集完整点路径（M11 后账本含多级声明如 `flags.loop.n`；旧正则只抓首段）
  for (const m of ledger.matchAll(/`(flags|items)(?:\.[\w]+)+`/g)) {
    ledgerDeclared.add(m[0].slice(1, -1))
  }
} catch {
  warn('[账本] 未找到 docs/NARRATIVE-LEDGER.md，跳过变量一致性检查')
}

for (const v of new Set([...varRefs.read, ...varRefs.write])) {
  if (!ledgerDeclared.has(v)) warn(`[账本] 内容使用了 ${v}，但叙事账本未声明`)
}
const deadVars = [...ledgerDeclared].filter((v) => !varRefs.read.has(v) && !varRefs.write.has(v))
for (const v of deadVars) warn(`[死变量] 账本声明了 ${v}，但内容既不写也不读`)
stats.flags = [...ledgerDeclared].filter((v) => v.startsWith('flags.')).length
stats.items = [...ledgerDeclared].filter((v) => v.startsWith('items.')).length
stats.deadVars = deadVars.length

// ---------- 9. 数值域字段 ↔ state.initial 一致性（审计 F5） ----------
// 内容裸写/裸读的顶层数值字段（gold/hp/karma/suspectLevel/tradeProfit/...）必须在
// cordis.yml state.initial 声明过；未声明 = 拼写错误或漏声明，运行时静默失效
// （条件恒 false / 效果写进孤儿字段），此前零防线。
const topKeys = new Set(Object.keys(stateCfg))
const unknownNums = [...new Set([...numRead, ...numWrite])]
  .filter((p) => !topKeys.has(p))
  .sort()
for (const p of unknownNums) {
  warn(`[数值] 内容引用 "${p}"，但 cordis.yml state.initial 未声明该字段（拼写错误或漏声明？）`)
}
stats.numFields = topKeys.size
stats.numOrphans = unknownNums.length

// ---------- 输出 ----------
if (jsonMode) {
  console.log(JSON.stringify({ stats, errors, warnings }, null, 2))
} else {
  console.log('内容统计：')
  console.log(`  场景 ${stats.scenes} | 正文 ${stats.chars} 字 | 均长 ${stats.avgChars} 字`)
  console.log(`  结局 ${stats.endings}（可达 ${stats.endingsReachable}） | flags ${stats.flags} | items ${stats.items} | 死变量 ${stats.deadVars}`)
  console.log(`  数值字段 ${stats.numFields}（initial 顶层） | 孤儿数值引用 ${stats.numOrphans}`)
  if (warnings.length) {
    console.log(`\n⚠ 警告 ${warnings.length} 项：`)
    for (const w of warnings) console.log('  - ' + w)
  }
  if (errors.length) {
    console.log(`\n✘ 错误 ${errors.length} 项：`)
    for (const e of errors) console.log('  - ' + e)
  } else {
    console.log('\n✔ 无错误')
  }
}

process.exit(errors.length ? 1 : 0)
