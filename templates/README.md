# 内容包模板

`dse new <包名> --template=<模板>` 从这里的模板生成骨架（占位符 `__PACK_ID__` / `__NS__` 会被替换）。

生成后：

```bash
node cli.js new my-pack --template=hub --ns=my --register
#   --template  选结构（缺省 branch）
#   --ns        场景 ID 的命名空间前缀（缺省 = 包名去掉 - _）
#   --register  顺手挂进 cordis.yml 的 scenes.config.packs
node cli.js check        # 边填边校验
```

## 七种结构

| 模板 | 结构 | 适用 | 关键机制 |
|---|---|---|---|
| `branch.js` | 分支—瓶颈 | 线性主线、有明确下一段的剧情 | 多分支 → 汇合到一个 bottleneck → 按状态分结局 |
| `hub.js` | 枢纽辐射 | 侦探调查、多线索并行、城镇探索 | 枢纽可反复回到，辐条走完回枢纽，收束门用 `if` 计数 |
| `loop.js` | 时间循环 | 一夜/一天反复重来、拼线索 | `goto: '@loop:<场景>'` + `state.config.loopKeep` |
| `battle.js` | 战斗支线 | 需要一场战斗的段落 | `mode: 'battle'` + combat 插件 |
| `trade.js` | 经营支线 | 买卖、囤货、赌行情 | `mode: 'trade'` + trade 插件，`tradeProfit` 分结局 |
| `diary.js` | 日记回溯 / 年代跃迁 | 多年跨度、回读已走过的内容 | `mode: 'diary'`（篇目来自 `state.diaryRead`） |
| `dialogue.js` | 对话 / 谈判 | 问话、谈判、证词收集 | `mode: 'dialogue'` + topics / notes |

## 填充 checklist

1. 改 `pack.id` / `name` / `description`（生成时已替换，但要写人话）。
2. 把所有 `TODO` 换成真内容；normal 场景正文建议 ≥120 字（校验器会报）。
3. 场景 ID 用命名空间分层（`my.hub` / `my.spokeA`），避免与别的包撞车。
4. 用到的顶层数值字段（如 `myEvidence`）必须在 `cordis.yml` 的 `state.initial` 预声明，
   否则条件表达式会 `ReferenceError`（校验器的「数值字段」检查项会拦下）。
5. 用到的 `flags.*` / `items.*` 补进 `docs/NARRATIVE-LEDGER.md`。
6. 跑 `node cli.js check` → 0 错误 0 警告；跑 `node cli.js doctor` 看图结构。

## 组合用法

真实内容往往是几种结构的叠加，例如：

- 主线用 `branch`，中间插一段 `battle` 和一个 `hub` 调查；
- `hub` 的某条辐条是 `dialogue`，收束后用 `trade` 结算；
- 多年跨度的主线用 `diary` 做回溯入口。

模板之间是**可拼接的普通场景字典**：把生成的文件合并、或让两个包的场景互相 `goto`（跨包跳转由校验器统一检查）。
