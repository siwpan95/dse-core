# 模板：经营支线（mode: 'trade'）
#
# 用法：python cli.py new my-pack --template=trade --ns=my
# 机制：场景声明 mode + trade 配置，由 trade 插件接管
#       （buy <商品> [数量] / sell <商品> [数量] / next 下一天 / info 行情）。
#
# 契约：trade['days'] 不得超过行情表列数，否则超出的天数卖出价为 0（校验会报 [契约]）。
# 结算：插件收市时写 tradeProfit（净赚），内容侧按它分结局。

PACK = {
    'id': '__PACK_ID__',
    'name': '未命名 · 经营支线',
    'version': '0.1.0',
    'entry': '__NS__.open',
    'description': 'TODO：一句话说清经营的是什么、赌的是什么',
    'modes': ['trade'],
    'requires': {'plugins': ['trade'], 'state': ['gold', 'tradeProfit']},
}

SCENES = {
    '__NS__.open': {
        'title': 'TODO · 开市',
        'text': 'TODO：正文。交代本金、市场、以及"这一次赌的是什么"。',
        'mode': 'trade',
        'trade': {'name': 'TODO：市场名', 'days': 3, 'onEnd': '__NS__.settle'},
    },

    '__NS__.settle': {
        'title': 'TODO · 收市',
        'text': 'TODO：正文。净赚 {tradeProfit} 金——用插值把数字直接写进正文。',
        'choices': [
            {'text': 'TODO：够了，见好就收', 'if': 'tradeProfit >= 30', 'goto': '__NS__.endGood'},
            {'text': 'TODO：还不够，明天再来', 'if': 'tradeProfit < 30', 'goto': '__NS__.endPoor'},
        ],
    },

    '__NS__.endGood': {
        'title': '结局 · TODO',
        'text': 'TODO：结局正文。',
        'choices': [{'text': '再来一次', 'goto': '@restart'}],
    },

    '__NS__.endPoor': {
        'title': '结局 · TODO',
        'text': 'TODO：结局正文。亏了也要有出路，别让玩家白跑一趟。',
        'choices': [{'text': '再来一次', 'goto': '@restart'}],
    },
}
