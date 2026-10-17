#!/usr/bin/env python3
"""cordis-py 命令行接口（dse）。

    python cli.py play --input "1,2,a"      脚本驱动跑一条线路
    python cli.py scenes --json             只读列出场景字典
    python cli.py info --json               项目统计
    python cli.py check                     内容校验
    python cli.py packs [--json]            内容包 manifest 清单
    python cli.py new <包名> --template=hub 生成内容包骨架
    python cli.py doctor                    环境自检
    python cli.py saves                     列出存档位

约定（与 Node 版一致）：**stdout 只放结果，诊断走 stderr**，
保证 `python cli.py scenes --json | jq` 这类管道消费不被污染。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from lib.boot import boot, load_config            # noqa: E402
from lib.dict import load_dict                    # noqa: E402
from lib.graph import analyze                     # noqa: E402
from lib.registry import load_packs, discover_packs, validate_manifest  # noqa: E402


# ── scenes ────────────────────────────────────────────────────────
def cmd_scenes(args) -> int:
    from lib.dict import scene_chars, is_ending
    data = load_dict(args.root)
    dct, ids = data['dict'], data['ids']

    if args.json:
        payload = [{
            'id': scene_id,
            'title': dct[scene_id].get('title', ''),
            'mode': dct[scene_id].get('mode') or 'normal',
            'choices': len(dct[scene_id].get('choices') or []),
            'chars': scene_chars(dct[scene_id]),
            'ending': is_ending(dct[scene_id]),
        } for scene_id in ids]
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    if args.scene:
        if args.scene not in dct:
            sys.stderr.write(f'dse: 场景 "{args.scene}" 不存在\n')
            return 1
        scene = dct[args.scene]
        print(f'── {scene.get("title") or args.scene} ──')
        print(scene.get('text', ''))
        print(f'\n模式: {scene.get("mode") or "normal"} | '
              f'选项: {len(scene.get("choices") or [])} | 字符: {scene_chars(scene)}')
        for index, choice in enumerate(scene.get('choices') or [], start=1):
            cond = f'  (if: {choice["if"]})' if choice.get('if') else ''
            print(f'  [{index}] {choice.get("text")}{cond} → {choice.get("goto")}')
        for key in ('battle', 'trade', 'diary', 'dialogue'):
            if key in scene:
                print(f'  {key}: {json.dumps(scene[key], ensure_ascii=False)}')
        return 0

    print(f'场景 {len(ids)} 个（内容包 {len(data["pack_files"])}）\n')
    groups: dict[str, list[str]] = {}
    for scene_id in ids:
        namespace = scene_id.split('.')[0] if '.' in scene_id else '(顶层)'
        groups.setdefault(namespace, []).append(scene_id)
    for namespace, members in groups.items():
        print(f'{namespace}  ({len(members)})')
        for scene_id in members:
            scene = dct[scene_id]
            mark = '⚑' if is_ending(scene) else ('⚔' if (scene.get('mode') or 'normal') != 'normal' else ' ')
            print(f'  {mark} {scene_id.ljust(28)} {scene.get("title", "")}')
        print()
    print('⚑ = 结局  ⚔ = 模式接管场景（battle/trade/diary/dialogue）')
    return 0


# ── info ──────────────────────────────────────────────────────────
def cmd_info(args) -> int:
    from lib.dict import scene_chars, is_ending
    data = load_dict(args.root)
    dct, ids = data['dict'], data['ids']
    chars = sum(scene_chars(dct[i]) for i in ids)
    endings = sum(1 for i in ids if is_ending(dct[i]))
    modes = sorted({(dct[i].get('mode') or 'normal') for i in ids})
    stats = {
        'scenes': len(ids),
        'packs': len(data['pack_files']),
        'packFiles': data['pack_files'],
        'chars': chars,
        'avgChars': round(chars / len(ids)) if ids else 0,
        'endings': endings,
        'modes': modes,
        'entry': data['entry'],
    }
    if args.json:
        print(json.dumps(stats, ensure_ascii=False, indent=2))
        return 0
    print(f'场景     {stats["scenes"]}（内容包 {stats["packs"]}）')
    print(f'正文字数 {stats["chars"]}（均长 {stats["avgChars"]}）')
    print(f'结局     {stats["endings"]}')
    print(f'模式     {", ".join(stats["modes"])}')
    print(f'入口     {stats["entry"]}')
    print(f'内容包   {", ".join(stats["packFiles"])}')
    return 0


# ── check ─────────────────────────────────────────────────────────
def cmd_check(args) -> int:
    result = subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'lint_content.py')],
                            cwd=ROOT)
    return int(result.returncode)


# ── packs ─────────────────────────────────────────────────────────
def cmd_packs(args) -> int:
    packs = load_packs(args.root)
    found = discover_packs(args.root)
    if args.json:
        payload = [{'file': p['file'], **p['manifest'], 'scenes': p['count']} for p in packs]
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0
    if not packs:
        print('（插件清单未挂任何内容包）')
        return 0
    print(f'已挂载 {len(packs)} 个内容包（content/ 下共 {len(found)} 个文件）\n')
    for pack in packs:
        meta = pack['manifest']
        print(f'{meta["id"].ljust(16)} v{meta["version"]}  场景 {str(pack["count"]).rjust(3)}  入口 {meta["entry"]}')
        if meta['description']:
            print(f'  {meta["name"]} — {meta["description"]}')
        if meta['modes']:
            print(f'  模式: {", ".join(meta["modes"])}')
        if meta['requires']['plugins']:
            print(f'  依赖插件: {", ".join(meta["requires"]["plugins"])}')
        for problem in validate_manifest(meta):
            sys.stderr.write(f'  ⚠ manifest: {problem}\n')
    disabled = [f['file'] for f in found if not f['enabled']]
    if disabled:
        print(f'\n未挂载: {", ".join(disabled)}')
    return 0


# ── new（脚手架）──────────────────────────────────────────────────
TEMPLATES = ['branch', 'hub', 'loop', 'battle', 'trade', 'diary', 'dialogue']


def cmd_new(args) -> int:
    import re as _re
    name = args.name
    if not _re.fullmatch(r'[a-z][a-z0-9_-]*', name or ''):
        sys.stderr.write(f'dse: 包名 "{name}" 不合法（小写字母开头，仅 a-z 0-9 _ -）\n')
        return 1
    if args.template not in TEMPLATES:
        sys.stderr.write(f'dse: 未知模板 "{args.template}"（可用: {", ".join(TEMPLATES)}）\n')
        return 1
    namespace = args.ns or name.replace('-', '').replace('_', '')
    source = os.path.join(ROOT, 'templates', f'{args.template}.py')
    target = os.path.join(ROOT, 'content', f'{name}.py')
    if os.path.exists(target):
        sys.stderr.write(f'dse: 内容包已存在: content/{name}.py\n')
        return 1
    with open(source, 'r', encoding='utf-8') as fh:
        code = fh.read()
    code = code.replace('__PACK_ID__', name).replace('__NS__', namespace)
    with open(target, 'w', encoding='utf-8') as fh:
        fh.write(code)
    print(f'已生成 content/{name}.py（模板: {args.template}，命名空间: {namespace}）')
    print(f'  填充入口: {namespace}.start 之类（模板里全是 TODO，照着替换即可）')

    line = f'      - ./content/{name}.py'
    if args.register:
        config_path = os.path.join(ROOT, 'cordis.json')
        try:
            with open(config_path, 'r', encoding='utf-8') as fh:
                raw = fh.read()
            if line.strip() in raw or f'"./content/{name}.py"' in raw:
                print('  插件清单已含该包，跳过注册')
            else:
                marker = f'"./content/starter.py"'
                raw = raw.replace(marker, marker + f',\n          "./content/{name}.py"', 1)
                with open(config_path, 'w', encoding='utf-8') as fh:
                    fh.write(raw)
                print(f'  已挂到 cordis.json 的 scenes.config.packs: ./content/{name}.py')
        except Exception as error:                  # noqa: BLE001
            sys.stderr.write(f'dse: 写入 cordis.json 失败: {error}\n')
            return 1
    else:
        print(f'  手动挂载: 在 cordis.json 的 scenes.config.packs 加一项 "./content/{name}.py"')
    print('  校验: python cli.py check')
    return 0


# ── doctor ────────────────────────────────────────────────────────
def cmd_doctor(args) -> int:
    checks: list[tuple[str, bool, str]] = []

    def add(name: str, ok: bool, detail: str = '') -> None:
        checks.append((name, ok, detail))

    add('Python 版本 >= 3.10', sys.version_info >= (3, 10), '.'.join(map(str, sys.version_info[:3])))
    add('插件清单', os.path.isfile(os.path.join(args.root, 'cordis.json'))
        or os.path.isfile(os.path.join(args.root, 'cordis.yml')), 'cordis.json')
    try:
        data = load_dict(args.root)
        add('内容包可加载', True, f'{len(data["pack_files"])} 个包 / {len(data["ids"])} 场景')
        report = analyze(data['dict'], data['entry'])
        add('入口场景存在', data['entry'] in data['dict'], data['entry'])
        add('无悬空跳转', not report['dangling'], f'{len(report["dangling"])} 处')
        add('全部场景可达', not report['unreachable'], f'{len(report["unreachable"])} 个不可达')
        add('结局全部可达', len(report['endings']) == len(report['endings_reachable']),
            f'{len(report["endings_reachable"])}/{len(report["endings"])}')
        add('无孤立场景', not report['dead_ends'], f'{len(report["dead_ends"])} 个')
    except Exception as error:                      # noqa: BLE001
        add('内容包可加载', False, str(error))

    from lib.modes import mode_names
    add('模式注册表', bool(mode_names()), ', '.join(mode_names()))

    failed = 0
    for name, ok, detail in checks:
        if not ok:
            failed += 1
        suffix = f'  ({detail})' if detail else ''
        print(f'  {"✔" if ok else "✘"} {name}{suffix}')
    print('\n全部通过' if not failed else f'\n{failed} 项未通过')
    return 1 if failed else 0


# ── saves / play ──────────────────────────────────────────────────
def cmd_saves(args) -> int:
    try:
        config = load_config(args.root)
        directory = './saves'
        for entry in config:
            if isinstance(entry, dict) and entry.get('id') == 'save':
                directory = (entry.get('config') or {}).get('dir') or './saves'
        path = os.path.join(args.root, directory)
        names = sorted(f[:-5] for f in os.listdir(path) if f.endswith('.json')) if os.path.isdir(path) else []
    except Exception:                                # noqa: BLE001
        names = []
    print(f'存档位 {len(names)} 个：' if names else '（暂无存档）')
    for name in names:
        print(f'  {name}')
    return 0


def cmd_play(args) -> int:
    if args.input:
        os.environ['DSE_INPUT'] = args.input
    if args.entry:
        os.environ['DSE_ENTRY'] = args.entry
    try:
        ctx = boot(args.root, banner=not args.quiet, quiet=args.quiet)
    except Exception as error:                       # noqa: BLE001
        sys.stderr.write(f'dse: 启动失败: {error}\n')
        import traceback
        traceback.print_exc(file=sys.stderr)
        return 1
    return int(getattr(ctx.services.get('engine'), 'exit_code', 0) or 0)


# ── 主分发 ────────────────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='dse', description='cordis-py · 字典场景引擎 CLI')
    parser.add_argument('--root', default=ROOT, help='项目根（含 cordis.json），缺省为引擎自身目录')
    sub = parser.add_subparsers(dest='command')

    play = sub.add_parser('play', help='启动游戏')
    play.add_argument('--input', '-i', help='逗号分隔的输入序列（用尽后自动 quit）')
    play.add_argument('--entry', '-e', help='覆盖入口场景')
    play.add_argument('--quiet', '-q', action='store_true', help='关闭启动横幅与加载日志')
    play.set_defaults(func=cmd_play)

    scenes = sub.add_parser('scenes', help='列出场景 / 查看单个场景')
    scenes.add_argument('--json', action='store_true')
    scenes.add_argument('--scene', help='查看单个场景')
    scenes.set_defaults(func=cmd_scenes)

    info = sub.add_parser('info', help='项目统计')
    info.add_argument('--json', action='store_true')
    info.set_defaults(func=cmd_info)

    check = sub.add_parser('check', help='内容校验')
    check.set_defaults(func=cmd_check)

    packs = sub.add_parser('packs', help='内容包 manifest 清单')
    packs.add_argument('--json', action='store_true')
    packs.set_defaults(func=cmd_packs)

    new = sub.add_parser('new', help='生成内容包骨架')
    new.add_argument('name')
    new.add_argument('--template', '-t', default='branch', choices=TEMPLATES)
    new.add_argument('--ns', help='场景 ID 命名空间前缀（缺省 = 包名去掉 - _）')
    new.add_argument('--register', action='store_true', help='顺手挂进 cordis.json')
    new.set_defaults(func=cmd_new)

    doctor = sub.add_parser('doctor', help='环境自检')
    doctor.set_defaults(func=cmd_doctor)

    saves = sub.add_parser('saves', help='列出存档位')
    saves.set_defaults(func=cmd_saves)
    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, 'func', None):
        parser.print_help()
        return 0
    return int(args.func(args) or 0)


if __name__ == '__main__':
    sys.exit(main())
