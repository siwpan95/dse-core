"""场景图分析（纯函数，不依赖运行时）。

从「场景字典 + 入口」出发做静态图分析：可达性、结局、悬空边、入度、最短路径。
校验器与测试共用同一份口径（Node 版这两处是各写一遍的）。
"""

from __future__ import annotations

from .modes import is_special_goto, resolve_goto, mode_edges


def is_ending(scene) -> bool:
    """结局判定：normal 模式且无选项，或所有选项都是特殊目标（@restart 等）。"""
    if not scene:
        return False
    mode = scene.get('mode') or 'normal'
    if mode != 'normal':
        return False
    choices = scene.get('choices') or []
    return len(choices) == 0 or all(str(c.get('goto', '')).startswith('@') for c in choices)


def edges_of(scene_id: str, scene: dict) -> list[dict]:
    """单个场景的全部出边：选项 goto + 模式流转边。"""
    out: list[dict] = []
    for choice in scene.get('choices') or []:
        raw = str(choice.get('goto', ''))
        if not raw:
            continue
        target = resolve_goto(raw)
        if not target or target.startswith('@'):
            continue          # @restart 不参与可达
        out.append({'from': scene_id, 'to': target, 'kind': 'choice', 'raw': raw})
    mode = scene.get('mode') or 'normal'
    for key in mode_edges(mode):
        target = (scene.get(mode) or {}).get(key)
        if target is not None:
            out.append({'from': scene_id, 'to': str(target), 'kind': 'mode', 'raw': f'{mode}.{key}'})
    return out


def reachable_from(dct: dict, entry: str) -> dict:
    reachable: set[str] = set()
    depth: dict[str, int] = {}
    queue: list[tuple[str, int]] = [(entry, 0)]
    while queue:
        node, d = queue.pop(0)
        if node in reachable or node not in dct:
            continue
        reachable.add(node)
        depth[node] = d
        for edge in edges_of(node, dct[node]):
            if edge['to'] not in reachable:
                queue.append((edge['to'], d + 1))
    return {'reachable': reachable, 'order': list(reachable), 'depth': depth}


def analyze(dct: dict, entry: str) -> dict:
    result = reachable_from(dct, entry)
    reachable = result['reachable']
    dangling: list[dict] = []
    endings: list[str] = []
    in_degree: dict[str, int] = {}

    for scene_id, scene in dct.items():
        if is_ending(scene):
            endings.append(scene_id)
        for edge in edges_of(scene_id, scene):
            in_degree[edge['to']] = in_degree.get(edge['to'], 0) + 1
            if edge['to'] not in dct:
                dangling.append(edge)
        for choice in scene.get('choices') or []:
            raw = str(choice.get('goto', ''))
            if raw.startswith('@') and not is_special_goto(raw):
                dangling.append({'from': scene_id, 'to': raw, 'kind': 'special', 'raw': raw})
            elif raw.startswith('@loop:'):
                target = resolve_goto(raw)
                if target not in dct:
                    dangling.append({'from': scene_id, 'to': target, 'kind': 'loop', 'raw': raw})

    return {
        'scenes': len(dct),
        'reachable': reachable,
        'reachable_count': len(reachable),
        'unreachable': [i for i in dct if i not in reachable],
        'order': result['order'],
        'depth': result['depth'],
        'dangling': dangling,
        'endings': endings,
        'endings_reachable': [e for e in endings if e in reachable],
        'dead_ends': [i for i in result['order'] if in_degree.get(i, 0) == 0 and i != entry],
    }


def shortest_path(dct: dict, entry: str, target: str) -> list[str] | None:
    """从 entry 到 target 的一条最短路径（供测试生成"直达路线"）。"""
    prev: dict[str, str] = {}
    seen = {entry}
    queue = [entry]
    while queue:
        node = queue.pop(0)
        if node == target:
            break
        for edge in edges_of(node, dct.get(node, {})):
            if edge['to'] in seen:
                continue
            seen.add(edge['to'])
            prev[edge['to']] = node
            queue.append(edge['to'])
    if target not in seen:
        return None
    path = [target]
    while path[0] != entry:
        path.insert(0, prev[path[0]])
    return path
