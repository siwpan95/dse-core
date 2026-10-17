"""成就系统：纯事件监听 + 命令拦截，不改引擎一行代码。

配置（数据驱动）：

    {"id": "achievements", "config": {"list": [
        {"id": "wolf-slayer", "name": "屠狼者", "desc": "战胜独眼狼", "when": "scene == 'forest-win'"}
    ]}}

`when` 是条件表达式，作用域里除玩家状态外还有：`scene`（当前场景 ID）、
`choice`、`effects`。写法兼容 Node 版内容（`===` 会转成 `==`）。
"""

from __future__ import annotations

from cordis import Service


class AchievementsService(Service):
    name = 'achievements'
    inject = ['state', 'engine', 'io']

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        self.unlocked: set[str] = set()
        self.table = {item.get('id'): item for item in ((self.config or {}).get('list') or [])}

    def init(self):
        self.ctx.on('scene/enter', self.on_enter)
        self.ctx.on('choice/made', self.on_choice)
        self.ctx.on('engine/command', self.handle, prepend=True)
        self.ctx.logger('achievements').info('registered %d achievements', len(self.table))

    def on_enter(self, scene_id, scene=None):
        self.check(scene_id)

    def on_choice(self, scene_id, choice=None, effects=None):
        self.check(scene_id, choice=choice, effects=effects)

    def check(self, scene_id=None, choice=None, effects=None) -> None:
        extra = {'scene': scene_id, 'choice': choice, 'effects': effects}
        for item in (self.config or {}).get('list') or []:
            ident = item.get('id')
            if not ident or ident in self.unlocked:
                continue
            when = item.get('when')
            if when and self.ctx.state.check(when, extra=extra):
                self.unlock(ident)

    def unlock(self, ident: str) -> None:
        item = self.table.get(ident) or {'id': ident, 'name': ident, 'desc': ''}
        self.unlocked.add(ident)
        self.ctx.io.print(f'  ★ 成就解锁：{item.get("name")} —— {item.get("desc")}')
        self.ctx.emit('achievement/unlock', ident, item)

    def restore(self, idents) -> None:
        """读档恢复：过滤掉内容改版后已不存在的 id。"""
        self.unlocked = {i for i in (idents or []) if i in self.table}

    def handle(self, line, choices, next_):
        command = str(line).strip().lower()
        if command in ('achievements', '成就'):
            items = (self.config or {}).get('list') or []
            if not items:
                self.ctx.io.print('  （暂无成就）')
            for item in items:
                mark = '✓' if item.get('id') in self.unlocked else ' '
                self.ctx.io.print(f'  [{mark}] {item.get("name")} —— {item.get("desc")}')
            return {'type': 'rerender'}
        return next_()
