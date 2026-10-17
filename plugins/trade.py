"""经营 / 买卖（接管 `mode: 'trade'`）。

场景声明：

    "market": {"mode": "trade", "trade": {"name": "东市", "days": 3, "onEnd": "market-end"}}

机制：天数循环 + 库存买卖 + **确定性行情**（行=商品，列=第 N 天卖出价，写死在 config 里，
所以测试可复现、玩家可推演）。收市时把净赚写进 `tradeProfit`，内容侧按它分结局。

指令：`buy <商品> [数量]` / `sell <商品> [数量]` / `next` 下一天 / `info` 行情 / `help`。

⚠️ `days` 不得超过行情表列数（超出的天数卖出价为 0）—— 校验器会拦。
⚠️ 天数用 `state.set` 而不是 `apply`：`apply` 对数值是加减语义（1 + 2 = 3）。
"""

from __future__ import annotations

from cordis import Service

from plugins.lib.global_commands import is_global_command

DEFAULT_GOODS = {'tea': {'name': '茶', 'buy': 8}, 'salt': {'name': '盐', 'buy': 4}, 'cloth': {'name': '布', 'buy': 2}}


class TradeService(Service):
    name = 'trade'
    inject = ['state', 'engine', 'io']

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        cfg = self.config or {}
        self.goods = cfg.get('goods') or DEFAULT_GOODS
        self.schedule = cfg.get('schedule') or []
        self.ids = list(self.goods.keys())
        self.active = None

    def init(self):
        self.ctx.on('scene/mode', self.takeover, prepend=True)
        self.ctx.on('engine/command', self.handle, prepend=True)
        self.ctx.on('scene/rendered', self.on_rendered)
        self.ctx.on('scene/leave', self.on_leave)
        self.ctx.logger('trade').info('loaded %d goods over %d days',
                                      len(self.ids), len(self.schedule[0]) if self.schedule else 0)

    # ── 接管 ──────────────────────────────────────────────────────
    def takeover(self, scene_id, scene, mode):
        if mode != 'trade':
            return False
        self.begin(scene.get('trade') or {})
        return True

    def begin(self, trade: dict) -> None:
        state = self.ctx.state
        if state.get('tradeDay') is None:
            state.set('tradeDay', 1)
            state.set('tradeBaseGold', state.get('gold') or 0)
        if state.get('stock') is None:
            state.set('stock', {})
        for good_id in self.ids:
            if state.get(f'stock.{good_id}') is None:
                state.set(f'stock.{good_id}', 0)
        self.active = {
            'days': trade.get('days') or 5,
            'name': trade.get('name') or (self.config or {}).get('place') or '东市',
        }
        self._on_end = trade.get('onEnd')

    def on_leave(self, *args):
        self.active = None

    def on_rendered(self, *args):
        if self.active:
            self.render()

    @property
    def day(self) -> int:
        return int(self.ctx.state.get('tradeDay') or 1)

    def price_of(self, good_id: str, day: int | None = None):
        if good_id not in self.ids:
            return None
        row = self.schedule[self.ids.index(good_id)] if self.ids.index(good_id) < len(self.schedule) else None
        if not row:
            return 0
        index = (day or self.day) - 1
        return row[index] if 0 <= index < len(row) else 0

    # ── 输入 ──────────────────────────────────────────────────────
    def handle(self, line, choices, next_):
        if not self.active:
            return next_()
        parts = str(line).strip().lower().split()
        command = parts[0] if parts else ''
        args = parts[1:]
        if command in ('buy', 'b', '进货'):
            return self.do_buy(args)
        if command in ('sell', 's', '出货'):
            return self.do_sell(args)
        if command in ('next', 'n', '过', '下一天'):
            return self.next_day()
        if command in ('info', 'i', '行情'):
            self.render()
            return {'type': 'noop'}
        if command in ('help', '?'):
            self.ctx.io.print('  经营指令: buy <商品> [数量] 进货 | sell <商品> [数量] 出货（默认全部）'
                              ' | next 下一天 | info 行情 | quit 退出')
            self.render()
            return {'type': 'noop'}
        if is_global_command(command):
            return next_()
        self.ctx.io.print(f'  经营中不可用：{command or "(空)"}'
                          '（指令: buy 进货 | sell 出货 | next 下一天 | info 行情 | help 帮助）')
        self.render()
        return {'type': 'noop'}

    def _normalize(self, token: str | None):
        if not token:
            return None
        for good_id in self.ids:
            if token == good_id or token == self.goods[good_id].get('name'):
                return good_id
        return None

    @staticmethod
    def _count(token: str | None, default: int) -> int:
        try:
            return int(token) if token is not None else default
        except ValueError:
            return default

    def do_buy(self, args):
        good_id = self._normalize(args[0] if args else None)
        if not good_id:
            self.ctx.io.print(f'  没有这种货：{args[0] if args else "(空)"}')
            self.render()
            return {'type': 'noop'}
        count = self._count(args[1] if len(args) > 1 else None, 1)
        if count <= 0:
            self.ctx.io.print('  数量至少为 1。')
            self.render()
            return {'type': 'noop'}
        good = self.goods[good_id]
        cost = (good.get('buy') or 0) * count
        gold = self.ctx.state.get('gold') or 0
        if gold < cost:
            self.ctx.io.print(f'  金币不够：{good.get("name")} 进价 {good.get("buy")}，{count} 件需 {cost} 金，你只有 {gold} 金。')
            self.render()
            return {'type': 'noop'}
        self.ctx.state.apply({'gold': -cost, f'stock.{good_id}': count})
        self.ctx.io.print(f'  进货：{good.get("name")} ×{count}（-{cost} 金），库存 {self.ctx.state.get(f"stock.{good_id}")}。')
        self.render()
        return {'type': 'noop'}

    def do_sell(self, args):
        good_id = self._normalize(args[0] if args else None)
        if not good_id:
            self.ctx.io.print(f'  没有这种货：{args[0] if args else "(空)"}')
            self.render()
            return {'type': 'noop'}
        stock = self.ctx.state.get(f'stock.{good_id}') or 0
        if stock <= 0:
            self.ctx.io.print(f'  没有库存：{self.goods[good_id].get("name")} 一件都没有，先 buy 进货吧。')
            self.render()
            return {'type': 'noop'}
        count = self._count(args[1] if len(args) > 1 else None, stock)
        if count <= 0:
            self.ctx.io.print('  数量至少为 1。')
            self.render()
            return {'type': 'noop'}
        count = min(count, stock)
        price = self.price_of(good_id) or 0
        income = price * count
        self.ctx.state.apply({'gold': income, f'stock.{good_id}': -count})
        self.ctx.io.print(f'  出货：{self.goods[good_id].get("name")} ×{count}（+{income} 金），'
                          f'今日价 {price}。')
        self.render()
        return {'type': 'noop'}

    def next_day(self):
        if self.day >= self.active['days']:
            return self.settle()
        self.ctx.state.set('tradeDay', self.day + 1)     # 赋值，不能用 apply
        self.ctx.io.print(f'  ▸ 第 {self.day} 天')
        self.render()
        return {'type': 'noop'}

    def settle(self):
        gold = self.ctx.state.get('gold') or 0
        base = self.ctx.state.get('tradeBaseGold') or 0
        self.ctx.state.set('tradeProfit', gold - base)
        self.ctx.io.print(f'  收市结算：本金 {base} → 现有 {gold}，净赚 {gold - base} 金。')
        self.active = None
        target = self._on_end
        if target:
            self.ctx.engine.goto(target)
            return {'type': 'scene', 'id': target}
        return {'type': 'rerender'}

    def render(self):
        if not self.active:
            return
        gold = self.ctx.state.get('gold') or 0
        self.ctx.io.print(f'  ⚖ {self.active["name"]} · 第 {self.day}/{self.active["days"]} 天 | 金币 {gold}')
        for good_id in self.ids:
            price = self.price_of(good_id) or 0
            stock = self.ctx.state.get(f'stock.{good_id}') or 0
            self.ctx.io.print(f'    {good_id}({self.goods[good_id].get("name")}) '
                              f'进价 {self.goods[good_id].get("buy")} | 今日卖出价 {price} | 库存 {stock}')
        self.ctx.io.print('  指令: buy 进货 | sell 出货 | next 下一天 | info 行情 | help 帮助')
        self.ctx.io.blank()
