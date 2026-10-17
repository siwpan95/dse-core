#!/usr/bin/env python3
"""内容校验器。

    python scripts/lint_content.py [--json]

检查项（与 Node 版 dse-core 同口径）：
1. ID 命名            场景 ID 符合命名空间规范
2. 模式注册           未注册的 mode（多半是拼写错误）直接报错
3. 正文厚度           normal 场景建议 ≥120 字
4. 悬空 goto          含模式流转边与 @loop: 目标
5. 跨文件契约         battle.enemy ↔ combat.enemies；trade.days ↔ schedule；成就 when 引用的场景
6. 可达性             从 entry BFS，全部场景可达
7. 结局可达性
8. 孤立场景（告警）   除 entry 外零入度
9. 疑似假选择（告警） 无副作用且与其他选项同归宿
10. 叙事账本          内容引用的 flags/items 必须在 docs/NARRATIVE-LEDGER.md 声明；死变量告警
11. 数值字段          内容裸读写的顶层数值字段必须在 state.initial 声明

退出码：有 error → 1；仅 warning → 0。
"""

from __future__ import annotations

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from lib.boot import load_config                       # noqa: E402
from lib.dict import load_dict, scene_chars            # noqa: E402
from lib.graph import analyze                          # noqa: E402
from lib.modes import mode_edge_table, is_known_mode, is_special_goto  # noqa: E402

JSON_MODE = '--json' in sys.argv

ID_PATTERN = re.compile(r'^[a-z][a-z0-9]*([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$')
NUM_DYNAMIC = {'flags', 'items', 'clues', 'testimony', 'stock', 'visits', 'rep'}
EXPR_EXTRA = {'scene', 'choice', 'effects', 'true', 'false', 'True', 'False',
              'None', 'and', 'or', 'not', 'in', 'is', 'len', 'abs', 'min', 'max'}
MODE_EDGES = mode_edge_table()

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def config_of(config, ident):
    for item in config:
        if isinstance(item, dict) and item.get('id') == ident:
            return item.get('config') or {}
    return {}


def main() -> int:
    config = load_config(ROOT)
    data = load_dict(ROOT)
    dct, ids, entry = data['dict'], data['ids'], data['entry']
    state_cfg = config_of(config, 'state')
    initial = state_cfg.get('initial') or {}
    enemies = (config_of(config, 'combat').get('enemies') or {})
    goods = config_of(config, 'trade').get('goods') or {}
    schedule = config_of(config, 'trade').get('schedule') or []
    achievements = config_of(config, 'achievements').get('list') or []

    # 1. ID 命名
    for scene_id in ids:
        if not ID_PATTERN.match(scene_id):
            err(f'[命名] 场景 ID 不符合规范: {scene_id}')

    # 2. 模式注册
    for scene_id, scene in dct.items():
        mode = scene.get('mode') or 'normal'
        if not is_known_mode(mode):
            err(f'[模式] 场景 {scene_id} 声明了未注册的模式 "{mode}"'
                '（拼写错误？自定义模式请用 lib/modes.py 的 register_mode 注册）')

    # 3. 厚度
    total_chars = sum(scene_chars(s) for s in dct.values())
    for scene_id, scene in dct.items():
        length = scene_chars(scene)
        if length < 120:
            if (scene.get('mode') or 'normal') != 'normal':
                warn(f'[厚度] 场景 {scene_id} 正文仅 {length} 字（目标 ≥ 120）')
            else:
                err(f'[厚度] 场景 {scene_id} 正文仅 {length} 字（目标 ≥ 120）')

    # 4. 悬空 goto
    for scene_id, scene in dct.items():
        for index, choice in enumerate(scene.get('choices') or [], start=1):
            target = choice.get('goto')
            if target is None:
                err(f'[悬空] {scene_id} 第 {index} 个选项没有 goto（选中后无法流转，会重放 onEnter）')
                continue
            text = str(target)
            if text.startswith('@'):
                if not is_special_goto(text):
                    err(f'[悬空] {scene_id} -> {text} 不是引擎支持的特殊目标（白名单: @restart / @loop:<场景ID>）')
                elif text.startswith('@loop:') and text[6:] not in dct:
                    err(f'[悬空] {scene_id} -> {text} 目标场景 "{text[6:]}" 未定义')
                continue
            if text not in dct:
                err(f'[悬空] {scene_id} 第 {index} 个选项 -> "{text}" 未定义')
        for mode, keys in MODE_EDGES.items():
            for key in keys:
                target = (scene.get(mode) or {}).get(key)
                if target is not None and str(target) not in dct:
                    err(f'[悬空] {scene_id} 的 {mode}.{key} -> "{target}" 未定义')

    # 5. 跨文件契约
    for scene_id, scene in dct.items():
        if (scene.get('mode') or 'normal') == 'battle':
            enemy = (scene.get('battle') or {}).get('enemy')
            if enemy is None:
                err(f'[契约] {scene_id} 是 battle 场景但未声明 battle.enemy')
            elif enemy not in enemies:
                err(f'[契约] {scene_id} 的 battle.enemy "{enemy}" 未在插件清单 combat.enemies 中定义')
        if (scene.get('mode') or 'normal') == 'trade':
            days = (scene.get('trade') or {}).get('days') or 5
            columns = len(schedule[0]) if schedule else 0
            if columns and days > columns:
                err(f'[契约] {scene_id} 的 trade.days={days} 超出行情表列数 {columns}')
    if schedule and goods and len(schedule) != len(goods):
        err(f'[契约] 行情表行数 {len(schedule)} 与商品数 {len(goods)} 不一致')
    for item in achievements:
        when = item.get('when') or ''
        for match in re.finditer(r"""scene\s*===?\s*['"]([^'"]+)['"]""", when):
            if match.group(1) not in dct:
                err(f'[成就] "{item.get("id")}" 的 when 引用了不存在的场景 "{match.group(1)}"')

    # 6/7/8. 图分析
    report = analyze(dct, entry)
    for scene_id in report['unreachable']:
        err(f'[可达] 场景 {scene_id} 从 entry 不可达')
    for scene_id in report['endings']:
        if scene_id not in report['reachable']:
            err(f'[结局] {scene_id} 不可达')
    for edge in report['dangling']:
        if edge['kind'] in ('mode', 'loop', 'special'):
            err(f'[悬空] {edge["from"]} 的 {edge["raw"]} -> "{edge["to"]}" 未定义')
    for scene_id in report['dead_ends']:
        warn(f'[孤立] 场景 {scene_id} 没有任何入边（除 entry 外应至少被引用一次）')

    # 9. 假选择
    for scene_id, scene in dct.items():
        seen: dict[str, int] = {}
        for index, choice in enumerate(scene.get('choices') or [], start=1):
            if choice.get('do') or choice.get('if'):
                continue
            target = str(choice.get('goto') or '')
            if not target:
                continue
            if target in seen:
                warn(f'[假选择] {scene_id} 第 {index} 个选项与第 {seen[target]} 个选项同归宿且无副作用')
            else:
                seen[target] = index

    # 10. 叙事账本
    declared: set[str] = set()
    ledger_path = os.path.join(ROOT, 'docs', 'NARRATIVE-LEDGER.md')
    if os.path.isfile(ledger_path):
        with open(ledger_path, 'r', encoding='utf-8') as fh:
            raw = fh.read()
        start = raw.find('## 1. 状态清单')
        end = raw.find('## 2.')
        segment = raw[start:end] if start >= 0 else raw
        declared = {m.group(1) for m in re.finditer(r'`((?:flags|items)(?:\.[\w]+)+)`', segment)}
    else:
        warn('[账本] 未找到 docs/NARRATIVE-LEDGER.md，跳过变量一致性检查')

    used: set[str] = set()

    def collect_effects(effects):
        for key in (effects or {}):
            if key.startswith('flags.') or key.startswith('items.'):
                used.add(key)

    def collect_expr(expr):
        for match in re.finditer(r'\b(flags|items)(?:\.[\w]+)+', str(expr)):
            used.add(match.group(0))

    for scene in dct.values():
        collect_effects(scene.get('onEnter'))
        for choice in scene.get('choices') or []:
            if choice.get('if'):
                collect_expr(choice['if'])
            collect_effects(choice.get('do'))
    for var in sorted(used):
        if var not in declared:
            warn(f'[账本] 内容使用了 {var}，但叙事账本未声明')
    for var in sorted(declared - used):
        warn(f'[死变量] 账本声明了 {var}，但内容既不写也不读')

    # 11. 数值字段
    numeric: set[str] = set()
    for scene in dct.values():
        for key in (scene.get('onEnter') or {}):
            if '.' not in key and key.split('.')[0] not in NUM_DYNAMIC:
                numeric.add(key)
        for choice in scene.get('choices') or []:
            for key in (choice.get('do') or {}):
                if '.' not in key and key.split('.')[0] not in NUM_DYNAMIC:
                    numeric.add(key)
            if choice.get('if'):
                expr = re.sub(r"""['"][^'"]*['"]""", "''", str(choice['if']))
                for token in re.findall(r'\b([A-Za-z_]\w*)\b', expr):
                    if token not in NUM_DYNAMIC and token not in EXPR_EXTRA:
                        numeric.add(token)
    for path in sorted(numeric):
        if path not in initial:
            warn(f'[数值] 内容引用 "{path}"，但 state.initial 未声明该字段（拼写错误或漏声明？）')

    stats = {
        'scenes': len(ids),
        'chars': total_chars,
        'avgChars': round(total_chars / len(ids)) if ids else 0,
        'endings': len(report['endings']),
        'endingsReachable': len(report['endings_reachable']),
        'flags': sum(1 for v in declared if v.startswith('flags.')),
        'items': sum(1 for v in declared if v.startswith('items.')),
        'deadVars': len(declared - used),
        'numFields': len(initial),
    }

    if JSON_MODE:
        print(json.dumps({'stats': stats, 'errors': errors, 'warnings': warnings},
                         ensure_ascii=False, indent=2))
    else:
        print('内容统计：')
        print(f'  场景 {stats["scenes"]} | 正文 {stats["chars"]} 字 | 均长 {stats["avgChars"]} 字')
        print(f'  结局 {stats["endings"]}（可达 {stats["endingsReachable"]}） | '
              f'flags {stats["flags"]} | items {stats["items"]} | 死变量 {stats["deadVars"]}')
        print(f'  数值字段 {stats["numFields"]}（initial 顶层）')
        if warnings:
            print(f'\n⚠ 警告 {len(warnings)} 项：')
            for item in warnings:
                print('  - ' + item)
        if errors:
            print(f'\n✘ 错误 {len(errors)} 项：')
            for item in errors:
                print('  - ' + item)
        else:
            print('\n✔ 无错误')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
