"""日记回溯（接管 `mode: 'diary'`）—— 只读地重读已经走过的篇目。

场景声明：

    "inn": {"mode": "diary", "diary": {"onExit": "start"}}

机制：玩家每进入一个**非 diary** 场景，插件就把它记进 `state.diaryRead`（存档可恢复），
因此回溯目录天然就是"我已读过的年表"。重读是**只读渲染**：刻意不走 engine.goto，
因为那是"进入场景"，会重放 onEnter、触发 scene/leave/enter。

指令：输入编号重读该篇 | `back` 返回 | `help` 帮助。
"""

from __future__ import annotations

from cordis import Service

from plugins.lib.global_commands import is_global_command


class DiaryService(Service):
    name = 'diary'
    inject = ['state', 'engine', 'io', 'scenes']

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        self.active = None

    def init(self):
        self.ctx.on('scene/mode', self.takeover, prepend=True)
        self.ctx.on('scene/enter', self.on_enter)
        self.ctx.on('engine/command', self.handle, prepend=True)
        self.ctx.on('scene/rendered', self.on_rendered)
        self.ctx.on('scene/leave', self.on_leave)
        self.ctx.logger('diary').info('loaded')

    def takeover(self, scene_id, scene, mode):
        if mode != 'diary':
            return False
        self.begin(scene.get('diary') or {})
        return True

    def begin(self, diary: dict) -> None:
        if self.ctx.state.get('diaryRead') is None:
            self.ctx.state.set('diaryRead', [])
        self.active = {'onExit': diary.get('onExit')}

    def on_enter(self, scene_id, scene=None):
        if scene and (scene.get('mode') or 'normal') == 'diary':
            return
        self.mark_read(scene_id)

    def on_leave(self, *args):
        self.active = None

    def on_rendered(self, *args):
        if self.active:
            self.render()

    # ── 已读清单 ──────────────────────────────────────────────────
    def read_list(self) -> list[str]:
        value = self.ctx.state.get('diaryRead')
        return list(value) if isinstance(value, list) else []

    def mark_read(self, scene_id) -> None:
        if not scene_id:
            return
        items = self.read_list()
        if scene_id in items:
            return
        self.ctx.state.set('diaryRead', items + [scene_id])

    def entries(self) -> list[str]:
        """可重读篇目：已读 ∩ 字典中仍存在（内容热重载删掉的场景自动剔除）。"""
        return [i for i in self.read_list() if self.ctx.scenes.has(i)]

    # ── 输入 ──────────────────────────────────────────────────────
    def handle(self, line, choices, next_):
        if not self.active:
            return next_()
        raw = str(line or '').strip()
        if not raw:
            self.render()
            return {'type': 'noop'}
        entries = self.entries()
        try:
            number = int(raw)
        except ValueError:
            number = None
        if number is not None and 1 <= number <= len(entries):
            self.read_entry(entries[number - 1])
            self.render()
            return {'type': 'noop'}
        if raw.lower() in ('back', 'b', 'q', '返回', '退出'):
            return self.exit()
        if raw.lower() in ('help', '?'):
            self.ctx.io.print('  札记指令: 输入编号重读该篇 | back 返回 | help 帮助')
            self.render()
            return {'type': 'noop'}
        if is_global_command(raw):
            return next_()
        self.ctx.io.print(f'  札记中不可用：{raw}（指令: 编号 重读 | back 返回 | help 帮助）')
        self.render()
        return {'type': 'noop'}

    def read_entry(self, scene_id: str) -> None:
        scene = self.ctx.scenes.get(scene_id)
        title = self.ctx.state.interpolate(scene.get('title') or scene_id)
        text = self.ctx.state.interpolate(scene.get('text') or '')
        self.ctx.io.blank()
        self.ctx.io.print(f'  ── {title} ──')
        for line in str(text).split('\n'):
            self.ctx.io.print(f'  {line}')
        self.ctx.io.blank()

    def exit(self):
        on_exit = (self.active or {}).get('onExit')
        self.active = None
        if on_exit:
            self.ctx.engine.goto(on_exit)
            return {'type': 'scene', 'id': on_exit}
        return {'type': 'rerender'}

    def render(self):
        if not self.active:
            return
        entries = self.entries()
        self.ctx.io.blank()
        self.ctx.io.print('  ── 可重读的篇目 ──')
        if not entries:
            self.ctx.io.print('  （还没有可重读的篇目。）')
        else:
            for index, scene_id in enumerate(entries, start=1):
                scene = self.ctx.scenes.get(scene_id)
                title = self.ctx.state.interpolate(scene.get('title') or scene_id)
                self.ctx.io.print(f'    [{index}] {title}')
        self.ctx.io.blank()
        self.ctx.io.print('  指令: 编号 重读该篇 | back 返回 | help 帮助')
        self.ctx.io.blank()
