"""版本读取（与包版本保持一致，避免横幅/文档与 pyproject 漂移）。"""

from __future__ import annotations

import os

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_FALLBACK = '0.1.0'


def version() -> str:
    path = os.path.join(_ROOT, 'pyproject.toml')
    try:
        import tomllib                       # Python 3.11+
        with open(path, 'rb') as fh:
            data = tomllib.load(fh)
        return str(data.get('project', {}).get('version') or _FALLBACK)
    except Exception:                        # noqa: BLE001
        return _FALLBACK


if __name__ == '__main__':
    print(version())
