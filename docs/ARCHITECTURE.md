# 架构（Python 版）

## 一句话

> 场景即字典，能力即插件 —— 内容由**场景字典**描述，引擎的每个能力是一个**可插拔插件**，
> 两者通过 `cordis.json`（或 `cordis.yml`）声明式组装。

## 分层

```
             cordis.json（声明式插件清单）
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   plugins/scenes  plugins/state  plugins/console_io ...
        │ ctx.scenes     │ ctx.state     │ ctx.io
        └────────┬───────┴───────┬──────┘
                 ▼               ▼
            plugins/engine ──── 依赖注入(inject)就绪后启动
                 │
                 ├─ ctx.waterfall('text/render')     文本渲染管道
                 ├─ ctx.waterfall('engine/command')  输入命令分发
                 ├─ ctx.bail('scene/mode')           模式扩展点
                 ├─ ctx.emit('scene/enter') ...      生命周期事件
                 ▼
            内容包 content/*.py（SCENES 字典）
```

| 层 | 组成 | 能否拔掉 |
|---|---|---|
| 内核 | `cordis/`（容器）+ `scenes` / `state` / `io` / `engine` | 不可拔 |
| 系统 | `save` / `save-migrate` / `achievements` / `i18n` | 可拔 |
| 能力 | `combat` / `trade` / `diary` / `dialogue` | 可拔（拔掉后对应 mode 回退 normal 渲染） |
| 表现 | `sound`（骨架） | 可拔 |
| 开发 | `hot-reload`（默认关闭） | 可拔 |

## 迷你 Cordis（`cordis/`）

只实现引擎真正用到的机制：

| 机制 | API | 说明 |
|---|---|---|
| 服务容器 | `ctx.plugin(cls, config)` / `ctx.provide(name, svc)` | 服务名即 `ctx.<name>` |
| 依赖注入 | 类属性 `inject = [...]` | 依赖未就绪则挂起，服务到位后自动启动 |
| 事件 | `ctx.on/emit` | 监听器随插件卸载回收 |
| 链式事件 | `ctx.waterfall(event, *args, default=...)` | 每个监听器拿 `(*args, next)` |
| 短路事件 | `ctx.bail(event, *args)` | 第一个真值胜出（模式扩展点用这个） |
| 可回滚副作用 | `ctx.effect(disposer)` / `ctx.dispose()` | 逆序执行清理 |

## 服务契约

| 服务 | 关键方法 |
|---|---|
| `ctx.scenes` | `get/has/load/reload/rebuild/validate/find_dangling`，`dict` `ids` `size` |
| `ctx.state` | `get/set/apply/check/interpolate/reset/snapshot/restore/view` |
| `ctx.io` | `print/blank/ask/wake` |
| `ctx.engine` | `start/goto/stop/run/render/default_command`，`current/entry/running` |
| `ctx.save` | `save/load/list/slot_file/validate_record` |
| `ctx['save-migrate']` | `stamp/migrate/needs_migration/version` |
| `ctx.achievements` | `unlocked`、`restore()` |
| `ctx.i18n` | `translate/lookup/locale/missing` |

## 事件协议

| 事件 | 模式 | 用途 |
|---|---|---|
| `text/render` | waterfall | 文本渲染管道（插值 → i18n → 装饰） |
| `engine/command` | waterfall | 输入分发；默认处理器匹配选项编号，插件 prepend 拦截 |
| `scene/mode` | bail | 模式扩展点；可返回 `{'redirect': 场景ID}` 请求立即流转 |
| `scene/rendered` | emit | 渲染完成，插件补画界面（战斗血条等） |
| `scene/enter` / `scene/leave` | emit | 场景生命周期 |
| `choice/made` | emit | 选项生效后 |
| `engine/start` / `engine/end` / `engine/stop` | emit | 游戏生命周期 |
| `achievement/unlock` | emit | 成就解锁 |
| `battle/start` / `battle/hit` / `battle/end` | emit | 战斗生命周期 |
| `save/applied` / `hot-reload/applied` | emit | 存档 / 热重载完成 |

## 主循环的两条路径

- **进入场景**（外层）：`scene/leave` → 应用 `onEnter` → `scene/enter` → 结局判定。只在 `current` 变化时走一次。
- **重绘场景**（内层）：只重新输出界面，不动状态。

共用一条路径会让每次 `rerender` 重放 `onEnter`（敲一次 stats 就再扣一次金币）。

## 与 Node 版的差异

见 [DIFF-FROM-NODE.md](DIFF-FROM-NODE.md)。
