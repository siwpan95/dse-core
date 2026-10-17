# 模板：分支—瓶颈（branch-and-bottleneck）
#
# 用法：python cli.py new my-pack --template=branch --ns=my
# 结构：枢纽 → 若干分支 → 收束到一个瓶颈场景 → 按累计状态分叉出结局。
# 适用：线性主线、有明确"下一段"的剧情。
#
# 填充：① 改 PACK 的 id/name；② 把 TODO 换成真内容（normal 场景 ≥120 字）；
#       ③ 在 cordis.json 的 scenes.config.packs 挂上本包。

PACK = {
    'id': '__PACK_ID__',
    'name': '未命名 · 分支主线',
    'version': '0.1.0',
    'entry': '__NS__.start',
    'description': 'TODO：一句话说清这段内容讲什么',
    'modes': [],
    'requires': {'plugins': [], 'state': []},
}

SCENES = {
    '__NS__.start': {
        'title': 'TODO · 开场',
        'text': 'TODO：正文。交代"我是谁、我在哪、我要去哪"，并把分叉埋进最后一句。',
        'choices': [
            {'text': 'TODO：路线甲', 'do': {'flags.__NS__.routeA': True}, 'goto': '__NS__.routeA'},
            {'text': 'TODO：路线乙', 'do': {'flags.__NS__.routeB': True}, 'goto': '__NS__.routeB'},
        ],
    },

    '__NS__.routeA': {
        'title': 'TODO · 路线甲',
        'text': 'TODO：正文。',
        'choices': [{'text': 'TODO：继续', 'goto': '__NS__.bottleneck'}],
    },

    '__NS__.routeB': {
        'title': 'TODO · 路线乙',
        'text': 'TODO：正文。',
        'choices': [{'text': 'TODO：继续', 'goto': '__NS__.bottleneck'}],
    },

    '__NS__.bottleneck': {
        'title': 'TODO · 收束点',
        'text': 'TODO：正文。这里是两条路汇合的地方，玩家的选择在此处第一次显出后果。',
        'choices': [
            {'text': 'TODO：走向结局甲', 'if': 'flags.__NS__.routeA', 'goto': '__NS__.endA'},
            {'text': 'TODO：走向结局乙', 'if': 'flags.__NS__.routeB', 'goto': '__NS__.endB'},
        ],
    },

    '__NS__.endA': {
        'title': '结局 · TODO',
        'text': 'TODO：结局正文。',
        'choices': [{'text': '再来一次', 'goto': '@restart'}],
    },

    '__NS__.endB': {
        'title': '结局 · TODO',
        'text': 'TODO：结局正文。',
        'choices': [{'text': '再来一次', 'goto': '@restart'}],
    },
}
