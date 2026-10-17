"""本地化（骨架）：文本 ID → 字符串表。

渐进启用，不破坏既有内容：
- 识别 `@KEY@` 形式的引用（如 `@starter.start.title@`），命中则替换为本地化文本；
- 未命中则**原样保留**（内容里直接写中文的老内容完全不受影响）；
- locale 优先级：`state.locale` > 环境变量 `DSE_LOCALE` > 配置 `defaultLocale`。

要全面本地化时，把正文换成 `@key@`，再往 `config.locales` 填表即可。
命令：`lang` 查看当前语言，`lang <locale>` 切换。
"""

from __future__ import annotations

import os
import re

from cordis import Service

KEY_PATTERN = re.compile(r'@([A-Za-z0-9_.\-]+)@')


class I18nService(Service):
    name = 'i18n'
    inject = ['state']

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        self.tables = (self.config or {}).get('locales') or {}
        self.default_locale = (self.config or {}).get('defaultLocale') or 'zh-CN'
        self.misses: set[str] = set()

    def init(self):
        self.ctx.on('text/render', self.on_render)
        self.ctx.on('engine/command', self.handle)
        self.ctx.logger('i18n').info('locale=%s, tables=%d', self.locale(), len(self.tables))

    def locale(self) -> str:
        return (
            self.ctx.state.get('locale')
            or os.environ.get('DSE_LOCALE')
            or self.default_locale
        )

    def lookup(self, key: str, locale: str | None = None):
        table = self.tables.get(locale or self.locale())
        if isinstance(table, dict) and key in table:
            return table[key]
        fallback = self.tables.get(self.default_locale)
        if isinstance(fallback, dict) and key in fallback:
            return fallback[key]
        return None

    def translate(self, text):
        if not isinstance(text, str) or '@' not in text:
            return text

        def replace(match):
            value = self.lookup(match.group(1))
            if value is None:
                self.misses.add(match.group(1))
                return match.group(0)
            return str(value)

        return KEY_PATTERN.sub(replace, text)

    def on_render(self, text, next_):
        return next_(self.translate(text))

    def handle(self, line, choices, next_):
        parts = str(line).strip().split()
        if not parts or parts[0].lower() not in ('lang', '语言'):
            return next_()
        available = ', '.join(self.tables.keys()) or '（未配置）'
        if len(parts) == 1:
            self.ctx.io.print(f'  当前语言: {self.locale()}（可用: {available}）')
            return {'type': 'rerender'}
        target = parts[1]
        if target not in self.tables:
            self.ctx.io.print(f'  没有语言包 "{target}"（可用: {available}）')
            return {'type': 'rerender'}
        self.ctx.state.set('locale', target)
        self.ctx.io.print(f'  已切换到 {target}')
        return {'type': 'rerender'}

    def missing(self) -> list[str]:
        return sorted(self.misses)
