"""迷你 Cordis —— 用 Python 复刻 Cordis 4.0 的几个核心机制。

只实现本引擎真正用到的部分：**服务容器 + 依赖注入 + 事件（emit/waterfall/bail）+ 可回滚副作用**。
不做进程内 HMR、不做分布式上下文 —— 那些在本项目里用不上。

对应 Node 版的概念：

| Node (cordis 4)        | 本实现                          |
|------------------------|--------------------------------|
| `new Context()`        | `Context()`                    |
| `class X extends Service` + `super(ctx, 'x')` | `class X(Service)` + `name = 'x'` |
| `static inject = [...]` | `inject = [...]`（类属性）      |
| `ctx.on(name, fn)`     | `ctx.on(name, fn)`             |
| `ctx.emit(name, ...)`  | `ctx.emit(name, ...)`          |
| `ctx.waterfall(...)`   | `ctx.waterfall(...)`           |
| `ctx.bail(...)`        | `ctx.bail(...)`                |
| `ctx.effect(() => ...)`| `ctx.effect(disposer)`         |
| `ctx.root.fiber.dispose()` | `ctx.dispose()`             |

差异（有意为之）：
- 同步而非异步。Node 版的主循环是 async，Python 版用同步循环（`io.ask()` 即阻塞读一行）。
  少一层事件循环，行为更易预测，测试也不用管 await。
- 没有 fiber/作用域树，只有根上下文；`ctx.root is ctx`。
"""

from .context import Context
from .service import Service

__all__ = ['Context', 'Service']
__version__ = '0.1.0'
