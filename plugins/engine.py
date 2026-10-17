"""引擎服务：场景字典解释器（游戏主循环）。

事件协议（其它插件用 ctx.on 扩展，不改引擎代码）：

| 事件                | 模式      | 用途 |
|---------------------|-----------|------|
| `text/render`       | waterfall | 文本渲染管道（插值 → i18n → 装饰） |
| `engine/command`    | waterfall | 输入命令分发；默认处理器匹配选项编号 |
| `scene/mode`        | bail      | 模式扩展点：返回真值即接管该场景 |
| `scene/rendered`    | emit      | 渲染完成，插件补画自己的界面 |
| `scene/enter` / `scene/leave` | emit | 场景生命周期 |
| `choice/made`       | emit      | 选项被选中、效果执行后 |
| `engine/start` / `engine/end` / `engine/stop` | emit | 游戏生命周期 |

命令返回值：`{'type': 'choice'|'scene'|'rerender'|'noop'|'quit'|'nothing', ...}`

「进入场景」与「重绘场景」是**两条独立路径**（Node 版踩过）：
进入（外层）会执行 onEnter / 触发 scene:enter，只在 current 变化时走一次；
重绘（内层）只重新输出界面，不触碰任何状态。
"""

from __future__ import annotations

import os

from cordis import Service

from lib.modes import LOOP_PREFIX


class EngineService(Service):
    name = 'engine'
    inject = ['scenes', 'state', 'io']

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        self.entry = os.environ.get('DSE_ENTRY') or (self.config or {}).get('entry') or 'start'
        self.current = None
        self.running = False

    # ── 生命周期 ──────────────────────────────────────────────────
    def start(self, entry_id: str | None = None) -> None:
        if self.running:
            return
        self.running = True
        self.current = entry_id or self.entry
        self.ctx.emit('engine/start', self.current)
        self.run()

    def goto(self, scene_id: str) -> None:
        self.current = scene_id

    def stop(self, exit_code: int = 0) -> None:
        if not self.running:
            return
        self.running = False
        self.ctx.emit('engine/stop')
        self.ctx.io.blank()
        self.ctx.io.print('游戏已退出，感谢游玩！')
        self.exit_code = exit_code
        # 不用 sys.exit()：先让插件的清理副作用跑完（存档刷盘、监听器摘除），
        # 由调用方读 exit_code 决定进程退出码。
        self.ctx.root.dispose()

    # ── 主循环 ────────────────────────────────────────────────────
    def run(self) -> None:
        while self.running:
            scene = self.ctx.scenes.get(self.current)

            # 1. 进入场景（每进入一次只做一次）
            self.ctx.emit('scene/leave', self.current)
            for change in self.ctx.state.apply(scene.get('onEnter')):
                self.ctx.logger('engine').info('effect %s: %s -> %s',
                                               change['path'], change['from'], change['to'])

            mode = scene.get('mode') or 'normal'
            mode_result = False
            if mode != 'normal':
                mode_result = self.ctx.bail('scene/mode', self.current, scene, mode)
            if isinstance(mode_result, dict) and isinstance(mode_result.get('redirect'), str):
                self.goto(mode_result['redirect'])       # 请求立即正规流转，重走外层
                continue
            handled = bool(mode_result)
            self.ctx.emit('scene/enter', self.current, scene)

            # 2. 首次渲染（纯输出，不改状态）
            choices = self.render(scene, mode, handled)

            # 3. 结局判定：normal 且无可见选项
            if mode == 'normal' and not choices:
                self.ctx.emit('engine/end', self.current, scene)
                self.ctx.io.print('（完）')
                self.ctx.io.ask('按回车结束游戏...')
                return self.stop()

            def redraw(_scene=scene, _mode=mode, _handled=handled):
                current = self.ctx.scenes.get(self.current)
                return self.render(current, _mode, _handled)

            # 4. 内层输入循环
            while self.running:
                line = self.ctx.io.ask((self.config or {}).get('prompt') or '>> ')
                if not line:
                    choices = redraw()
                    continue
                result = self.ctx.waterfall('engine/command', line, choices, default=self.default_command)
                if not result:
                    choices = redraw()
                    continue
                kind = result.get('type')
                if kind == 'noop':
                    continue
                if kind == 'choice':
                    choice = choices[result['index']]
                    effects = self.ctx.state.apply(choice.get('do'))
                    for change in effects:
                        self.ctx.logger('engine').info('effect %s: %s -> %s',
                                                       change['path'], change['from'], change['to'])
                    self.ctx.emit('choice/made', self.current, choice, effects)
                    target = choice.get('goto')
                    if target is not None:
                        self._follow(str(target))
                    break
                if kind == 'scene':
                    self.goto(result['id'])
                    break
                if kind == 'quit':
                    return self.stop()
                if kind == 'rerender':
                    choices = redraw()
                    continue
                self.ctx.io.print('（未识别的输入，输入 help 查看帮助）')
                choices = redraw()

    def _follow(self, target: str) -> None:
        """处理选项的 goto（含特殊目标）。"""
        if target == '@restart':
            self.ctx.state.reset()
            self.goto(self.entry)
        elif target.startswith(LOOP_PREFIX):
            keep = (self.ctx.state.config or {}).get('loopKeep') or []
            self.ctx.state.reset(keep=keep)
            self.goto(target[len(LOOP_PREFIX):])
        else:
            self.goto(target)

    # ── 渲染 ──────────────────────────────────────────────────────
    def render(self, scene: dict, mode: str, handled: bool) -> list[dict]:
        text = self.ctx.state.interpolate(scene.get('text', ''))
        text = self.ctx.waterfall('text/render', text, default=lambda t: t)
        choices = [c for c in (scene.get('choices') or []) if self.ctx.state.check(c.get('if'))]
        title = self.ctx.state.interpolate(scene.get('title') or self.current)

        self.ctx.io.blank()
        self.ctx.io.print(f'── {title} ──')
        self.ctx.io.print(text)
        self.ctx.io.blank()
        self.ctx.emit('scene/rendered', self.current, scene, mode)
        if mode == 'normal' or not handled:
            for index, choice in enumerate(choices, start=1):
                self.ctx.io.print(f'  [{index}] {self.ctx.state.interpolate(choice.get("text", ""))}')
            self.ctx.io.blank()
        return choices

    # ── 默认命令 ──────────────────────────────────────────────────
    def default_command(self, line: str, choices: list[dict]):
        text = str(line).strip()
        try:
            number = int(text)
        except ValueError:
            number = None
        if number is not None and 1 <= number <= len(choices):
            return {'type': 'choice', 'index': number - 1}
        command = text.lower()
        if command in ('help', '?'):
            self.ctx.io.print('内置命令: 输入选项编号进行选择 | help 帮助 | stats 查看状态 | '
                              'achievements 成就 | save/load/slots 存档 | quit 退出')
            return {'type': 'rerender'}
        if command in ('stats', 'status'):
            state = self.ctx.state
            self.ctx.io.print(f"  {state.get('name')} | HP {state.get('hp')} | "
                              f"ATK {state.get('atk')} | 金币 {state.get('gold')}")
            held = [f'{k}×{v}' for k, v in (state.get('items') or {}).items() if v]
            self.ctx.io.print('  背包: ' + ('（空）' if not held else ', '.join(held)))
            return {'type': 'rerender'}
        if command in ('quit', 'exit'):
            return {'type': 'quit'}
        return {'type': 'nothing'}
