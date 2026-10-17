#!/usr/bin/env python3
"""逐线实跑转录（交付留存层）。

    python scripts/playthrough.py                 跑全部路线
    python scripts/playthrough.py --only=A,B      只跑指定路线
    python scripts/playthrough.py --list          只打印路线 id
    python scripts/playthrough.py --dry-run       只打印将跑哪些

与测试的分工：e2e 断言"对不对"（机器判定），本脚本记录"是什么样" ——
每条线真的跑一遍，stdout 落盘 `deliverables/playthrough/<id>.md` 供人工阅读留存。
"""

from __future__ import annotations

import os
import subprocess
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

OUT_DIR = os.path.join(ROOT, 'deliverables', 'playthrough')

ROUTES = [
    {'id': 'A', 'title': '战斗线 · 上山拔剑',
     'input': '1,1,' + ','.join(['a'] * 12),
     'expect': ['山道 · 狼倒下之后', '结局 · 山道无归']},
    {'id': 'B', 'title': '经营线 · 压对行情',
     'input': '2,buy tea 2,sell tea 2,next,buy salt 5,sell salt 5,next,buy cloth 8,sell cloth 8,next,1',
     'expect': ['结局 · 半间铺面']},
    {'id': 'C', 'title': '经营线 · 按兵不动',
     'input': '2,next,next,next,1',
     'expect': ['结局 · 空车回程']},
    {'id': 'D', 'title': '对话线 · 渡口问话',
     'input': '1,1,' + ','.join(['a'] * 12) + ',1,topics,ask 1,ask 2,end,1',
     'expect': ['渡口 · 老渡工', '结局 · 过河的人', '结局 · 山道无归']},
    {'id': 'E', 'title': '日记线 · 回溯重读',
     'input': '3,1,back,quit',
     'expect': ['可重读的篇目', '村口 · 启程']},
    {'id': 'F', 'title': '系统线 · 存档读档',
     'input': '1,save auto1,slots,load auto1,quit',
     'expect': ['已保存到存档位 auto1', '已读取存档位 auto1']},
]


def run(inputs: str) -> tuple[int, str]:
    env = {**os.environ, 'PYTHONIOENCODING': 'utf-8', 'DSE_MUTE': '1'}
    proc = subprocess.run([sys.executable, os.path.join(ROOT, 'cli.py'), 'play', '--quiet', '--input', inputs],
                          cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return proc.returncode, (proc.stdout or '')


def main(argv: list[str]) -> int:
    routes = ROUTES
    only = next((a for a in argv if a.startswith('--only=')), None)
    if only:
        wanted = {x.strip() for x in only.split('=', 1)[1].split(',') if x.strip()}
        routes = [r for r in routes if r['id'] in wanted]
    if '--list' in argv:
        for route in routes:
            print(route['id'])
        return 0
    if '--dry-run' in argv:
        for route in routes:
            print(f"  {route['id'].ljust(4)} {route['title']}")
        print(f'\n共 {len(routes)} 条（--dry-run：不实跑）')
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    passed, missed = 0, []
    for route in routes:
        code, out = run(route['input'])
        ok = code == 0 and (not route['expect'] or any(k in out for k in route['expect']))
        passed += 1 if ok else 0
        if not ok:
            missed.append(route['id'])
        stamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        path = os.path.join(OUT_DIR, f"{route['id']}.md")
        with open(path, 'w', encoding='utf-8') as fh:
            fh.write(f"# 路线 {route['id']} · {route['title']}\n\n")
            fh.write(f"> 生成：{stamp} · 输入序列：`{route['input']}`\n")
            fh.write(f"> 预期：{' / '.join(route['expect']) or '（无）'} · 结果：{'✔ 命中' if ok else '⚠ 未命中'} · 退出码 {code}\n\n")
            fh.write('```\n' + out.strip() + '\n```\n')
        print(f"{'✔' if ok else '⚠'} 路线 {route['id']} {route['title']} → deliverables/playthrough/{route['id']}.md")
    print(f"\n转录完成：{passed}/{len(routes)} 条命中预期"
          + (f"（未命中: {', '.join(missed)}）" if missed else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
