# 模板：战斗支线（mode: 'battle'）
#
# 用法：python cli.py new my-pack --template=battle --ns=my
# 机制：场景声明 mode + battle 配置，由 combat 插件接管（a 攻击 / d 防御 / r 逃跑 / help）。
#
# 契约：battle['enemy'] 必须在插件清单的 combat.enemies 里定义，否则校验报 [契约] 错误。
# 数值：敌人强度按"玩家进入该线时的最低状态"标定，别按满装备标定
#       （否则从入口直接进来的玩家 RNG 必输）。

PACK = {
    'id': '__PACK_ID__',
    'name': '未命名 · 战斗支线',
    'version': '0.1.0',
    'entry': '__NS__.approach',
    'description': 'TODO：一句话说清打的是谁、为什么打',
    'modes': ['battle'],
    'requires': {'plugins': ['combat'], 'state': ['hp', 'atk']},
}

SCENES = {
    '__NS__.approach': {
        'title': 'TODO · 逼近',
        'text': 'TODO：正文。开打前给足理由，别让战斗凭空发生。',
        'choices': [
            {'text': 'TODO：上', 'do': {'flags.__NS__.engaged': True}, 'goto': '__NS__.fight'},
            {'text': 'TODO：绕开', 'goto': '__NS__.avoid'},
        ],
    },

    '__NS__.fight': {
        'title': 'TODO · 交手',
        'text': 'TODO：战斗场景正文（可短）。',
        'mode': 'battle',
        'battle': {
            'enemy': 'wolf',                  # TODO：换成 combat.enemies 里已定义的 ID
            'onWin': '__NS__.win',
            'onLose': '__NS__.lose',
            'onFlee': '__NS__.approach',      # 不写 onFlee 则逃跑不流转
        },
    },

    '__NS__.win': {
        'title': 'TODO · 打赢之后',
        'text': 'TODO：正文。战利品由敌人的 drops 发放，这里只写后果。',
        'choices': [{'text': 'TODO：继续', 'goto': '__NS__.after'}],
    },

    '__NS__.lose': {
        'title': '结局 · TODO',
        'text': 'TODO：失败结局正文。',
        'choices': [{'text': '再来一次', 'goto': '@restart'}],
    },

    '__NS__.avoid': {
        'title': 'TODO · 绕开',
        'text': 'TODO：正文。不打也要能走下去，否则玩家没有选择。',
        'choices': [{'text': 'TODO：继续', 'goto': '__NS__.after'}],
    },

    '__NS__.after': {
        'title': 'TODO · 之后',
        'text': 'TODO：正文。',
        'choices': [{'text': 'TODO：结局', 'goto': '__NS__.end'}],
    },

    '__NS__.end': {
        'title': '结局 · TODO',
        'text': 'TODO：结局正文。',
        'choices': [{'text': '再来一次', 'goto': '@restart'}],
    },
}
