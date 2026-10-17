# 叙事账本（NARRATIVE-LEDGER）

> 状态变量的唯一权威清单。校验器（`dse check`）读本文件的「§1 状态清单」段，
> 与内容里实际读写的变量对账：内容用了没声明 → 告警；声明了没人用 → 死变量告警。
> 新增内容包时，把它新引入的 `flags.*` / `items.*` 补进 §1。

## 1. 状态清单

### starter（引擎自带示例内容包）

| 变量 | 类型 | 含义 | 写入处 |
|---|---|---|---|
| `flags.starter.mountain` | boolean | 走了"往北进山"这条线 | start 选项 1 |
| `flags.starter.market` | boolean | 走了"往东赶集"这条线 | start 选项 2 |
| `flags.starter.fled` | boolean | 在半坡退了回去（没打） | forest 选项 2 |
| `flags.starter.wolfWin` | boolean | 放倒了独眼狼 | forest-win 的 onEnter |
| `flags.starter.backHome` | boolean | 打赢后先回了村 | forest-win 选项 2 |
| `items.token` | number | 渡口令牌（狼窝旁的木匣里） | forest-win 的 onEnter |

### 引擎通用

| 变量 | 类型 | 含义 | 读写方 |
|---|---|---|---|
| `diaryRead` | string[] | 已走过的篇目 ID（可回溯重读） | diary 插件 |
| `dialogueAsked` | string[] | 已问过的话题 ID（防重复询问） | dialogue 插件 |
| `stock` | object | 经营库存 | trade 插件 |
| `tradeDay` / `tradeBaseGold` / `tradeProfit` | number/null | 经营天数 / 开市基线 / 收市净赚 | trade 插件 |
| `locale` | string | 当前语言 | i18n 插件 |

## 2. 不在对账范围内的变量

以下变量由内容包的**模式配置**内部读写（对话话题的 `effect`、战斗掉落等），
校验器当前只采集 `choices[].do` / `onEnter` / `choices[].if` 里的引用，
因此这些不计入死变量判定，也不必写进 §1：

- `flags.starter.askedBoat` / `askedFog` / `askedToken` —— dialogue 话题 effect
- `items.wolf_pelt` —— combat 敌人 `wolf` 的 drops
- `clues.loop.*` / `flags.loop.*` —— 时间循环保留域（`state.config.loopKeep`）

## 3. 约定

1. **先声明后使用**：所有 `flags.*` / `items.*` 必须在 §1 登记，且中间层要在
   `cordis.yml` 的 `state.initial` 预声明（否则条件表达式会 ReferenceError）。
2. **命名分层**：`<包>.<节拍>.<细节>`，例如 `flags.starter.wolfWin`。
3. **数值字段**：顶层裸字段（`gold` / `hp` / `karma` …）不走账本，
   直接在 `cordis.yml` 的 `state.initial` 声明；校验器另有「数值字段」检查项兜底。
