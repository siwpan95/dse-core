"""存档版本迁移（骨架）。

内容会演进（场景改名、字段重命名、数值语义调整），而玩家手里的存档是旧结构。
没有迁移机制时只能"读档失败 → 回退入口"，体验等于丢档。

做法：存档记录带 `version`，读档时按版本链逐级升级：

    {"id": "save-migrate", "config": {"version": 2, "migrations": {"2": "migrations/to_v2.py"}}}

迁移模块导出 `migrate(record) -> record`。骨架阶段不内置任何迁移，
只提供机制与诊断（无迁移函数时恒等通过）。
"""

from __future__ import annotations

import importlib.util
import os
import sys

from cordis import Service


class SaveMigrateService(Service):
    name = 'save-migrate'
    inject: list[str] = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        self.version = int((self.config or {}).get('version') or 1)
        self.migrations: dict[int, object] = {}
        self._loaded = False

    def init(self):
        self._load_migrations()
        self.ctx.logger('save-migrate').info('save version=%d, migrations=%d',
                                             self.version, len(self.migrations))

    def _load_migrations(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        root = self.ctx.root.base_dir or os.getcwd()
        for version, path in ((self.config or {}).get('migrations') or {}).items():
            try:
                full = os.path.join(root, path)
                spec = importlib.util.spec_from_file_location(f'dse_migration_{version}', full)
                module = importlib.util.module_from_spec(spec)
                sys.modules[spec.name] = module
                spec.loader.exec_module(module)
                fn = getattr(module, 'migrate', None)
                if not callable(fn):
                    raise TypeError(f'未导出迁移函数: {path}')
                self.migrations[int(version)] = fn
            except Exception as error:                  # noqa: BLE001
                self.ctx.logger('save-migrate').warn('迁移 %s 载入失败: %s', version, error)

    def stamp(self, record: dict) -> dict:
        stamped = dict(record)
        stamped['version'] = self.version
        return stamped

    def needs_migration(self, record: dict) -> bool:
        return int(record.get('version') or 1) < self.version

    def migrate(self, record: dict) -> dict:
        source = int(record.get('version') or 1)
        current = dict(record)
        steps: list[int] = []
        for version in sorted(self.migrations):
            if version <= source:
                continue
            before = current
            try:
                current = self.migrations[version](current) or current
            except Exception as error:                 # noqa: BLE001
                self.ctx.logger('save-migrate').warn('迁移到 v%d 失败: %s（保留迁移前状态）', version, error)
                current = before
                break
            steps.append(version)
            current['version'] = version
        current['version'] = self.version
        return {'record': current, 'from': source, 'to': current['version'], 'steps': steps}
