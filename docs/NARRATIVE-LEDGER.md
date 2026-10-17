# 叙事账本（NARRATIVE-LEDGER）

> 状态变量的唯一权威清单。校验器（`python scripts/lint_content.py`）读本文件的
> 「§1 状态清单」段，与内容里实际读写的变量对账：内容用了没声明 → 告警；
> 声明了没人用 → 死变量告警。新增内容包时把它引入的 `flags.*` / `items.*` 补进 §1。

## 1. 状态清单

### starter（引擎自带示例内容包）

| 变量 | 类型 | 含义 | 写入处 |
|---|---|---|---|
| `flags.starter.mountain` | bool | 走了"往北进山"这条线 | start 选项 1 |
| `flags.starter.market` | bool | 走了"往东赶集"这条线 | start 选项 2 |
| `flags.starter.fled` | bool | 在半坡退了回去（没打） | forest 选项 2 |
| `flags.starter.wolfWin` | bool | 放倒了独眼狼 | forest-win 的 onEnter |
| `flags.starter.backHome` | bool | 打赢后先回了村 | forest-win 选项 2 |
| `items.token` | int | 渡口令牌（狼窝旁的木匣里） | forest-win 的 onEnter |

### 引擎通用

| 变量 | 类型 | 含义 | 读写方 |
|---|---|---|---|
| `diaryRead` | list | 已走过的篇目 ID（可回溯重读） | diary 插件 |
| `dialogueAsked` | list | 已问过的话题 ID（防重复询问） | dialogue 插件 |
| `stock` | dict | 经营库存 | trade 插件 |
| `tradeDay` / `tradeBaseGold` / `tradeProfit` | int/null | 经营天数 / 开市基线 / 收市净赚 | trade 插件 |
| `locale` | str | 当前语言 | i18n 插件 |

## 2. 不在对账范围内的变量

以下变量由内容包的**模式配置**内部读写（对话话题的 effect、战斗掉落等），
校验器当前只采集 `choices[].do` / `onEnter` / `choices[].if` 里的引用，
因此这些不计入死变量判定，也不必写进 §1：

- `flags.starter.askedBoat` / `askedFog` / `askedToken` —— dialogue 话题 effect
- `items.wolf_pelt` —— combat 敌人 `wolf` 的 drops
- `clues.loop.*` / `flags.loop.*` —— 时间循环保留域（`state.config.loopKeep`）

## 3. 约定

1. **先声明后使用**：所有 `flags.*` / `items.*` 必须在 §1 登记，且中间层要在插件清单的
   `state.initial` 预声明（否则条件表达式会取不到值）。
2. **命名分层**：`<包>.<节拍>.<细节>`，例如 `flags.starter.wolfWin`。
3. **数值字段**：顶层裸字段（`gold` / `hp` / `karma` …）不走账本，
   直接在 `state.initial` 声明；校验器另有「数值字段」检查项兜底。
4. **条件写法**：Python 版兼容 Node 版写法（`===` / `&&` / `!x` 会自动转换），
   直接写 Python 风格（`==` / `and` / `not`）也可以。
