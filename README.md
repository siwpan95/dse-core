# dse-core · 字典场景引擎内核

> Dictionary Scene Engine · Core —— 基于 **Cordis 4.0** 插件架构的文字冒险 / 互动叙事引擎内核。
> 核心理念一句话：**场景即字典，能力即插件** —— 内容由场景字典描述，引擎的每个能力是一个可插拔插件，两者通过 `cordis.yml` 声明式组装。

本仓库是**引擎**，不含游戏内容。自带的 `content/starter.js` 只是"骨架演示"（把五种模式各用一遍的最小可玩线路），随时可以摘掉换成你自己的内容包。

- 内容仓库（游戏本体）：[dict-scene-engine](https://gitee.com/siwpan/dict-scene-engine)
- 从内容仓库迁到本内核：见 [docs/PORTING.md](docs/PORTING.md)

---

## 30 秒上手

```bash
git clone https://gitee.com/siwpan/dse-core.git
cd dse-core
npm install
npm start                # 交互式玩自带的示例内容
npm run test:all         # 单元 + 端到端 + CLI + 遍历 + 覆盖审计
```

开一个新内容包：

```bash
node cli.js new my-pack --template=hub --ns=my --register
#   → 生成 content/my-pack.js（骨架 + TODO），并挂进 cordis.yml
#   → 填完 TODO 后跑：node cli.js check
```

当作库用（宿主程序驱动）：

```js
import { createEngine, inspectProject } from 'dse-core'

const ctx = await createEngine({ root: './my-game', entry: 'start' })  // 启动
console.log(await inspectProject('./my-game'))                         // 只读体检
```

---

## ⚠️ 安全须知（加载任何内容包之前先读这段）

**内容包不是数据文件，是可执行代码。** 加载一个内容包，等价于运行别人的 `.exe`。

- `content/*.js` 是被 `import()` 的 **ESM 模块**，模块顶层代码会立即执行，拥有完整的 Node 运行时权限（读写文件、发起网络请求、执行子进程）。
- `cordis.yml` 中的 `when` / `if` 表达式会被求值执行（`state.check()` → `new Function`，**不是沙箱**，表达式里可直接访问 `process`、`globalThis.fetch`）。
- 启用内容热重载后，`content/` 下任何 `.js` 变更都会在约 200ms 后自动重载，**无需确认**。

因此：只装你信任的来源；`validate()` 只是开发体验检查（帮你发现字段拼写错误），`import()` 先于 `validate()` 执行，靠它"过滤"不可信包是无效的；来源不明的内容请在容器/沙箱里跑。

---

## 目录结构

```
dse-core/
├── game.js               # 交互式启动器（内部调 lib/boot.js）
├── cli.js                # 命令行 dse：play / scenes / info / check / packs / new / doctor / saves
├── cordis.yml            # 插件清单（声明式组装；改它 = 改引擎构成）
├── lib/                  # 引擎核心库（纯逻辑，可被工具链单独引用）
│   ├── boot.js           #   启动流程（game.js / cli.js / SDK 共用，支持 root 参数）
│   ├── dict.mjs          #   场景字典离线加载（只读命令用，不启动引擎）
│   ├── modes.mjs         #   模式注册表（scene.mode 的唯一真源，可注册）
│   ├── graph.mjs         #   场景图分析（可达性 / 悬空 / 结局 / 最短路径）
│   └── registry.mjs      #   内容包注册表（manifest 读取与校验）
├── plugins/              # 引擎插件（每个能力一个，通过 ctx.<service> 通信）
│   ├── scenes.js         #   ctx.scenes   场景字典服务：加载 / 校验 / 查询 / 热重载
│   ├── state.js          #   ctx.state    玩家状态：点路径读写、效果执行、条件求值
│   ├── console-io.js     #   ctx.io       终端 IO 适配器（换 UI 只换这个插件）
│   ├── engine.js         #   ctx.engine   主循环：场景解释器 + 事件分发 + mode 扩展点
│   ├── save.js           #   ctx.save     存档 / 读档（原子写入 + 坏档兜底）
│   ├── save-migrate.js   #   ctx.save-migrate 存档版本迁移（骨架，可挂迁移链）
│   ├── achievements.js   #   成就（纯事件监听 + 命令拦截）
│   ├── i18n.js           #   本地化（骨架：`@key@` 引用 + 字符串表，未命中直通）
│   ├── combat.js         #   battle 模式：回合制战斗 + 敌人/武器字典
│   ├── trade.js          #   trade 模式：天数循环 + 库存买卖 + 确定性行情
│   ├── diary.js          #   diary 模式：日记回溯（只读重读走过的篇目）
│   ├── dialogue.js       #   dialogue 模式：话题询问 + 注意点预算
│   ├── sound.js          #   音效（事件订阅 → 程序化合成 PCM）
│   ├── hot-reload.js     #   内容热重载（改场景字典即时生效）
│   └── lib/
│       ├── safe-path.js       # 路径安全白名单
│       └── global-commands.js # 全局命令注册表（战斗中放行的唯一名单）
├── sdk/index.js          # 编程式入口（宿主 / 测试 / 工具链）
├── schema/scene.schema.json  # 场景字典 JSON Schema（编辑器补全 + CI 校验）
├── templates/            # 内容包结构模板（7 种叙事结构，dse new 用）
├── content/starter.js    # 自带示例内容（骨架演示，可摘）
├── scripts/              # 工具链：lint-content / gen-routes / auto-playthrough / build-hmr / ai/*
├── tests/                # unit / e2e / cli / traverse / coverage + fixtures
├── types/index.d.ts      # 类型声明骨架（编辑器补全）
└── docs/                 # 架构 / 内容包规范 / 插件指南 / SDK / 迁移 / 路线图
```

---

## 场景字典 Schema

一个内容包导出 `{ 场景ID: 场景定义 }`（完整规范见 [docs/CONTENT-PACK-SPEC.md](docs/CONTENT-PACK-SPEC.md)）：

```js
export const pack = {              // 可选的内容包 manifest（引擎化新增）
  id: 'starter', name: '启程', version: '0.1.0',
  entry: 'start', modes: ['battle'], requires: { plugins: ['combat'], state: ['gold'] },
}

export default {
  start: {
    title: '村庄 · 晨雾',
    text: '{name}，你的 HP 是 {hp}。',          // 状态插值（title / choice.text 同样支持）
    onEnter: { gold: -5 },                     // 进入场景时执行的效果
    choices: [                                 // 省略或空 = 结局场景
      {
        text: '花 10 金币买剑',
        if: 'gold >= 10',                      // 显示条件（基于状态求值）
        do: { gold: -10, 'items.rusty_sword': +1 },
        goto: 'castle',                        // 特殊目标：'@restart' / '@loop:<场景ID>'
      },
    ],
  },
}
```

**效果（effects）语义**

| 写法 | 语义 |
|---|---|
| `{ hp: -5 }` | 数值 → **加减**（不是赋值，见踩坑 #10） |
| `{ name: '勇者' }` | 非数值 → 赋值 |
| `{ 'flags.doorOpen': true }` | 点路径 → 深层赋值 |
| `{ 'items.sword': +1 }` | 点路径 + 数值 → 深层计数 |

**特殊跳转目标**

- `@restart`：状态全量重置回 `engine.entry`（重开一局）。
- `@loop:<场景ID>`：**部分重置**后跳转 —— 状态回 `initial`，但 `state.config.loopKeep` 声明的域（如 `clues.loop`）从旧状态保留，实现"知识跨轮保留、消耗态每轮复原"（时间循环）。

---

## 模式扩展点（scene.mode）

场景声明 `mode: 'battle'` 后，引擎发出 `scene/mode` 事件；能力插件返回 truthy 即接管该场景的输入与界面，引擎不再渲染选项、不再判定结局。引擎核心无需改动。

已落地四种：`battle`（战斗）/ `trade`（经营）/ `diary`（日记回溯）/ `dialogue`（对话谈判）。

> **新增一种 mode 要改 3 个地方**（引擎化后从 4 个减到 3 个，且不再有"两份表"）：
> ① 新插件内 `ctx.on('scene/mode', ...)` 返回 truthy 接管；
> ② `lib/modes.mjs` 的注册表加一条（`registerMode('shop', { edges: ['onClose'] })`）—— 校验器、图遍历、CLI 自动同步，**不要再在 lint 和 traverse 各抄一份表**；
> ③ `cordis.yml` 注册插件 + `state.initial` 声明所需字段。

---

## 命令行

```bash
dse play [--input "1,2,a"] [--entry <场景ID>] [--quiet]   # 启动游戏（--input = 脚本驱动）
dse scenes [--json] [--scene <ID>]                        # 列出 / 查看场景
dse info [--json]                                         # 项目统计
dse check                                                 # 内容校验（图 + 契约 + 账本）
dse packs [--json]                                        # 内容包 manifest 清单
dse new <包名> [--template=branch] [--ns=ns] [--register] # 生成内容包骨架
dse doctor                                                # 环境自检（依赖/配置/内容图）
dse saves                                                 # 列出存档位
dse help
```

| 命令 | 启动主循环 | 占用 stdin |
|---|---|---|
| `play --input` | 是 | 否 |
| `play`（不带 input） | 是 | 是 |
| `scenes` / `info` / `packs` / `check` / `doctor` / `saves` | 否 | 否 |

设计要点：**stdout 只放结果、诊断走 stderr**（保证 `dse scenes --json \| jq` 不被污染）；错误退出码非零。

---

## 测试分层

| 层 | 命令 | 覆盖什么 |
|---|---|---|
| 单元 | `npm run test:unit` | 服务与纯函数：状态语义、图分析、模式注册表、manifest、i18n、存档迁移、SDK |
| 端到端 | `npm run test:e2e` | 真实进程 spawn：主循环、四种模式、存档、成就、@restart、SDK 外部项目根 |
| CLI | `npm run test:cli` | 各子命令的退出码与 `--json` 契约 |
| 结构 | `npm run lint:content` | 悬空 goto / 可达性 / 结局判定 / 模式契约 / 账本 / 数值字段 / 厚度 |
| 状态遍历 | `npm run test:traverse` | 从 entry DFS 全图：真实执行每条 goto 边、每个效果、每个条件 |
| **总门** | `npm run test:coverage` | 每个结局必须有 T（遍历）或 E（e2e）来源；双缺 → 退出码 1 |

当前：单元 31 / e2e 25（40 断言）/ CLI 17；示例内容 14 场景、5 结局全部覆盖，lint 0 错误 0 警告。

---

## 引擎化做了什么（相对原 dict-scene-engine）

| 项 | 原来 | 现在 |
|---|---|---|
| 定位 | 引擎 + 41 个内容包同仓 | 引擎独立成库，内容外置（可一个引擎驱动多个项目） |
| 模式契约 | lint 与 traverse 各写一份表，人工同步 | `lib/modes.mjs` 单一注册表，可 `registerMode` |
| 图分析 | BFS 逻辑分散在两个脚本 | `lib/graph.mjs`（可达 / 悬空 / 结局 / 入度 / 最短路径） |
| 内容包 | 只有场景字典，没有身份 | `export const pack` manifest + `lib/registry.mjs` + `dse packs` |
| 编程式接入 | 无（只能跑进程） | `sdk/index.js`：`createEngine({ root })` / `inspectProject()` |
| 脚手架 | 无 | 7 种叙事结构模板 + `dse new --template` |
| Schema | 只有运行时 validate | `schema/scene.schema.json`（编辑器补全 + CI） |
| 本地化 | 无 | `plugins/i18n.js` 骨架（`@key@` + 字符串表，未命中直通，不破坏老内容） |
| 存档演进 | 旧档结构变了只能丢 | `plugins/save-migrate.js` 骨架（版本链迁移） |
| 诊断 | 无 | `dse doctor` 环境自检 |
| 类型 | 无 | `types/index.d.ts` 骨架 |

详细迁移步骤见 [docs/PORTING.md](docs/PORTING.md)，后续规划见 [docs/ROADMAP.md](docs/ROADMAP.md)。

---

## 环境要求

- Node.js >= 22（本地 22.22.2 已验证；插件级 HMR 需 `--expose-internals`）
- 运行依赖：cordis 4.0.0-rc.9、@cordisjs/plugin-loader / include / logger-console / timer、chokidar 4、js-yaml

## 踩坑记录（Windows 环境实测）

1. `rl.question()` 在 win32 管道下每行只返回首字符 → console-io 改用 readline async iterator + 等待队列。
2. 瀑布事件监听器若为 async，返回值是 Promise → 引擎侧必须 `await ctx.waterfall(...)`。
3. cordis 4 的 logger 默认只写内存缓冲，需挂 `plugin-logger-console` 才有终端输出。
4. 官方 `@cordisjs/plugin-hmr` 未发布到 npm，需从本地源码构建到 `vendor/plugin-hmr`（`npm run build:hmr`）。
5. 插件 init 顺序不保证等于 `cordis.yml` 声明顺序 → init 里同步打日志可能早于 logger 注册。
6. `rerender` 只重绘、不重进场景；插件想"原地等下一条输入"必须返回 `noop`，否则战斗状态被重置。
7. 不用 `process.exit()`：改 `process.exitCode` + dispose 根作用域，否则清理 effect 不执行、管道输出被截断。
8. 去掉 `process.exit()` 后仍有句柄吊住事件循环：音效子进程要 `unref()`、chokidar 的 `close()` 是异步的、还要 `process.stdin.pause()`。
9. **开局第一条输入若是插件命令会判为"未识别"**：插件异步 init（如 save 的 `await mkdir`）在线程池里，比 `setImmediate` 慢 → 引擎主循环启动前让出两个宏任务。
10. **`state.apply` 对数值是"加减"不是赋值**：`apply({ tradeDay: 2 })` 是 +2；要"设置"必须走 `state.set`。
11. 战斗数值要按"该线入口时的最低状态"标定，别按满装备标定，否则入口直入的玩家 RNG 必输。
12. 选项编号是**条件过滤后**的序号：互斥条件的两条选项不会同时显示，编号会前移（写测试时要注意）。
13. e2e 里"取最后一个匹配项"会误选同文本的选项 → 用 `send('1')` 配合条件过滤，且关键字要与内容原文逐字一致。
14. 内容包里含连字符的场景 ID 必须加引号（`{ 'wolf-fight': {...} }`），否则是语法错误。
15. 同一个 ctx 上同名服务只能注册一次（测试里重复 `new XxxService(ctx)` 会抛 "already registered"）。

## 退出机制

游戏退出时不调用 `process.exit()`，而是设置 `process.exitCode` 后主动 dispose 根作用域，由 Node 在句柄清空后自然退出。收益：cordis 清理 effect 得以执行（音效临时 WAV 不残留）、输出不被截断、引擎可嵌入宿主程序。

## 许可

MIT
