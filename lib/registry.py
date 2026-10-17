"""内容包注册表（manifest）。

内容包有两种形态：

1. Python 模块（`.py`）—— 模块级 `SCENES = {...}`，可选 `PACK = {...}` 元数据；
2. JSON 文件（`.json`）—— `{"pack": {...}, "scenes": {...}}`，或直接就是场景字典。

两者都由 `load_packs()` 统一读取，工具链（CLI / 校验器 / 文档）从这里取，
不再各解析一遍（Node 版之前就是各写各的）。
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys

from .modes import mode_names

STRIP_EXT = re.compile(r'\.(py|json|ya?ml)$', re.I)


def read_pack_files(config: list[dict] | dict) -> list[str]:
    """从插件清单里取出 scenes 插件声明的内容包列表。"""
    entries = config if isinstance(config, list) else config.get('plugins', [])
    for item in entries:
        if isinstance(item, dict) and item.get('id') == 'scenes':
            return list((item.get('config') or {}).get('packs') or [])
    return []


def normalize_manifest(raw: dict, file: str, scenes: dict | None = None) -> dict:
    scenes = scenes or {}
    base = STRIP_EXT.sub('', os.path.basename(file))
    modes = set(raw.get('modes') or [])
    for scene in scenes.values():
        if isinstance(scene, dict) and scene.get('mode'):
            modes.add(scene['mode'])
    requires = raw.get('requires') or {}
    return {
        'id': raw.get('id') or base,
        'name': raw.get('name') or raw.get('id') or base,
        'version': raw.get('version') or '0.0.0',
        'entry': raw.get('entry') or (next(iter(scenes), None) if scenes else None),
        'description': raw.get('description', ''),
        'author': raw.get('author', ''),
        'modes': sorted(modes),
        'requires': {
            'plugins': list(requires.get('plugins') or []),
            'state': list(requires.get('state') or []),
        },
        'scenes': len(scenes),
    }


def validate_manifest(manifest: dict) -> list[str]:
    problems: list[str] = []
    if not isinstance(manifest, dict):
        return ['manifest 不是字典']
    ident = str(manifest.get('id') or '')
    if not re.fullmatch(r'[a-z][a-z0-9_-]*', ident):
        problems.append(f'id "{ident}" 不符合命名规范（小写字母开头，仅 a-z 0-9 _ -）')
    version = manifest.get('version')
    if version is not None and not re.match(r'\d+\.\d+\.\d+', str(version)):
        problems.append(f'version "{version}" 不是语义化版本')
    known = set(mode_names())
    for mode in manifest.get('modes') or []:
        if mode not in known:
            problems.append(f'引用了未注册的模式 "{mode}"')
    return problems


def import_pack(path: str, cwd: str) -> tuple[dict, dict]:
    """加载一个内容包，返回 (scenes, pack_metadata)。"""
    full = path if os.path.isabs(path) else os.path.join(cwd, path)
    if full.endswith('.json'):
        with open(full, 'r', encoding='utf-8') as fh:
            data = json.load(fh)
        if 'scenes' in data and isinstance(data['scenes'], dict):
            return data['scenes'], data.get('pack') or {}
        return data, data.get('pack') or {}

    # Python 模块：用唯一模块名避免 sys.modules 串味
    mod_name = 'dse_content_' + re.sub(r'\W', '_', os.path.splitext(os.path.basename(full))[0])
    spec = importlib.util.spec_from_file_location(mod_name, full)
    if spec is None or spec.loader is None:
        raise ImportError(f'无法加载内容包: {full}')
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    scenes = getattr(module, 'SCENES', None) or getattr(module, 'scenes', None)
    if not isinstance(scenes, dict):
        raise ValueError(f'内容包 {path} 未定义 SCENES 字典')
    return scenes, getattr(module, 'PACK', None) or {}


def load_packs(cwd: str, config: list[dict] | dict | None = None) -> list[dict]:
    """加载全部内容包（含 manifest）。

    `config` 可传入已解析的插件清单；不传则自动读 cwd/cordis.json（或 cordis.yml）。
    """
    if config is None:
        from .boot import load_config
        config = load_config(cwd)
    packs = []
    for file in read_pack_files(config):
        scenes, meta = import_pack(file, cwd)
        packs.append({
            'file': file,
            'id': meta.get('id') or STRIP_EXT.sub('', os.path.basename(file)),
            'manifest': normalize_manifest(meta, file, scenes),
            'scenes': scenes,
            'count': len(scenes),
        })
    return packs


def discover_packs(cwd: str, directory: str = 'content') -> list[dict]:
    base = os.path.join(cwd, directory)
    if not os.path.isdir(base):
        return []
    from .boot import load_config
    declared = read_pack_files(load_config(cwd))
    out = []
    for name in sorted(os.listdir(base)):
        if not name.endswith(('.py', '.json')) or name.startswith('_'):
            continue
        rel = os.path.join(directory, name).replace('\\', '/')
        out.append({'file': rel, 'enabled': rel in declared or './' + rel in declared})
    return out
