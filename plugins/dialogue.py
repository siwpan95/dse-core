"""对话 / 谈判（接管 `mode: 'dialogue'`）。

场景声明：

    "crossing": {"mode": "dialogue", "dialogue": {
        "npc": "老渡工", "notes": 3, "onEnd": "crossing-end",
        "topics": [{"id": "boat", "name": "船", "reply": "……", "effect": {"clues.boat": 1}}]
    }}

机制：玩家"问"一个话题 → 显示 reply → 执行 effect → 标记已问。
`notes` 是注意点预算（问满自动结束，0 = 不限），`topics[].if` 控制话题何时可见。
已问话题记在 `state.dialogueAsked`（存档可恢复），重复进入不会重复问。

指令：`ask <话题编号|名称>` 询问 | `topics` 话题列表 | `again` 重看 | `end` 结束。
"""

from __future__ import annotations

from cordis import Service

from plugins.lib.global_commands import is_global_command


class DialogueService(Service):
    name = 'dialogue'
    inject = ['state', 'engine', 'io']

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        self.active = None

    def init(self):
        self.ctx.on('scene/mode', self.takeover, prepend=True)
        self.ctx.on('engine/command', self.handle, prepend=True)
        self.ctx.on('scene/rendered', self.on_rendered)
        self.ctx.on('scene/leave', self.on_leave)
        self.ctx.logger('dialogue').info('loaded')

    def takeover(self, scene_id, scene, mode):
        if mode != 'dialogue':
            return False
        self.begin(scene.get('dialogue') or {})
        return True

    def begin(self, dlg: dict) -> None:
        state = self.ctx.state
        if state.get('dialogueAsked') is None:
            state.set('dialogueAsked', [])
        self.active = {
            'onEnd': dlg.get('onEnd'),
            'npc': dlg.get('npc') or '那人',
            'notes': dlg.get('notes') or 0,
            'topics': dlg.get('topics') or [],
            'asked': list(state.get('dialogueAsked') or []),
            'used': 0,
        }

    def on_leave(self, *args):
        self.active = None

    def on_rendered(self, *args):
        if self.active:
            self.render()

    def visible(self) -> list[dict]:
        if not self.active:
            return []
        return [t for t in self.active['topics'] if not t.get('if') or self.ctx.state.check(t.get('if'))]

    # ── 输入 ──────────────────────────────────────────────────────
    def handle(self, line, choices, next_):
        if not self.active:
            return next_()
        parts = str(line).strip().split(None, 1)
        command = (parts[0] if parts else '').lower()
        arg = parts[1] if len(parts) > 1 else ''
        if command in ('ask', 'a', '问'):
            return self.do_ask(arg.strip())
        if command in ('topics', 't', '话题') or command in ('again', '再看'):
            self.render()
            return {'type': 'noop'}
        if command in ('end', 'n', 'next', '结束'):
            return self.finish()
        if command in ('help', '?'):
            self.ctx.io.print('  对话指令: ask <话题编号或名称> 询问 | topics 话题列表 | end 结束')
            self.render()
            return {'type': 'noop'}
        if is_global_command(str(line)):
            return next_()
        self.ctx.io.print(f'  对话中不可用：{str(line).strip() or "(空)"}（指令: ask <话题> | topics | end）')
        self.render()
        return {'type': 'noop'}

    def do_ask(self, raw: str):
        state = self.active
        if not raw:
            self.render()
            return {'type': 'noop'}
        visible = self.visible()
        topic = None
        for index, item in enumerate(visible, start=1):
            if raw == item.get('id') or raw == item.get('name') or raw == str(index):
                topic = item
                break
        if topic is None:
            self.ctx.io.print(f'  没有这个话题：{raw}。输入 topics 看话题列表。')
            self.render()
            return {'type': 'noop'}
        self.ctx.io.print(f'  {state["npc"]}：{topic.get("reply", "")}')
        if topic.get('effect'):
            self.ctx.state.apply(topic['effect'])
        if topic.get('id') not in state['asked']:
            state['asked'].append(topic.get('id'))
        self.ctx.state.set('dialogueAsked', list(state['asked']))
        state['used'] += 1
        if state['notes'] and state['used'] >= state['notes']:
            self.ctx.io.print('  （对方已经没有耐心了。）')
            return self.finish()
        self.render()
        return {'type': 'noop'}

    def finish(self):
        state = self.active or {}
        on_end = state.get('onEnd')
        self.active = None
        if on_end:
            self.ctx.engine.goto(on_end)
            return {'type': 'scene', 'id': on_end}
        return {'type': 'rerender'}

    def render(self):
        if not self.active:
            return
        state = self.active
        visible = self.visible()
        budget = f'（注意点 {state["used"]}/{state["notes"]}）' if state['notes'] else ''
        self.ctx.io.blank()
        self.ctx.io.print(f'  ── 与{state["npc"]}对话 {budget} ──')
        if not visible:
            self.ctx.io.print('  （没有可问的话题了。）')
        for index, topic in enumerate(visible, start=1):
            mark = '✓' if topic.get('id') in state['asked'] else ' '
            self.ctx.io.print(f'    [{index}] {mark} {topic.get("name")}')
        self.ctx.io.blank()
        self.ctx.io.print('  指令: ask <话题编号或名称> 询问 | topics 话题列表 | end 结束')
        self.ctx.io.blank()
