# 迁移指南：从 dict-scene-engine 到 dse-core

`dict-scene-engine` 是「引擎 + 41 个内容包」同仓的做法，扩充到 587 场景后暴露出问题：改引擎要动内容仓、内容包没有身份、模式契约靠两份表人工同步。
`dse-core` 把引擎抽出来独立成库。本文是把现有内容迁过来的步骤清单。

## 三种接入姿势（选一）

| 方式 | 做法 | 适用 |
|---|---|---|
| A. 内容仓引用引擎（推荐） | 内容仓 `npm i file:../dse-core`（或 `git submodule`），`cordis.yml` 里插件路径指向 `node_modules/dse-core/plugins/*.js` | 内容仓想保持独立仓库 |
| B. 引擎在上级目录 | `cordis.yml` 里写 `../../../dse-core/plugins/scenes.js`（同 `tests/fixtures/loop-project` 的写法） | 本地开发、不想装依赖 |
| C. 直接复制 | 把 `plugins/ lib/ sdk/ schema/ templates/ scripts/` 拷进内容仓 | 一次性搬运、不再同步 |

## 迁移步骤

### 1. cordis.yml

- 插件路径改为指向 dse-core（`./plugins/x.js` → `<引擎>/plugins/x.js`）。
- 新增两个可选条目：

  ```yaml
  - id: save-migrate
    name: <引擎>/plugins/save-migrate.js
    config: { version: 1, migrations: {} }

  - id: i18n
    name: <引擎>/plugins/i18n.js
    config: { defaultLocale: zh-CN, locales: {} }
  ```

  两者缺省为空骨架，行为与引入前一致；`save-migrate` 一旦注册，`save` 插件会在存档里写版本号。

### 2. 内容包补 manifest（可选但推荐）

每个 `content/*.js` 加：

```js
export const pack = {
  id: 'hushi', name: '藏晖室札记', version: '1.0.0',
  entry: 'hushi.p1', modes: ['diary'],
  requires: { plugins: ['diary'], state: ['diaryRead'] },
}
```

收益：`dse packs` 可列举、依赖可被预检、文档可自动生成。不写也不影响运行（`lib/registry.mjs` 会从文件名与场景自动推导）。

### 3. 模式契约表（**必须改**）

老版本在 `scripts/lint-content.mjs` 的 `MODE_EDGES` 与 `tests/traverse.mjs` 的 `MODE_NEXT` 各写一份。现在：

- lint 侧：删掉本地 `MODE_EDGES`，改 `import { modeEdgeTable } from '../lib/modes.mjs'`（dse-core 的 lint 已改好，直接用引擎的脚本）；
- traverse 侧：删掉本地 `MODE_NEXT`，改

  ```js
  const MODE_NEXT = Object.fromEntries(
    Object.entries(modeEdgeTable()).map(([mode, keys]) => [mode, (s) => keys.map((k) => s?.[mode]?.[k])]),
  )
  ```

- 自定义 mode：调 `registerMode('shop', { edges: ['onClose'] })`，两处自动同步。

### 4. 测试

| 老文件 | 处理 |
|---|---|
| `tests/e2e.mjs`（2988 行，断言具体内容） | 随内容走 —— 它是内容仓的资产，继续留在内容仓 |
| `tests/traverse.mjs` | 用引擎版（已改为读注册表），内容仓直接用 |
| `tests/coverage.mjs` | 用引擎版（已兼容 `has(out, ...)` 与 `waitFor(...)` 两种断言写法） |
| `tests/cli.mjs` | 引擎版覆盖的是引擎命令；内容仓若有自己的命令再补 |
| `scripts/lint-content.mjs` | 用引擎版；`docs/NARRATIVE-LEDGER.md` 留在内容仓（账本是内容的资产） |

### 5. 内容侧的已知差异

| 项 | 老行为 | 新行为 | 影响 |
|---|---|---|---|
| 首条输入 | 开局第一条插件命令（save/load）可能判为"未识别" | 引擎启动前让出两个宏任务，第一条命令即生效 | 修好，无需改内容 |
| 存档版本 | 无 | 注册 `save-migrate` 后写 `version` 字段 | 旧档无 version，按 v1 处理，无迁移时恒等 |
| i18n | 无 | 未命中直通 | 老内容零影响 |
| 模式未注册 | 静默按 normal 处理 | 校验报 `[模式]` 错误 | 拼错的 mode 会暴露（好事） |
| 孤立场景 | 不检查 | 告警 | 新增告警项，需清零 |

## 校验迁移结果

```bash
node cli.js doctor          # 环境 + 内容图自检
node cli.js check           # 0 错误 0 警告
node cli.js packs           # 内容包清单
node tests/traverse.mjs     # 结构-状态遍历
node tests/coverage.mjs     # 结局覆盖总门
```
