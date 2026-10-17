# SDK：把引擎当库用

引擎化之前只有一条路可走：`node game.js`（交互）或 `dse play --input`（脚本），二者都以"进程 + 终端"为前提。
SDK 把这层壳剥掉 —— 宿主可以是 Web 服务、桌面应用、CI 脚本，也可以是另一个 Node 程序。

```js
import { createEngine, inspectProject, analyze, loadPacks } from 'dse-core'
```

## createEngine(options)

启动引擎，返回 cordis 根 `Context`（`ctx.state` / `ctx.scenes` / `ctx.engine` …）。

| 参数 | 默认 | 说明 |
|---|---|---|
| `root` | 引擎目录 | **项目根**（含 `cordis.yml`）。传它即可用一个引擎驱动任意目录下的内容项目 |
| `entry` | — | 覆盖入口场景（等价 `DSE_ENTRY` / `--entry`） |
| `input` | — | 脚本输入序列（数组或逗号串）；用尽后引擎自动退出 |
| `banner` | false | 是否打印启动横幅 |
| `quiet` | true | 是否关闭插件加载日志 |
| `mute` | true | 是否静音（SDK 场景默认静音，避免音效子进程打扰宿主） |

```js
const ctx = await createEngine({ root: './my-game', input: '1,1' })
console.log(ctx.state.get('gold'))
```

宿主若要自己接管输入输出，替换 `io` 插件即可（写一个新的 Service 提供 `print/blank/ask/wake`，在 `cordis.yml` 里把 `io` 指过去），引擎与其它插件一行都不用改。

## inspectProject(root)

只读体检，**不启动引擎、不占 stdin** —— 适合 CI 与编辑器：

```js
{
  root, entry, packFiles,
  packs: [{ id, name, version, entry, modes, requires, scenes }],
  scenes: 14, endings: 5, endingsReachable: 5,
  unreachable: [], dangling: [],
}
```

## 其它导出

| 导出 | 用途 |
|---|---|
| `loadDict(root)` | 离线加载场景字典（含 `entry`、`packFiles`） |
| `analyze(dict, entry)` | 图分析：可达 / 悬空 / 结局 / 入度 / 深度 |
| `reachableFrom` `shortestPath` `edgesOf` `isEnding` | 图算法（生成"直达某结局"的路线很有用） |
| `loadPacks` `discoverPacks` `normalizeManifest` `validateManifest` `readPackFiles` | 内容包注册表 |
| `MODE_REGISTRY` `registerMode` `modeEdges` `modeEdgeTable` `modeNames` `isKnownMode` | 模式注册表 |
| `isSpecialGoto` `resolveGoto` `SPECIAL_GOTO` `LOOP_PREFIX` | 特殊跳转目标 |
| `boot` | 底层启动流程（需要自己控制参数时用） |
| `version()` | 引擎版本 |

## 一个引擎，多个项目

`tests/fixtures/loop-project/` 是一个最小外部项目（`cordis.yml` + `content/`），由 `tests/fixtures/run.mjs` 驱动：

```bash
node tests/fixtures/run.mjs tests/fixtures/loop-project "1,1,1,1,2,1,2"
```

外部项目的 `cordis.yml` 里，插件路径相对于**该文件所在目录**解析：

```yaml
- id: scenes
  name: ../../../plugins/scenes.js     # 指向引擎的插件
  config:
    packs: [./content/loop.js]         # 指向自己的内容
```

## 与 CLI 的关系

CLI 只是 SDK 的一层薄壳：`dse play` → `boot()`；`dse scenes/info` → `loadDict()`；`dse check` → 校验器；`dse packs` → `loadPacks()`；`dse doctor` → `analyze()`。两者共用同一份 `lib/`，不存在第二套逻辑。
