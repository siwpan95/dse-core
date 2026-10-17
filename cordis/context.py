"""上下文：服务容器 + 事件总线 + 依赖注入 + 副作用回收。"""

from __future__ import annotations

import sys
from typing import Any, Callable, Iterable


class Logger:
    """极简日志器。

    刻意只写 **stderr**：CLI 承诺 stdout 只放结果（便于 `dse scenes --json | jq` 管道消费），
    诊断信息混进 stdout 会破坏这个契约（Node 版踩过：logger 默认写 stdout）。
    """

    def __init__(self, name: str) -> None:
        self.name = name

    def _write(self, level: str, fmt: str, *args: Any) -> None:
        try:
            msg = fmt % args if args else fmt
        except Exception:                       # 格式化失败不要影响主流程
            msg = fmt
        sys.stderr.write(f'[{level}] {self.name} {msg}\n')

    def info(self, fmt: str, *args: Any) -> None:
        self._write('I', fmt, *args)

    def warn(self, fmt: str, *args: Any) -> None:
        self._write('W', fmt, *args)

    def error(self, fmt: str, *args: Any) -> None:
        self._write('E', fmt, *args)

    def debug(self, fmt: str, *args: Any) -> None:
        self._write('D', fmt, *args)


class Context:
    """服务容器。用法：

        ctx = Context()
        ctx.plugin(StateService, {'initial': {...}})
        ctx.state.get('hp')
        ctx.on('scene/enter', handler)
        ctx.waterfall('text/render', text, default=lambda t: t)
    """

    def __init__(self, root: 'Context | None' = None, base_dir: str | None = None) -> None:
        self.root = root if root is not None else self
        self.base_dir = base_dir
        self.services: dict[str, Any] = {}
        self._listeners: dict[str, list[tuple[Callable, bool]]] = {}
        self._pending: list[tuple[type, dict | None, str]] = []
        self._effects: list[Callable[[], None]] = []

    # ── 日志 ──────────────────────────────────────────────────────
    def logger(self, name: str = 'app') -> Logger:
        return Logger(name)

    # ── 服务访问 ──────────────────────────────────────────────────
    def __getattr__(self, name: str) -> Any:
        # 只在 services 里查：与 Node 版一致，未声明 inject 却访问服务会抛错，
        # 而不是静默返回 None（静默会让"插件没启动"变成难以定位的空指针）。
        services = self.__dict__.get('services', {})
        if name in services:
            return services[name]
        raise AttributeError(
            f'service "{name}" is not registered (declare it in the plugin\'s inject list)'
        )

    def has(self, name: str) -> bool:
        return name in self.services

    def provide(self, name: str, service: Any) -> Any:
        if name in self.services:
            raise RuntimeError(f'service "{name}" has been registered at <root>')
        self.services[name] = service
        self._flush_pending()
        return service

    # ── 插件装载（含依赖注入）────────────────────────────────────
    def plugin(self, cls: type, config: dict | None = None, *, name: str | None = None) -> Any:
        """实例化并注册一个插件。依赖未满足则挂起，等服务就绪后自动启动。"""
        svc_name = name or getattr(cls, 'name', None) or cls.__name__
        missing = [dep for dep in getattr(cls, 'inject', []) if dep not in self.services]
        if missing:
            self._pending.append((cls, config, svc_name))
            self.logger('cordis').debug('pending %s (missing: %s)', svc_name, ', '.join(missing))
            return None
        service = cls(self, config or {})           # Service.__init__ 里自行 provide
        self._call_init(service)
        return service

    def _call_init(self, service: Any) -> None:
        init = getattr(service, 'init', None)
        if callable(init):
            init()

    def _flush_pending(self) -> None:
        """每次有服务注册后，尝试启动依赖已满足的挂起插件（循环直到无进展）。"""
        progressed = True
        while progressed:
            progressed = False
            for item in list(self._pending):
                cls, config, svc_name = item
                if all(dep in self.services for dep in getattr(cls, 'inject', [])):
                    self._pending.remove(item)
                    service = cls(self, config or {})
                    self._call_init(service)
                    progressed = True

    @property
    def pending(self) -> list[str]:
        return [name for _, _, name in self._pending]

    # ── 事件 ──────────────────────────────────────────────────────
    def on(self, event: str, fn: Callable, *, prepend: bool = False) -> Callable[[], None]:
        bucket = self._listeners.setdefault(event, [])
        if prepend:
            bucket.insert(0, (fn, True))
        else:
            bucket.append((fn, False))
        # 返回取消订阅函数，便于测试与热插拔
        return lambda: bucket.remove((fn, prepend)) if (fn, prepend) in bucket else None

    def _ordered(self, event: str) -> list[Callable]:
        """监听器顺序：prepend 的在前（后注册者更靠前，与 Node 版一致）。"""
        fns = [fn for fn, _ in self._listeners.get(event, [])]
        return fns

    def emit(self, event: str, *args: Any) -> None:
        for fn in list(self._ordered(event)):
            fn(*args)

    def waterfall(self, event: str, *args: Any, default: Callable | None = None) -> Any:
        """链式事件：每个监听器拿到 (*args, next)，可返回自己的结果或调用 next()。

        `default` 是链尾的默认处理器（引擎用它做"选项编号 + 内置命令"）。
        """
        listeners = self._ordered(event)

        def step(index: int, *a: Any) -> Any:
            if index >= len(listeners):
                return default(*a) if callable(default) else default
            fn = listeners[index]

            def nxt(*new_args: Any) -> Any:
                return step(index + 1, *(new_args if new_args else a))

            return fn(*a, nxt)

        return step(0, *args)

    def bail(self, event: str, *args: Any) -> Any:
        """短路事件：第一个返回真值的监听器胜出。"""
        for fn in list(self._ordered(event)):
            result = fn(*args)
            if result:
                return result
        return None

    # ── 副作用 ────────────────────────────────────────────────────
    def effect(self, disposer: Callable[[], None]) -> Callable[[], None]:
        self._effects.append(disposer)
        return disposer

    def dispose(self, error: Exception | None = None) -> list[Exception]:
        """逆序执行清理函数；单个清理抛错不影响其余（但会被收集返回）。"""
        errors: list[Exception] = []
        while self._effects:
            disposer = self._effects.pop()
            try:
                disposer()
            except Exception as exc:            # noqa: BLE001 —— 清理阶段的异常只收集
                errors.append(exc)
        self._listeners.clear()
        return errors
