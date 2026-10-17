"""战斗（接管 `mode: 'battle'`）。

场景声明：

    "wolf-fight": {
        "mode": "battle",
        "battle": {"enemy": "wolf", "onWin": "forest-win", "onLose": "forest-lose", "onFlee": "start"}
    }

数值（数据驱动，全部在插件 config 里）：

    伤害 = max(1, round((atk × 随机波动(±variance) - def × defenseFactor) × 暴击倍率))
    防御姿态：受到伤害 × defendCut
    逃跑成功率：fleeChance
    玩家实际 ATK = 基础 atk + Σ(武器加成 × 持有数量)

指令：`a` 攻击 / `d` 防御 / `r` 逃跑 / `help` 帮助；全局命令（quit/save…）照常放行。

⚠️ 数值标定（Node 版踩过）：敌人强度要按"玩家进入该线时的最低状态"设计，
按满装备标定会让从入口直接进来的玩家 RNG 必输。
"""

from __future__ import annotations

import random

from cordis import Service

from plugins.lib.global_commands import is_global_command

DEFAULT_FORMULA = {
    'variance': 0.2,
    'defenseFactor': 0.5,
    'critMult': 1.8,
    'defendCut': 0.5,
    'fleeChance': 0.45,
}


class CombatService(Service):
    name = 'combat'
    inject = ['state', 'engine', 'io']

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        cfg = self.config or {}
        self.formula = {**DEFAULT_FORMULA, **(cfg.get('formula') or {})}
        self.enemies = cfg.get('enemies') or {}
        self.weapons = cfg.get('weapons') or {}
        self.active = None

    def init(self):
        self.ctx.on('scene/mode', self.takeover, prepend=True)
        self.ctx.on('engine/command', self.handle, prepend=True)
        self.ctx.on('scene/rendered', self.on_rendered)
        self.ctx.on('scene/leave', self.on_leave)
        self.ctx.logger('combat').info('loaded %d enemies', len(self.enemies))

    # ── 接管 ──────────────────────────────────────────────────────
    def takeover(self, scene_id, scene, mode):
        if mode != 'battle':
            return False
        return self.begin(scene.get('battle') or {})

    def begin(self, battle: dict):
        enemy_id = battle.get('enemy')
        enemy = self.enemies.get(enemy_id)
        if enemy is None:
            # 契约错误：敌人未在 config 里定义。有 onWin 就请求引擎立即正规流转，
            # 避免"静默 goto"造成的半放行（Node 版踩过）。
            if battle.get('onWin'):
                return {'redirect': battle['onWin']}
            self.ctx.io.print(f'  （战斗配置错误：未定义敌人 "{enemy_id}" 且无 onWin 回退）')
            return False
        self.active = {
            'battle': battle,
            'enemy': enemy,
            'enemy_id': enemy_id,
            'hp': enemy.get('hp', 10),
            'turn': 0,
            'defending': False,
        }
        self.ctx.emit('battle/start', enemy_id, enemy)
        return True

    def on_leave(self, *args):
        self.active = None

    def on_rendered(self, *args):
        if self.active:
            self.render()

    # ── 输入 ──────────────────────────────────────────────────────
    def handle(self, line, choices, next_):
        if not self.active:
            return next_()
        command = str(line).strip().lower()
        if command in ('a', 'attack', '攻击'):
            return self.player_attack()
        if command in ('d', 'defend', '防御'):
            self.active['defending'] = True
            self.ctx.io.print('  你举盾防御，本回合受到的伤害将大幅减少。')
            return self.enemy_turn()
        if command in ('r', 'flee', '逃跑'):
            return self.flee()
        if command in ('help', '?'):
            self.ctx.io.print('  战斗指令: a 攻击 | d 防御（减伤 50%）| r 逃跑 | help 帮助 | quit 退出')
            self.render()
            return {'type': 'noop'}
        if is_global_command(command):
            return next_()
        self.ctx.io.print(f'  战斗中不可用：{command or "(空)"}（战斗指令: a 攻击 | d 防御 | r 逃跑 | help 帮助 | quit 退出）')
        self.render()
        return {'type': 'noop'}

    # ── 回合 ──────────────────────────────────────────────────────
    def player_atk(self) -> float:
        base = self.ctx.state.get('atk') or 0
        items = self.ctx.state.get('items') or {}
        bonus = 0
        for weapon_id, weapon in self.weapons.items():
            count = items.get(weapon_id) or 0
            bonus += (weapon.get('atk') or 0) * count
        return base + bonus

    def player_def(self) -> float:
        return self.ctx.state.get('def') or 0

    def _swing(self, atk: float, target_def: float, crit_chance: float) -> tuple[int, bool]:
        variance = self.formula['variance']
        crit = random.random() < (crit_chance or 0)
        raw = atk * (1 + random.uniform(-variance, variance)) - (target_def or 0) * self.formula['defenseFactor']
        if crit:
            raw *= self.formula['critMult']
        return max(1, round(raw)), crit

    def player_attack(self):
        state = self.active
        enemy = state['enemy']
        damage, crit = self._swing(self.player_atk(), enemy.get('def') or 0,
                                   self.ctx.state.get('crit') or 0)
        state['hp'] -= damage
        state['turn'] += 1
        state['defending'] = False
        self.ctx.io.print(f'  你{'暴击！' if crit else '击中'}对 {enemy.get("name")} 造成 {damage} 点伤害'
                          f'（剩余 {max(0, state["hp"])}）')
        self.ctx.emit('battle/hit', 'player', damage, crit)
        if state['hp'] <= 0:
            return self.finish(True)
        return self.enemy_turn()

    def enemy_turn(self):
        state = self.active
        enemy = state['enemy']
        damage, crit = self._swing(enemy.get('atk') or 0, self.player_def(), enemy.get('crit') or 0)
        if state['defending']:
            damage = max(1, round(damage * self.formula['defendCut']))
        self.ctx.io.print(f'  {enemy.get("name")}{"暴击！" if crit else "扑上来"}，你受到 {damage} 点伤害')
        state['turn'] += 1
        state['defending'] = False
        self.ctx.state.apply({'hp': -damage})
        self.ctx.emit('battle/hit', 'enemy', damage, crit)
        if (self.ctx.state.get('hp') or 0) <= 0:
            return self.finish(False)
        self.render()
        return {'type': 'noop'}

    def flee(self):
        state = self.active
        if random.random() < self.formula['fleeChance']:
            self.ctx.io.print('  你成功脱身，逃之夭夭。')
            self.active = None
            on_flee = state['battle'].get('onFlee')
            if on_flee:
                self.ctx.engine.goto(on_flee)
                return {'type': 'scene', 'id': on_flee}
            return {'type': 'rerender'}
        self.ctx.io.print('  逃跑失败！敌人挡住了退路。')
        return self.enemy_turn()

    def finish(self, win: bool):
        state = self.active
        enemy = state['enemy']
        self.ctx.io.print(f'  你击败了{enemy.get("name")}！' if win else f'  你被{enemy.get("name")}击倒了...')
        if win:
            for path, value in (enemy.get('drops') or {}).items():
                self.ctx.state.apply({path: value})
                self.ctx.io.print(f'  战利品：{path} {value:+d}' if isinstance(value, (int, float)) else f'  战利品：{path}')
        self.ctx.emit('battle/end', win, enemy)
        self.active = None
        target = state['battle'].get('onWin' if win else 'onLose')
        if target:
            self.ctx.engine.goto(target)
            return {'type': 'scene', 'id': target}
        return {'type': 'rerender'}

    # ── 界面 ──────────────────────────────────────────────────────
    def render(self):
        if not self.active:
            return
        state = self.active
        enemy = state['enemy']
        hp = self.ctx.state.get('hp') or 0
        self.ctx.io.print(f'  ⚔ 第 {state["turn"] + 1} 回合 | {enemy.get("name")} HP '
                          f'{max(0, state["hp"])}/{enemy.get("hp")} | 你 HP {hp}')
        self.ctx.io.print('  指令: a 攻击 | d 防御 | r 逃跑 | help 帮助')
        self.ctx.io.blank()
