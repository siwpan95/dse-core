"""终端 IO 适配器（ctx.io）。

换 UI（Web / Discord / GUI）时只替换本插件：实现 `print` `blank` `ask` `wake` 四个方法，
引擎与其它插件一行都不用改。

脚本输入：`DSE_INPUT="1,2,a"` 后 `ask()` 按序取出并回显；序列用尽自动返回 `'quit'`，
让引擎走正常退出流程，而不是卡在等待输入上（CI / 测试靠这个跑完整条线路）。
"""

from __future__ import annotations

import os
import sys

from cordis import Service


class ConsoleIO(Service):
    name = 'io'
    inject: list[str] = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        raw = os.environ.get('DSE_INPUT')
        self.scripted = [s.strip() for s in raw.replace('\n', ',').split(',') if s.strip()] if raw else None
        self.eof = False

    def print(self, text: str = '') -> None:
        sys.stdout.write(str(text) + '\n')
        sys.stdout.flush()

    def blank(self) -> None:
        self.print('')

    def ask(self, prompt: str = '>> ') -> str:
        if self.scripted is not None:
            value = self.scripted.pop(0) if self.scripted else 'quit'
            sys.stdout.write(f'{prompt}{value}\n')
            sys.stdout.flush()
            return value
        if self.eof:
            return 'quit'
        sys.stdout.write(prompt)
        sys.stdout.flush()
        try:
            line = sys.stdin.readline()
        except KeyboardInterrupt:
            return 'quit'
        if not line:                      # EOF（管道输入耗尽）
            self.eof = True
            return 'quit'
        return line.strip()

    def wake(self, text: str = '') -> None:
        """注入一条虚拟输入（热重载用来打断等待、触发重渲染）。"""
        if self.scripted is not None:
            self.scripted.insert(0, text)
