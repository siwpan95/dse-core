"""内容热重载（骨架）：改了内容包，游戏内即时生效。

Node 版用 chokidar 监听文件系统。Python 标准库没有跨平台的文件监听，
这里用**后台线程轮询 mtime** 实现同样的语义（够用，且无第三方依赖）：

    {"id": "hot-reload", "config": {"paths": ["./content"], "debounce": 200, "enabled": true}}

默认 **关闭**（enabled 缺省 False）——自动化测试与 CI 里挂着一个后台线程只会添乱。
启用后：文件 mtime 变化 → 防抖 → `scenes.reload()` → `io.wake()` 注入空输入触发重绘，
玩家状态保留。
"""

from __future__ import annotations

import os
import threading
import time

from cordis import Service


class HotReloadService(Service):
    name = 'hot-reload'
    inject = ['scenes', 'io']

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        cfg = self.config or {}
        self.paths = cfg.get('paths') or ['./content']
        self.debounce = int(cfg.get('debounce') or 200) / 1000
        self.enabled = bool(cfg.get('enabled', False))
        self._snapshot: dict[str, float] = {}
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def init(self):
        if not self.enabled:
            self.ctx.logger('hot-reload').info('未启用（config.enabled = true 开启）')
            return
        root = self.ctx.root.base_dir or os.getcwd()
        self._snapshot = self._scan(root)
        self._thread = threading.Thread(target=self._loop, args=(root,), daemon=True)
        self._thread.start()
        self.ctx.effect(self._stop.set)
        self.ctx.logger('hot-reload').info('watching %s', ', '.join(self.paths))

    def _scan(self, root: str) -> dict[str, float]:
        found: dict[str, float] = {}
        for rel in self.paths:
            base = os.path.join(root, rel)
            if not os.path.isdir(base):
                continue
            for dirpath, _dirnames, filenames in os.walk(base):
                for name in filenames:
                    if name.endswith(('.py', '.json')):
                        path = os.path.join(dirpath, name)
                        try:
                            found[path] = os.path.getmtime(path)
                        except OSError:
                            pass
        return found

    def _loop(self, root: str) -> None:
        while not self._stop.is_set():
            time.sleep(self.debounce)
            try:
                current = self._scan(root)
            except Exception:                        # noqa: BLE001
                continue
            changed = [p for p, mtime in current.items() if self._snapshot.get(p) != mtime]
            if not changed:
                self._snapshot = current
                continue
            self._snapshot = current
            for path in changed:
                rel = os.path.relpath(path, root).replace('\\', '/')
                target = './' + rel
                if target not in self.ctx.scenes.packs:
                    continue
                if self.ctx.scenes.reload(target):
                    self.ctx.logger('hot-reload').info('reloaded %s', target)
                    self.ctx.emit('hot-reload/applied', target)
                    self.ctx.io.wake('')
