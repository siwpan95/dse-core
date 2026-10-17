# 插件与模式扩展指南

## 1. 最小插件

```js
// plugins/achievements.js
import { Service } from 'cordis'

export const name = 'achievements'

export class Achievements extends Service {
  static inject = ['state', 'engine', 'io']   // 声明依赖，就绪后才启动
  constructor(ctx, config) {
    super(ctx, 'achievements')                 // 注册为 ctx.achievements
    this.config = config
  }
  [Service.init]() {
    this.ctx.on('scene/enter', (scene) => { /* ... */ })
  }
}
```

`cordis.yml` 加一行即可启用：

```yaml
- id: achievements
  name: ./plugins/achievements.js
  config:
    list: [{ id: x, name: 成就名, desc: 说明, when: 'scene === "some-scene"' }]
```

要点：

- `static inject` 声明其它服务，未就绪不启动（**可选增强不要用 inject**：见 §5）。
- 事件监听随插件卸载自动回收，不需要手写 disposer。
- 配置全部走 `cordis.yml`，插件里不写死数据（武器表、敌人表、商品表、成就表都是数据驱动）。

## 2. 拦截命令

`engine/command` 是 waterfall，插件用 `prepend: true` 抢在引擎默认处理器之前：

```js
this.ctx.on('engine/command', (line, choices, next) => this.handle(line, next), { prepend: true })
```

返回值协议见 [ARCHITECTURE.md](ARCHITECTURE.md#事件协议)。处理不了就 `return next()` 交给下一环。

## 3. 接管一种模式（scene.mode）

```js
export class Combat extends Service {
  static inject = ['state', 'engine', 'io']
  [Service.init]() {
    this.ctx.on('scene/mode', (sceneId, scene, mode) => {
      if (mode !== 'battle') return false      // 不是自己的模式就放行
      this.begin(scene.battle ?? {})           // 登记本场配置
      return true                              // 接管：引擎不再渲染选项、不判结局
    }, { prepend: true })

    this.ctx.on('engine/command', (line, choices, next) => this.handle(line, next), { prepend: true })
    this.ctx.on('scene/rendered', () => { if (this.active) this.render() })
    this.ctx.on('scene/leave', () => { this.active = null })   // 离开时清理
  }
}
```

`scene/mode` 的返回值：

| 返回值 | 语义 |
|---|---|
| `false` / `undefined` | 不接管，引擎回退 normal 渲染 |
| `true` | 接管界面与输入 |
| `{ redirect: '<场景ID>' }` | 请求立即正规流转到该场景（走完整的 `scene/leave` → `onEnter` → `scene/enter` → 结局判定），用于"配置缺失时直入 onWin"这类兜底 |

模式插件内部结束流程时调用 `this.ctx.engine.goto(target)` 并返回 `{ type: 'scene', id: target }`，让引擎走正规流转，不要绕过引擎直接切场景。

## 4. 新增一种 mode 要改 3 个地方

1. 新插件里 `ctx.on('scene/mode', ...)` 返回 truthy 接管；
2. `lib/modes.mjs` 注册模式契约（**唯一真源**）：

   ```js
   registerMode('shop', { edges: ['onClose'], plugin: 'shop', desc: '商店' })
   ```

   或在 `MODE_REGISTRY` 里直接加一行。校验器（悬空/可达性）、图遍历、CLI、文档全部自动同步 —— **不要在 lint 和 traverse 各抄一份表**（那是老版本的坑）。
3. `cordis.yml` 注册插件，并在 `state.initial` 声明所需字段。

## 5. 可选增强：不要用 inject

若某个增强是可选的（如 `save-migrate`），**不要**写进 `static inject` —— 否则宿主不注册该插件时，依赖它的插件会因依赖未满足而永不启动（等于功能凭空消失）。改为运行时探测：

```js
migrator() {
  try { return this.ctx['save-migrate'] ?? null }
  catch { return null }   // 未注入时 cordis 的代理访问会抛错
}
```

## 6. 全局命令名单

接管输入的模式插件必须放行全局命令，名单集中在 `plugins/lib/global-commands.js`：

```js
import { isGlobalCommand } from './lib/global-commands.js'
// ...
default:
  if (isGlobalCommand(raw)) return next()      // 放行给 save / achievements / 引擎
  return { type: 'noop' }
```

新增一个全局命令时，同时改：① `GLOBAL_COMMANDS` 名单；② 真正响应它的插件或引擎默认处理器。**放行 ≠ 处理**。

## 7. 表现层与副作用

- 音效：订阅事件即可（`plugins/sound.js`），程序化合成 PCM，无外部资源；`DSE_MUTE=1` 静音。播放子进程必须 `unref()`，否则进程退不出去。
- 内容热重载：`plugins/hot-reload.js` 监听 `content/`，改完自动 `scenes.reload()` 并 `io.wake()` 触发重绘，玩家状态保留。
- 插件级 HMR：`npm run start:hmr`（需 `--expose-internals`，用 `vendor/plugin-hmr`）。

## 8. 两个骨架插件怎么用

### i18n（`plugins/i18n.js`）

渐进启用，不破坏既有内容：

1. 内容正文里写 `@key@` 引用（如 `@starter.start.title@`）；
2. 在 `cordis.yml` 的 `i18n.locales` 填各语言表；
3. 未命中的 key 原样保留（老内容完全不受影响），未命中清单可用 `ctx.i18n.missing()` 查。

locale 优先级：`state.locale` > `DSE_LOCALE` > `config.defaultLocale`。玩家可用 `lang <locale>` 切换。

### save-migrate（`plugins/save-migrate.js`）

1. `cordis.yml` 里设 `version: 2`；
2. 写迁移模块（导出 `(record) => record`），挂进 `migrations: { 2: './migrations/to-v2.js' }`；
3. 旧档读档时按版本链逐级升级，某步抛错则回滚该步，不让玩家丢档。

未配置任何迁移时行为与引入前完全一致（恒等 + 版本盖章）。
