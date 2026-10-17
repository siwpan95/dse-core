# 与 Node 版（dse-core）的差异

同一套设计在两个语言里落地，行为对齐但实现不同。本文列出**有意的差异**与**迁移时要注意的点**。

## 有意的差异

| 项 | Node 版 | Python 版 | 原因 |
|---|---|---|---|
| 主循环 | async（`await io.ask()`） | 同步（`io.ask()` 阻塞读一行） | Python 的异步在这里没有收益，同步更易推理、更好测 |
| 插件容器 | cordis 4.0（外部依赖） | `cordis/` 迷你实现（约 200 行，零依赖） | 只需要服务容器 + 依赖注入 + 事件，不需要 fiber/HMR |
| 配置文件 | `cordis.yml`（js-yaml） | `cordis.json`（标准库）；装了 PyYAML 也可读 `cordis.yml` | 零第三方依赖优先 |
| 内容包 | `export default {...}`（ESM） | `SCENES = {...}` + 可选 `PACK = {...}`；也支持 `.json` | Python 模块约定 |
| 音效 | 程序化合成 PCM + 播放子进程 | 骨架：同样的事件订阅与音色表，发声交给 `config.player` 钩子 | 标准库无跨平台音频 |
| 热重载 | chokidar 监听 | 后台线程轮询 mtime，默认关闭 | 标准库无文件监听 |
| 日志 | `plugin-logger-console`（stdout） | `ctx.logger()` 写 **stderr** | 保证 stdout 只放结果（`scenes --json \| jq` 不被污染） |
| 插件级 HMR | `--expose-internals` + vendor 插件 | 不提供 | Node 内部 API 无对应物 |

## 刻意保持一致的部分

- 场景字段：`title` / `text` / `onEnter` / `mode` / `choices[{text, if, do, goto}]`
- 模式契约：battle / trade / diary / dialogue 的字段名与流转边相同
- 效果语义：数值=加减、非数值=赋值、点路径=深层写入
- 特殊跳转：`@restart`、`@loop:<场景ID>`、`state.config.loopKeep`
- 状态字段名：`diaryRead` / `dialogueAsked` / `tradeProfit` / `stock` …
- CLI 子命令与 `--json` 输出结构
- 校验器检查项（11 项）与叙事账本格式

## 条件表达式的兼容层

Node 版内容里的 JS 写法在 Python 版里**可以直接用**，求值前会做一次转换：

| 内容里的写法 | 转换后 |
|---|---|
| `a === b` / `a !== b` | `a == b` / `a != b` |
| `a && b` / `a \|\| b` | `a and b` / `a or b` |
| `!flag` | `not flag` |
| `gold`、`items.token` | `__g('gold')`、`__g('items.token')` |

字符串字面量会在转换前被挖出来再回填，所以 `flags.x === "both"` 里的 `both`
不会被当成状态字段（Node 版踩过这个坑）。直接写 Python 风格（`==` / `and` / `not`）也可以。

⚠️ 两版都**不是沙箱**：Node 用 `new Function`，Python 用 `eval`。信任边界一致 ——
只运行可信内容包；玩家在终端输入的内容不会进入表达式求值。

## 迁移内容包时的注意点

1. `export default {...}` → `SCENES = {...}`，`export const pack = {...}` → `PACK = {...}`
2. 布尔值：`true/false` → `True/False`
3. 点路径字符串不变（`'items.token': 1`）
4. ID 含连字符的场景在 Python 里同样是字符串键，加引号即可（本来就要加）
5. 成就的 `when` 写法可沿用（`scene === 'forest-win'`）
6. 数值字段的"加减"语义一致：`{'gold': 5}` 是 +5，不是赋值为 5
