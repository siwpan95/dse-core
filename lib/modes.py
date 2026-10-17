"""模式注册表（scene.mode 的唯一真源）。

Node 版的历史坑：`lint-content.mjs` 的 `MODE_EDGES` 与 `tests/traverse.mjs` 的 `MODE_NEXT`
是两份互不共享的表，靠人工同步。Python 版从一开始就只留这一份：
校验器、图遍历、CLI 全部读它。
"""

from __future__ import annotations

SPECIAL_GOTO = {'@restart'}
LOOP_PREFIX = '@loop:'


def is_special_goto(target) -> bool:
    text = str(target)
    return text in SPECIAL_GOTO or text.startswith(LOOP_PREFIX)


def resolve_goto(target) -> str:
    """解出 `@loop:<id>` 的真实目标；普通目标原样返回。"""
    text = str(target or '')
    if text.startswith(LOOP_PREFIX):
        return text[len(LOOP_PREFIX):]
    return text


def _mode(**specs):
    return specs


# mode → { edges, plugin, desc }
MODE_REGISTRY: dict[str, dict] = {
    'normal':   {'edges': [], 'plugin': None, 'desc': '引擎默认渲染：选项 + 结局判定'},
    'battle':   {'edges': ['onWin', 'onLose', 'onFlee'], 'plugin': 'combat', 'desc': '回合制战斗'},
    'trade':    {'edges': ['onEnd'], 'plugin': 'trade', 'desc': '经营/买卖（天数循环 + 行情）'},
    'diary':    {'edges': ['onExit'], 'plugin': 'diary', 'desc': '日记回溯（只读重读走过的篇目）'},
    'dialogue': {'edges': ['onEnd'], 'plugin': 'dialogue', 'desc': '对话/谈判（话题询问 + 注意点预算）'},
}


def register_mode(mode: str, *, edges=None, plugin=None, desc=None) -> dict:
    prev = MODE_REGISTRY.get(mode, {'edges': [], 'plugin': plugin, 'desc': ''})
    MODE_REGISTRY[mode] = {
        'edges': list(edges) if edges is not None else prev['edges'],
        'plugin': plugin if plugin is not None else prev.get('plugin'),
        'desc': desc if desc is not None else prev.get('desc', ''),
    }
    return MODE_REGISTRY[mode]


def mode_edges(mode: str) -> list[str]:
    return list(MODE_REGISTRY.get(mode, {}).get('edges', []))


def mode_names() -> list[str]:
    return list(MODE_REGISTRY.keys())


def is_known_mode(mode) -> bool:
    return (mode or 'normal') in MODE_REGISTRY


def mode_edge_table() -> dict[str, list[str]]:
    return {m: list(s['edges']) for m, s in MODE_REGISTRY.items() if s['edges']}
