"""音效（骨架）。

Node 版是"事件订阅 → 程序化合成 PCM → 播放子进程"。Python 标准库没有跨平台的
音频播放能力，因此本插件只提供**同样的事件订阅机制与 play 钩子**：

- 默认静音（config.mute 缺省 True，或 DSE_MUTE=1）；
- 订阅 `battle/*`、`scene/enter`、`achievement/unlock` 等事件，查 `config.sounds` 音色表；
- 真正发声交给 `player` 钩子（可接 winsound / pygame / 外部播放器）。

也就是说：机制与 Node 版一致（事件驱动、数据驱动音色表），缺的只是"发声"这一步。
"""

from __future__ import annotations

import os

from cordis import Service

PRESETS = {
    'battle-hit': {'notes': [220, 180], 'ms': 60, 'wave': 'square', 'gain': 0.2},
    'battle-crit': {'notes': [330, 440, 587], 'ms': 70, 'wave': 'square', 'gain': 0.2},
    'battle-end': {'notes': [523, 659], 'ms': 120, 'wave': 'triangle', 'gain': 0.2},
    'achievement-unlock': {'notes': [523, 659, 784], 'ms': 90, 'wave': 'sine', 'gain': 0.18},
}

SUBSCRIBED_EVENTS = {
    'battle/hit': 'battle-hit',
    'battle/crit': 'battle-crit',
    'battle/end': 'battle-end',
    'achievement/unlock': 'achievement-unlock',
}


class SoundService(Service):
    name = 'sound'
    inject: list[str] = []

    def __init__(self, ctx, config=None):
        super().__init__(ctx, config)
        cfg = self.config or {}
        self.muted = os.environ.get('DSE_MUTE') == '1' or bool(cfg.get('mute', True))
        self.sounds = {**PRESETS, **(cfg.get('sounds') or {})}
        self.player = cfg.get('player')          # 可调用对象：player(sound_name, spec)

    def init(self):
        self.ctx.on('battle/hit', lambda who, dmg, crit: self.play('battle-crit' if crit else 'battle-hit'))
        self.ctx.on('battle/end', lambda win, enemy: self.play('battle-end'))
        self.ctx.on('achievement/unlock', lambda ident, item: self.play('achievement-unlock'))
        self.ctx.logger('sound').info('音效%s（mute: %s）', '已静音' if self.muted else '已启用', self.muted)

    def play(self, name: str) -> None:
        spec = self.sounds.get(name)
        if self.muted or spec is None:
            return
        if callable(self.player):
            try:
                self.player(name, spec)
                return
            except Exception as error:              # noqa: BLE001
                self.ctx.logger('sound').warn('播放失败 %s: %s', name, error)
        # 没有配置 player：不发声，只留诊断（避免在没有音频设备的环境里报错）
        self.ctx.logger('sound').debug('未配置 player，跳过发声: %s', name)
