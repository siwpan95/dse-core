#!/usr/bin/env python3
"""交互式启动器：python game.py（等价于 python cli.py play）。"""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from lib.boot import boot


def main() -> int:
    ctx = boot(ROOT, banner=True, quiet=False)
    return int(getattr(ctx.services.get('engine'), 'exit_code', 0) or 0)


if __name__ == '__main__':
    sys.exit(main())
