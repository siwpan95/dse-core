"""场景字典离线加载（CLI 只读命令用，不启动引擎、不占 stdin）。"""

from __future__ import annotations

import os

from lib.boot import load_config
from lib.registry import import_pack


def load_dict(root: str) -> dict:
    """合并全部内容包，返回 {dict, ids, pack_files, entry}。"""
    config = load_config(root)
    packs: list[str] = []
    entry = 'start'
    for item in config:
        if not isinstance(item, dict):
            continue
        if item.get('id') == 'scenes':
            packs = list((item.get('config') or {}).get('packs') or [])
        if item.get('id') == 'engine':
            entry = (item.get('config') or {}).get('entry') or 'start'

    dct: dict = {}
    for path in packs:
        scenes, _meta = import_pack(path, root)
        dct.update(scenes)                # 同 ID 后者覆盖前者，与运行时的叠加语义一致
    return {'dict': dct, 'ids': list(dct.keys()), 'pack_files': packs, 'entry': entry}


def scene_chars(scene: dict) -> int:
    """场景正文长度（title + text + 选项文本），与校验器口径一致。"""
    choices = scene.get('choices') or []
    return (len(scene.get('title') or '') + len(scene.get('text') or '')
            + sum(len(c.get('text') or '') for c in choices))


def is_ending(scene: dict) -> bool:
    """结局判定：normal 模式且无选项，或所有选项都是特殊目标。"""
    from lib.graph import is_ending as _is_ending
    return _is_ending(scene)
