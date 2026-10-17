"""存档 / 读档。

安全与稳健（与 Node 版同口径）：
- 存档位白名单 + 越界校验（不受信任的输入不进文件名）
- 写入走 temp + rename（原子落盘，写一半中断不会截断存档）
- 读档做 schema 校验 + 场景存在性兜底（坏档与内容改版都不会让游戏崩）
- 若启用了 `save-migrate` 插件，读档时按版本链升级旧档
"""

from __future__ import annotations

import json
import os
import re
import tempfile

from cordis import Service

SLOT_PATTERN = re.compile(r'^[\w.\-]{1,64}$')


class SaveService(Service):
    name = 'save'
    inject = ['state', 'engine', 'io', 'scenes', 'achievements']

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        root = self.ctx.root.base_dir or os.getcwd()
        self.dir = os.path.abspath(os.path.join(root, (self.config or {}).get('dir') or './saves'))

    def init(self):
        os.makedirs(self.dir, exist_ok=True)
        # prepend：抢在引擎默认处理器（以及模式插件）之前拿到输入
        self.ctx.on('engine/command', self.handle, prepend=True)

    # ── 命令 ──────────────────────────────────────────────────────
    def handle(self, line, choices, next_):
        parts = str(line).split()
        command = (parts[0] if parts else '').lower()
        rest = parts[1:]
        if command in ('save', '存'):
            slot = rest[0] if rest else 'auto'
            try:
                self.save(slot)
                self.ctx.io.print(f'  已保存到存档位 {slot}')
            except Exception as error:                 # noqa: BLE001
                self.ctx.io.print(f'  保存失败：{error}')
            return {'type': 'rerender'}
        if command in ('load', '读'):
            slot = rest[0] if rest else 'auto'
            ok = self.load(slot)
            return {'type': 'scene', 'id': self.ctx.engine.current} if ok else {'type': 'rerender'}
        if command in ('slots', '档'):
            try:
                slots = self.list()
                self.ctx.io.print(f'  存档位: {", ".join(slots)}' if slots else '  （暂无存档）')
            except Exception as error:                 # noqa: BLE001
                self.ctx.io.print(f'  读取存档列表失败：{error}')
            return {'type': 'rerender'}
        return next_()

    # ── 读写 ──────────────────────────────────────────────────────
    def slot_file(self, slot: str) -> str:
        if not isinstance(slot, str) or not SLOT_PATTERN.match(slot):
            raise ValueError('存档位名称非法（只允许字母、数字、点、下划线、连字符，长度 1-64）')
        path = os.path.abspath(os.path.join(self.dir, f'{slot}.json'))
        base = os.path.abspath(self.dir)
        if path != base and not path.startswith(base + os.sep):
            raise ValueError('存档路径越界')
        return path

    def save(self, slot: str) -> dict:
        path = self.slot_file(slot)
        record = {
            'slot': slot,
            'scene': self.ctx.engine.current,
            'state': self.ctx.state.snapshot(),
            'savedAt': __import__('datetime').datetime.now().isoformat(timespec='seconds'),
            'achievements': sorted(self.ctx.achievements.unlocked),
        }
        migrator = self._migrator()
        if migrator is not None:
            record['version'] = migrator.version
        os.makedirs(self.dir, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.dir, suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as fh:
                json.dump(record, fh, ensure_ascii=False, indent=2)
            os.replace(tmp, path)          # 原子替换
        except Exception:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
        self.ctx.emit('save/applied', slot, record)
        return record

    def load(self, slot: str) -> bool:
        try:
            path = self.slot_file(slot)
            with open(path, 'r', encoding='utf-8') as fh:
                record = json.load(fh)
            problems = self.validate_record(record)
            if problems:
                raise ValueError('存档格式不合法：' + '；'.join(problems))

            migrator = self._migrator()
            if migrator is not None and migrator.needs_migration(record):
                result = migrator.migrate(record)
                record = result['record']
                self.ctx.io.print(f'  存档已从 v{result["from"]} 迁移到 v{result["to"]}')

            if not self.ctx.scenes.has(record.get('scene')):
                fallback = self.ctx.engine.entry or (self.ctx.scenes.ids[0] if self.ctx.scenes.ids else None)
                self.ctx.io.print(f'  存档场景 "{record.get("scene")}" 已不存在，改为从 "{fallback}" 开始')
                record['scene'] = fallback

            self.ctx.state.restore(record.get('state'))
            self.ctx.achievements.restore(record.get('achievements'))
            self.ctx.engine.goto(record.get('scene'))
            self.ctx.io.print(f'  已读取存档位 {slot}（场景: {record.get("scene")}）')
            return True
        except FileNotFoundError:
            self.ctx.io.print(f'  读取存档 {slot} 失败: 存档不存在')
            return False
        except Exception as error:                     # noqa: BLE001
            self.ctx.io.print(f'  读取存档 {slot} 失败: {error}')
            return False

    def list(self) -> list[str]:
        if not os.path.isdir(self.dir):
            return []
        names = []
        for name in os.listdir(self.dir):
            if name.endswith('.json'):
                slot = name[:-5]
                if SLOT_PATTERN.match(slot):
                    names.append(slot)
        return sorted(names)

    def validate_record(self, record) -> list[str]:
        problems: list[str] = []
        if not isinstance(record, dict):
            return ['存档内容不是对象']
        if not isinstance(record.get('scene'), str) or not record.get('scene'):
            problems.append('缺少 scene 字段')
        if not isinstance(record.get('state'), dict):
            problems.append('state 字段不是对象')
        achievements = record.get('achievements')
        if achievements is not None and (
            not isinstance(achievements, list)
            or not all(isinstance(x, str) for x in achievements)
        ):
            problems.append('achievements 字段不是字符串数组')
        return problems

    def _migrator(self):
        """可选增强：未启用 save-migrate 时返回 None（行为与引入前一致）。

        刻意不走 inject —— 否则内容项目不注册该插件时，save 会因依赖未满足永不启动。
        """
        return self.ctx.services.get('save-migrate')
