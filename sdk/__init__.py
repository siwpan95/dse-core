"""SDK：把引擎当库用。

    from sdk import create_engine, inspect_project

    ctx = create_engine({'root': './my-game', 'input': '1,1'})
    print(ctx.state.get('gold'))
    print(inspect_project('./my-game'))

与 CLI 的关系：CLI 只是这层的一层薄壳 —— `play` → `boot()`，`scenes/info` → `load_dict()`，
`check` → 校验器，`packs` → `load_packs()`，`doctor` → `analyze()`。两者共用同一份 lib/。
"""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from lib.boot import boot, load_config                 # noqa: E402
from lib.dict import load_dict, scene_chars, is_ending  # noqa: E402
from lib.graph import analyze, shortest_path, edges_of  # noqa: E402
from lib.modes import (                                 # noqa: E402
    MODE_REGISTRY, register_mode, mode_edges, mode_edge_table, mode_names,
    is_known_mode, is_special_goto, resolve_goto,
)
from lib.registry import (                             # noqa: E402
    load_packs, discover_packs, normalize_manifest, validate_manifest, read_pack_files,
)
from lib.version import version                        # noqa: E402

__all__ = [
    'create_engine', 'inspect_project', 'version',
    'boot', 'load_config', 'load_dict', 'scene_chars', 'is_ending',
    'analyze', 'shortest_path', 'edges_of',
    'MODE_REGISTRY', 'register_mode', 'mode_edges', 'mode_edge_table', 'mode_names',
    'is_known_mode', 'is_special_goto', 'resolve_goto',
    'load_packs', 'discover_packs', 'normalize_manifest', 'validate_manifest', 'read_pack_files',
]

ENGINE_ROOT = ROOT


def create_engine(options: dict | None = None):
    """启动引擎并返回上下文。

    options:
        root        项目根（含 cordis.json）；缺省为引擎自身目录 —— 传它即可
                    "一个引擎驱动多个内容项目"
        entry       覆盖入口场景（等价 DSE_ENTRY / --entry）
        input       脚本输入序列（字符串或列表），用尽后引擎自动退出
        banner      是否打印启动横幅（默认 False）
        quiet       是否关闭加载日志（默认 True）
        auto_start  是否立刻进入主循环（默认 True）
        mute        是否静音（默认 True）
    """
    options = options or {}
    root = options.get('root') or ENGINE_ROOT
    entry = options.get('entry')
    if entry:
        os.environ['DSE_ENTRY'] = str(entry)
    if options.get('input') is not None:
        raw = options['input']
        os.environ['DSE_INPUT'] = ','.join(raw) if isinstance(raw, (list, tuple)) else str(raw)
    elif options.get('interactive'):
        os.environ.pop('DSE_INPUT', None)
    if options.get('mute', True):
        os.environ['DSE_MUTE'] = '1'
    return boot(
        root,
        banner=bool(options.get('banner', False)),
        quiet=bool(options.get('quiet', True)),
        auto_start=bool(options.get('auto_start', True)),
    )


def inspect_project(root: str | None = None) -> dict:
    """只读体检：不启动引擎、不占 stdin（CI / 编辑器友好）。"""
    root = root or ENGINE_ROOT
    data = load_dict(root)
    report = analyze(data['dict'], data['entry'])
    packs = load_packs(root)
    return {
        'root': os.path.abspath(root),
        'entry': data['entry'],
        'packFiles': data['pack_files'],
        'packs': [p['manifest'] for p in packs],
        'scenes': len(data['ids']),
        'endings': len(report['endings']),
        'endingsReachable': len(report['endings_reachable']),
        'unreachable': report['unreachable'],
        'dangling': report['dangling'],
    }
