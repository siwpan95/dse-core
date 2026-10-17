"""玩家状态服务：点路径读写、效果执行、条件求值、插值、重置。

效果（effects）语义与 Node 版一致：

    {'hp': -5}                     数值   → 加减
    {'name': '勇者'}               非数值 → 赋值
    {'flags.doorOpen': True}       点路径 → 深层赋值
    {'items.sword': 1}             点路径 + 数值 → 深层计数

条件（if）是字符串表达式。**为兼容 Node 版内容**，`&&` `||` `!` 会先转成 Python 的
`and` `or` `not`，因此 `gold >= 10 && items.token >= 1` 这种写法可以直接沿用。

⚠️ 与 Node 版一样：**这里不是沙箱**。表达式最终走 `eval`，限制 builtins 只是防误操作，
不是安全边界。信任边界是"只运行可信内容包"；玩家在终端输入的内容不会进入这里。
"""

from __future__ import annotations

import copy
import re

from cordis import Service

UNSAFE_KEYS = {'__proto__', 'constructor', 'prototype'}

# 表达式里的字面量/关键字/内置函数：不参与"标识符 → 状态读取"的改写
KEYWORDS = {
    'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None',
    'abs', 'len', 'min', 'max', 'int', 'str', 'float', 'round', 'sum', 'bool',
}

_IDENT = re.compile(r'\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\b')
_STRING = re.compile(r"'[^']*'|\"[^\"]*\"")
_INTERP = re.compile(r'\{([\w.]+)\}')


def _has_unsafe_key(path) -> bool:
    return any(part in UNSAFE_KEYS for part in str(path).split('.'))


class StateService(Service):
    name = 'state'
    inject: list[str] = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        self.data = copy.deepcopy((self.config or {}).get('initial') or {})

    # ── 读写 ──────────────────────────────────────────────────────
    def get(self, path, default=None):
        if _has_unsafe_key(path):
            return None
        node = self.data
        for key in str(path).split('.'):
            if not isinstance(node, dict) or key not in node:
                return default
            node = node[key]
        return node

    def set(self, path, value) -> bool:
        if _has_unsafe_key(path):
            self.ctx.logger('state').warn('拒绝写入危险路径（原型污染防护）: %s', path)
            return False
        keys = str(path).split('.')
        node = self.data
        for key in keys[:-1]:
            nxt = node.get(key)
            if not isinstance(nxt, dict):
                nxt = {}
                node[key] = nxt
            node = nxt
        node[keys[-1]] = value
        return True

    def apply(self, effects) -> list[dict]:
        """执行效果对象，返回变更记录 [{path, from, to}]。"""
        changes: list[dict] = []
        if not effects:
            return changes
        for path, value in effects.items():
            before = self.get(path)
            after = value
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                if isinstance(before, (int, float)) and not isinstance(before, bool):
                    after = before + value
                elif before is None:
                    after = value
            if not self.set(path, after):
                continue
            changes.append({'path': path, 'from': before, 'to': after})
        return changes

    # ── 条件求值 ──────────────────────────────────────────────────
    @staticmethod
    def _to_python(expr: str) -> str:
        """把 Node 版内容的 JS 写法转成 Python：`===`→`==`、`&&`→`and`、`!x`→`not x`。

        这样同一份条件表达式可以在 Node 版与 Python 版内容里通用。
        """
        text = str(expr)
        text = text.replace('!==', ' != ')
        text = text.replace('===', ' == ')
        text = text.replace('&&', ' and ').replace('||', ' or ')
        text = re.sub(r'!(?!=)', ' not ', text)
        return text

    def _compile(self, expr: str, skip: 'set[str] | None' = None) -> str:
        """把 `gold >= 10 && items.token >= 1` 改写成 `__g('gold') >= 10 and __g('items.token') >= 1`。

        字符串字面量先挖出来再回填 —— 否则 `flags.x === "both"` 里的 `both`
        会被当成状态字段（Node 版踩过这个坑，见 README 踩坑记录）。
        """
        text = self._to_python(expr)
        store: list[str] = []

        def stash(match):
            store.append(match.group(0))
            return f'__S{len(store) - 1}__'

        text = _STRING.sub(stash, text)

        def rewrite(match, allowed):
            name = match.group(0)
            head = name.split('.')[0]
            # 关键字、字面量占位、extra 上下文里的名字（如 scene）都不改写
            if head in allowed or name.startswith('__'):
                return name
            return f"__g('{name}')"

        allowed = KEYWORDS | set(skip or ())
        text = _IDENT.sub(lambda m: rewrite(m, allowed), text)
        for index, literal in enumerate(store):
            text = text.replace(f'__S{index}__', literal)
        return text

    def check(self, expr, extra=None) -> bool:
        """求值条件表达式；无条件恒真；求值失败按 False 处理并告警。"""
        if expr is None or expr == '':
            return True
        scope = {'__g': self.get, '__builtins__': {}}
        if extra:
            scope.update(extra)
        try:
            compiled = self._compile(str(expr), skip=set(extra or {}))
            return bool(eval(compiled, scope, {}))       # noqa: S307 —— 信任边界见模块文档
        except Exception as error:                        # noqa: BLE001
            self.ctx.logger('state').warn('条件求值失败 "%s": %s', expr, error)
            return False

    # ── 插值 ──────────────────────────────────────────────────────
    def interpolate(self, text):
        def replace(match):
            value = self.get(match.group(1))
            return match.group(0) if value is None else str(value)

        return _INTERP.sub(replace, str(text))

    # ── 重置 / 快照 ───────────────────────────────────────────────
    def reset(self, keep=None) -> None:
        keep = keep or []
        old = self.data
        self.data = copy.deepcopy((self.config or {}).get('initial') or {})
        if not keep:
            return
        kept: list[tuple[str, object]] = []

        def collect(node, base=''):
            if not isinstance(node, dict):
                return
            for key, value in node.items():
                path = f'{base}.{key}' if base else key
                if any(path == p or path.startswith(p + '.') for p in keep):
                    kept.append((path, value))
                elif isinstance(value, dict):
                    collect(value, path)

        collect(old)
        for path, value in kept:
            self.set(path, copy.deepcopy(value))

    def snapshot(self) -> dict:
        return copy.deepcopy(self.data)

    def restore(self, data) -> None:
        self.data = copy.deepcopy(data) if isinstance(data, dict) else {}

    def view(self) -> dict:
        return copy.deepcopy(self.data)
