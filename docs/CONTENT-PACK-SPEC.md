# 内容包规范

一个内容包 = **一个 ESM 模块**，默认导出场景字典，可选导出 `pack` 元数据。

```js
export const pack = { id, name, version, entry, description, author, modes, requires }
export default { '场景ID': { ...场景定义 } }
```

完整机器可读定义见 [`schema/scene.schema.json`](../schema/scene.schema.json)（编辑器补全 + CI 校验）；运行时校验由 `plugins/scenes.js` 的 `validate()` 负责，两者口径保持一致。

## 1. 场景（Scene）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | ✔ | 正文，支持 `{path}` 状态插值 |
| `title` | string | | 标题，支持插值；缺省用场景 ID |
| `onEnter` | Effects | | 进入场景时执行的效果 |
| `mode` | string | | 缺省 `normal`；其他值由能力插件接管 |
| `choices` | Choice[] | | 省略或空 = 结局场景 |
| `battle` / `trade` / `diary` / `dialogue` | object | | 对应 mode 的配置（见 §4） |

## 2. 选项（Choice）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `text` | string | ✔ | 选项文本，支持插值 |
| `if` | string | | 显示条件；缺省恒真 |
| `do` | Effects | | 选中后执行的效果 |
| `goto` | string | ✔ | 跳转目标；缺 goto 会被校验器判为错误（选中后无法流转，会重放 `onEnter`） |

> 选项编号是**条件过滤后**的序号：互斥条件的两条选项不会同时出现，编号会前移。

## 3. 效果（Effects）与条件（if）

Effects 是一个普通对象：

| 写法 | 语义 |
|---|---|
| `{ hp: -5 }` | 数值 → **加减** |
| `{ name: '勇者' }` | 非数值 → 赋值 |
| `{ 'flags.doorOpen': true }` | 点路径 → 深层赋值 |
| `{ 'items.sword': +1 }` | 点路径 + 数值 → 深层计数 |

`if` 是字符串表达式，用 `new Function` 求值，玩家状态通过 `with` 注入作用域：

```
'hp >= 10 && gold > 0'    'items.sword >= 1'    '!flags.doorLocked'
```

⚠️ **这不是沙箱**，表达式里可直接访问 `process`、`globalThis.fetch`。触发面仅限内容包与 `cordis.yml` 的 `when` 字段；玩家在终端里输入的内容不会进入这里。

写入 `__proto__` / `constructor` / `prototype` 段会被 `state` 拒绝（原型污染防护）。

## 4. 模式契约

| mode | 插件 | 场景字段 | 流转边 |
|---|---|---|---|
| `battle` | combat | `battle: { enemy, onWin, onLose, onFlee }` | onWin / onLose / onFlee |
| `trade` | trade | `trade: { name, days, onEnd }` | onEnd |
| `diary` | diary | `diary: { onExit }` | onExit |
| `dialogue` | dialogue | `dialogue: { npc, notes, onEnd, topics[] }` | onEnd |

- `battle.enemy` 必须在 `cordis.yml` 的 `combat.enemies` 中定义（否则校验报 `[契约]` 错误）。
- `trade.days` 不得超过 `trade.schedule` 的列数（超出天数卖出价为 0）。
- `dialogue.topics[]` = `{ id, name, reply, if?, effect? }`，`notes` 是注意点预算（0 = 不限）。
- 新增自定义 mode：见 [PLUGIN-GUIDE.md](PLUGIN-GUIDE.md)。

## 5. 特殊跳转目标

| 目标 | 语义 |
|---|---|
| `@restart` | 状态全量重置回 `engine.entry`（重开一局） |
| `@loop:<场景ID>` | **部分重置**后跳转：状态回 `initial`，`state.config.loopKeep` 声明的域从旧状态保留 |

`@loop:` 的目标场景必须存在（校验器会把该边计入可达性）。

## 6. manifest（`export const pack`，可选）

| 字段 | 说明 |
|---|---|
| `id` | 包 ID，小写字母开头，仅 `a-z 0-9 _ -` |
| `name` / `version` / `description` / `author` | 展示信息，`version` 用语义化版本 |
| `entry` | 本包推荐入口（缺省取第一个场景） |
| `modes` | 用到的模式（缺省自动探测） |
| `requires.plugins` | 依赖哪些能力插件 |
| `requires.state` | 依赖 `state.initial` 预声明哪些顶层字段 |

`dse packs` 读取并展示；`lib/registry.mjs` 的 `validateManifest()` 校验。

## 7. 约定与校验

`dse check`（`scripts/lint-content.mjs`）检查：

1. **ID 命名**：`<标识>[.<标识>]*`，标识为小写字母数字（允许 `-` `_` 连接）
2. **模式注册**：未注册的 mode 直接报错（多半是拼写错误）
3. **正文厚度**：normal 场景建议 ≥120 字（模式接管场景仅告警）
4. **悬空 goto**：含模式流转边与 `@loop:` 目标
5. **跨文件契约**：`battle.enemy ↔ combat.enemies`、`trade.days ↔ schedule`、成就 `when` 引用的场景
6. **可达性**：从 entry BFS，全部场景可达；结局全部可达
7. **孤立场景**：除 entry 外零入度的场景（告警）
8. **疑似假选择**：无副作用且与其他选项同归宿
9. **叙事账本**：内容引用的 `flags.*` / `items.*` 必须在 `docs/NARRATIVE-LEDGER.md` 声明；声明了没人用 = 死变量
10. **数值字段**：内容裸读写的顶层数值字段必须在 `state.initial` 声明

## 8. 内容包结构模板

`templates/` 下有 7 种叙事结构骨架，`dse new <包名> --template=<模板>` 生成：

| 模板 | 结构 | 适用 |
|---|---|---|
| `branch` | 分支—瓶颈 | 线性主线、有明确下一段的剧情 |
| `hub` | 枢纽辐射 | 侦探调查、多线索并行、城镇探索 |
| `loop` | 时间循环（`@loop`） | 一夜/一天反复重来、拼线索 |
| `battle` | 战斗支线 | 需要一场战斗的段落 |
| `trade` | 经营支线 | 买卖、囤货、赌行情 |
| `diary` | 日记回溯 / 年代跃迁 | 多年跨度、回读已走过的内容 |
| `dialogue` | 对话 / 谈判 | 问话、谈判、证词收集 |

## 9. 安全

内容包是**可执行代码**：`import()` 先于 `validate()` 执行，模块顶层代码立即运行并拥有完整 Node 权限。只装可信来源，`validate()` 不是安全控制。
