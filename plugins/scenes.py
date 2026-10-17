"""场景字典服务：场景 = 字典里的一条记录。

加载 `.py`（模块级 `SCENES`）或 `.json` 内容包，同 ID 后者覆盖前者，
并按 packs 顺序重建字典 —— 重建走**双缓冲**：先在临时字典上校验，通过后才替换，
保证"校验失败 = 旧字典毫发无损"。

⚠️ 安全：内容包是**可执行代码**（Python 模块在 import 时就会跑模块级语句，拥有完整权限）。
下面的 `validate()` 只用于发现字段拼写错误，不是安全控制 —— 加载先于校验。
"""

from __future__ import annotations

import os

from cordis import Service

from lib.registry import import_pack


class SceneService(Service):
    name = 'scenes'
    inject: list[str] = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        self.dict: dict = {}
        self.packs: list[str] = []
        self.loaded: dict[str, dict] = {}          # file -> scenes
        self.manifests: dict[str, dict] = {}       # file -> pack manifest（引擎化新增）

    def init(self):
        root = self.ctx.root.base_dir or os.getcwd()
        for path in (self.config or {}).get('packs') or []:
            self.load(path, root)
        self.rebuild()
        self.ctx.logger('scenes').info('loaded %d scenes from %d pack(s)', self.size, len(self.packs))

    # ── 加载 ──────────────────────────────────────────────────────
    def load(self, path: str, root: str | None = None) -> dict:
        root = root or self.ctx.root.base_dir or os.getcwd()
        scenes, meta = import_pack(path, root)
        errors = self.validate(scenes, path)
        if errors:
            raise ValueError(f'场景包 {path} 校验失败:\n' + '\n'.join(errors))
        self.loaded[path] = scenes
        self.manifests[path] = meta
        if path not in self.packs:
            self.packs.append(path)
        return scenes

    def reload(self, path: str) -> bool:
        """热重载一个内容包：重新加载并在校验通过后重建。失败则保留旧内容。"""
        if path not in self.loaded:
            self.ctx.logger('scenes').warn('reload skipped: 内容包 %s 不在配置中', path)
            return False
        previous = self.loaded[path]
        try:
            scenes = self.load(path)
        except Exception as error:                  # noqa: BLE001
            self.ctx.logger('scenes').error('reload rejected: %s（保留旧内容）', error)
            return False
        try:
            self.rebuild()
            return True
        except Exception as error:                  # noqa: BLE001
            self.loaded[path] = previous
            self.rebuild()
            self.ctx.logger('scenes').error('reload rejected: %s（保留旧内容）', error)
            return False

    def rebuild(self) -> bool:
        merged: dict = {}
        for path in self.packs:
            merged.update(self.loaded.get(path) or {})
        dangling = self.find_dangling(merged)
        if dangling:
            raise ValueError('存在未定义的场景跳转:\n' + '\n'.join(dangling))
        self.dict = merged
        return True

    # ── 校验 ──────────────────────────────────────────────────────
    def find_dangling(self, dct: dict) -> list[str]:
        dangling: list[str] = []
        for scene_id, scene in dct.items():
            for index, choice in enumerate(scene.get('choices') or []):
                target = choice.get('goto') if isinstance(choice, dict) else None
                if target is None:
                    dangling.append(f'  - #{scene_id} 第 {index + 1} 个选项缺少 goto（选中后无法流转，会重放 onEnter）')
                    continue
                text = str(target)
                if text.startswith('@'):
                    continue
                if text not in dct:
                    dangling.append(f'  - #{scene_id} 第 {index + 1} 个选项 -> "{text}"')
        return dangling

    def validate(self, pack: dict, source: str = '<inline>') -> list[str]:
        errors: list[str] = []
        for scene_id, scene in pack.items():
            at = f'{source}#{scene_id}'
            if not isinstance(scene, dict):
                errors.append(f'  - {at}: 场景必须是字典')
                continue
            if not isinstance(scene.get('text'), str):
                errors.append(f'  - {at}: 缺少 text 字段')
            if scene.get('choices') is not None and not isinstance(scene.get('choices'), list):
                errors.append(f'  - {at}: choices 必须是列表')
            for index, choice in enumerate(scene.get('choices') or []):
                if not isinstance(choice, dict) or not isinstance(choice.get('text'), str):
                    errors.append(f'  - {at}: 第 {index + 1} 个选项缺少 text')
        return errors

    # ── 查询 ──────────────────────────────────────────────────────
    def get(self, scene_id: str) -> dict:
        scene = self.dict.get(scene_id)
        if scene is None:
            raise KeyError(f'场景 "{scene_id}" 不存在（共 {self.size} 个场景，用 dse scenes 查看）')
        return scene

    def has(self, scene_id: str) -> bool:
        return scene_id in self.dict

    @property
    def size(self) -> int:
        return len(self.dict)

    @property
    def ids(self) -> list[str]:
        return list(self.dict.keys())
