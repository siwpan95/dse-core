#!/usr/bin/env python3
"""测试驱动器：用 SDK 在**外部项目根**上启动引擎。

    python tests/fixtures/run.py <项目根> [输入序列]

存在的意义：验证 `create_engine({'root': ...})` —— 一个引擎可以驱动任意目录下的
内容项目，而不必把内容放进引擎自己的 content/。
"""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from sdk import create_engine  # noqa: E402


def main(argv: list[str]) -> int:
    if not argv:
        sys.stderr.write('用法: python tests/fixtures/run.py <项目根> [输入序列]\n')
        return 1
    root, inputs = argv[0], (argv[1] if len(argv) > 1 else 'quit')
    ctx = create_engine({'root': root, 'input': inputs})
    return int(getattr(ctx.services.get('engine'), 'exit_code', 0) or 0)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
