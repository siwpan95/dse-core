# 架构

## 一句话

> 场景即字典，能力即插件 —— 内容由**场景字典**描述，引擎的每个能力是一个**可插拔插件**，两者通过 `cordis.yml` 声明式组装。

## 分层

```
                 cordis.yml（声明式插件清单）
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   plugins/scenes   plugins/state   plugins/io ...
        │ ctx.scenes      │ ctx.state      │ ctx.io
        └────────┬────────┴────────┬───────┘
                 ▼                 ▼
            plugins/engine ──── 依赖注入(inject)就绪后自动启动
                 │
                 ├─ ctx.waterfall('text/render')     文本渲染管道
                 ├─ ctx.waterfall('engine/command')  输入命令分发
                 ├─ ctx.bail('scene/mode')           模式扩展点
                 ├─ ctx.emit('scene/enter') ...      生命周期事件
                 ▼
            内容包 content/*.js（场景字典）
```

| 层 | 组成 | 能否拔掉 |
|---|---|---|
| 内核 | `scenes` / `state` / `io` / `engine` | 不可拔（引擎定义本身） |
| 系统 | `save` / `save-migrate` / `achievements` / `i18n` | 可拔（拔掉即失去该能力） |
| 能力 | `combat` / `trade` / `diary` / `dialogue` | 可拔（拔掉后对应 mode 回退 normal 渲染） |
| 表现 | `sound` | 可拔 |
| 开发 | `hot-reload` | 可拔 |

## 启动流程（`lib/boot.js`）

1. 创建根 `Context`，`ctx.baseUrl` 指向**项目根**（可由 `boot({ root })` 覆盖 —— 这是一个引擎驱动多个内容项目的关键）。
2. 挂载 `@cordisjs/plugin-loader`，再用 `@cordisjs/plugin-include` 加载 `./cordis.yml`。
3. 若带 `--expose-internals`，额外加载官方 HMR 插件（`vendor/plugin-hmr`）。
4. `await ctx.loader.await()` 等全部插件就绪，返回 ctx。

`game.js`（交互）、`cli.js play`（脚本）、`sdk.createEngine()`（宿主）三者共用这一个流程，不存在第二套启动代码。

## 服务契约

| 服务 | 关键 API | 说明 |
|---|---|---|
| `ctx.scenes` | `get/has/load/reload/rebuild/validate/findDangling`，`dict` `ids` `size` | 场景字典；`rebuild()` 走双缓冲，校验失败不污染旧字典 |
| `ctx.state` | `get/set/apply/check/interpolate/reset/snapshot/restore/view` | 玩家状态；`apply` 对数值是加减，`set` 才是赋值 |
| `ctx.io` | `print/blank/ask/wake` | 终端 IO；换 UI（Web/Discord/TTS）只换这个插件 |
| `ctx.engine` | `start/goto/stop/run/render/defaultCommand`，`current/entry/running` | 主循环与场景解释器 |
| `ctx.save` | `save/load/list/slotFile/validateRecord` | 存档（白名单 + 原子写 + 坏档兜底） |
| `ctx['save-migrate']` | `stamp/migrate/needsMigration/version` | 存档版本迁移 |
| `ctx.achievements` | `unlocked`、`restore()` | 成就（纯事件驱动） |
| `ctx.i18n` | `translate/lookup/locale/missing` | 本地化 |

## 事件协议

| 事件 | 模式 | 用途 |
|---|---|---|
| `text/render` | waterfall | 文本渲染管道（插值 → i18n → 装饰，可层层包裹） |
| `engine/command` | waterfall | 输入命令分发；默认处理器匹配选项编号，插件 prepend 拦截自定义命令 |
| `scene/mode` | bail | **模式扩展点**：返回 truthy 即接管该场景；可返回 `{ redirect }` 请求立即流转 |
| `scene/rendered` | emit | 场景文本渲染完成，插件补画自己的界面（如战斗血条） |
| `scene/enter` / `scene/leave` | emit | 场景生命周期 |
| `choice/made` | emit | 选项被选中、效果执行后 |
| `engine/start` / `engine/end` / `engine/stop` | emit | 游戏生命周期 |
| `achievement/unlock` | emit | 成就解锁 |
| `battle/start` `battle/hit` `battle/crit` `battle/end` | emit | 战斗生命周期（音效插件订阅发声） |
| `save/applied` | emit | 存档写入完成 |
| `hot-reload/applied` | emit | 内容热重载完成 |

`engine/command` 返回值协议：

```js
{ type: 'choice', index }   // 执行第 index 个选项（过滤后的序号）
{ type: 'scene', id }       // 跳转场景
{ type: 'rerender' }        // 重绘当前场景（只重绘，不重进，不重放 onEnter）
{ type: 'noop' }            // 插件已自行处理界面，继续等下一条输入
{ type: 'quit' }            // 退出
{ type: 'nothing' }         // 未识别
```

## 主循环的两条路径

「进入场景」与「重绘场景」是**两条独立路径**：

- **进入场景**（外层）：`scene/leave` → 应用 `onEnter` → `scene/enter` → 结局判定。只在 `current` 真正变化后走一次。
- **重绘场景**（内层）：只重新输出界面，不触碰任何状态。

共用一条路径会导致每次 `rerender` 都重放 `onEnter`（敲一次 stats 就再扣一次金币、战斗中存档让敌人满血复活）。

## 为什么是 Cordis

| 需求 | Cordis 提供的机制 |
|---|---|
| 新能力不改引擎 | 插件 + `ctx.provide` 服务 + 事件监听 |
| 加载顺序正确 | `static inject` 声明依赖，就绪后自动启动 |
| 内容与引擎解耦 | 场景字典描述内容，`cordis.yml` 一行换内容包 |
| 可逆副作用（HMR、热重载） | `ctx.effect` 注册自动回收 |

## 引擎化的几处收敛

| 原来 | 现在 |
|---|---|
| 模式契约在 lint 与 traverse 各一份表 | `lib/modes.mjs` 单一注册表（`registerMode`） |
| BFS 可达性在 lint / traverse 各写一遍 | `lib/graph.mjs`（`analyze` / `shortestPath` / `edgesOf` / `isEnding`） |
| 内容包没有身份 | `export const pack` manifest + `lib/registry.mjs` |
| 只能跑进程 | `sdk/index.js`（`createEngine({ root })`） |
