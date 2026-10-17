"""启动流程：读插件清单 → 按声明顺序装载插件 → 返回上下文。

`game.py`（交互）、`cli.py play`（脚本）、`sdk.create_engine()`（宿主）共用这一个流程。

清单格式默认是 `cordis.json`（零依赖，标准库 json 即可解析）；
若装了 PyYAML 且存在 `cordis.yml`，优先用 yml —— 与 Node 版配置保持同样的字段名。
"""

from __future__ import annotations

import json
import os
import sys

from cordis import Context

CONFIG_CANDIDATES = ('cordis.json', 'cordis.yml', 'cordis.yaml')

# 插件 id → 模块路径（相对本文件的包路径）
PLUGIN_MODULES = {
    'scenes': 'plugins.scenes',
    'state': 'plugins.state',
    'io': 'plugins.console_io',
    'engine': 'plugins.engine',
    'save': 'plugins.save',
    'save-migrate': 'plugins.save_migrate',
    'achievements': 'plugins.achievements',
    'i18n': 'plugins.i18n',
    'combat': 'plugins.combat',
    'trade': 'plugins.trade',
    'diary': 'plugins.diary',
    'dialogue': 'plugins.dialogue',
    'sound': 'plugins.sound',
    'hot-reload': 'plugins.hot_reload',
}

# 不需要真正载入的条目（Node 版由 cordis 官方插件提供，Python 版内置或不需要）
NOOP_PLUGINS = {'logger', 'timer'}


def find_config(root: str) -> str | None:
    for name in CONFIG_CANDIDATES:
        path = os.path.join(root, name)
        if os.path.isfile(path):
            if name.endswith(('.yml', '.yaml')):
                try:
                    import yaml            # noqa: PLC0415 —— 可选依赖
                except ImportError:
                    continue
            return path
    return None


def load_config(root: str) -> list[dict]:
    """读插件清单，返回条目列表 [{id, name, config}]。"""
    path = find_config(root)
    if not path:
        raise FileNotFoundError(f'未找到插件清单（cordis.json / cordis.yml）: {root}')
    with open(path, 'r', encoding='utf-8') as fh:
        if path.endswith('.json'):
            data = json.load(fh)
        else:
            import yaml                    # noqa: PLC0415
            data = yaml.safe_load(fh)
    if isinstance(data, dict):
        return data.get('plugins') or []
    return data or []


def _import_plugin(entry: dict, root: str):
    """按 `name` 解析插件类：内置 id → 包模块；否则按文件路径加载。"""
    name = entry.get('name')
    module_name = PLUGIN_MODULES.get(entry.get('id'))
    if module_name:
        module = __import__(module_name, fromlist=['*'])
        return _find_service_class(module)
    if not name:
        return None
    if name.startswith(('.', '/')) or name.endswith('.py'):
        path = os.path.join(root, name)
        import importlib.util
        spec = importlib.util.spec_from_file_location('dse_ext_' + os.path.splitext(os.path.basename(path))[0], path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    else:
        module = __import__(name, fromlist=['*'])
    return _find_service_class(module)


def _find_service_class(module):
    """在模块里找插件类：本模块定义的 Service 子类优先。

    ⚠️ 不能简单 `getattr(module, 'Service')` —— 插件模块都 `from cordis import Service`，
    取到的会是基类本身（注册名叫 "Service"，第二个插件就撞名报错）。
    """
    from cordis import Service as _Service
    for value in vars(module).values():
        if (isinstance(value, type) and issubclass(value, _Service)
                and value is not _Service and value.__module__ == module.__name__):
            return value
    explicit = getattr(module, 'default', None)
    if isinstance(explicit, type):
        return explicit
    return None


def boot(root: str | None = None, *, banner: bool = False, quiet: bool = True,
         auto_start: bool = True) -> Context:
    """加载清单中的全部插件并返回上下文。

    依赖注入由容器编排：插件声明 `inject`，依赖就绪后自动实例化，
    因此清单里的书写顺序不等于启动顺序（Node 版踩过这个坑）。
    """
    root = os.path.abspath(root or os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if root not in sys.path:
        sys.path.insert(0, root)

    if banner:
        from .version import version
        print('┌──────────────────────────────────────┐')
        print(f'│   cordis-py · 字典场景引擎 v{version()}   │')
        print('└──────────────────────────────────────┘')

    entries = load_config(root)
    ctx = Context(base_dir=root)

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        pid = entry.get('id')
        if pid in NOOP_PLUGINS:
            continue
        cls = _import_plugin(entry, root)
        if cls is None:
            ctx.logger('boot').warn('跳过无法解析的插件条目: %s', pid or entry.get('name'))
            continue
        ctx.plugin(cls, entry.get('config') or {}, name=(pid or None))

    pending = ctx.pending
    if pending:
        ctx.logger('boot').warn('以下插件依赖未满足，未启动: %s', ', '.join(pending))
    if not quiet:
        ctx.logger('boot').info('loaded %d services from %s', len(ctx.services), root)

    # 主循环是同步的：装载完就进游戏（只读命令 scenes/info 传 auto_start=False 跳过）
    if auto_start and ctx.has('engine'):
        ctx.engine.start()
    return ctx
