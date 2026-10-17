# 模板：对话 / 谈判（mode: 'dialogue'）
#
# 用法：python cli.py new my-pack --template=dialogue --ns=my
# 机制：场景声明 mode + dialogue 配置，由 dialogue 插件接管
#       （ask <编号|名称> 询问 / topics 话题列表 / end 结束）。
#       topics[].effect 改状态，topics[].if 控制何时可见，notes 是注意点预算（0 = 不限）。
#
# 已问话题记在 state['dialogueAsked']（存档可恢复），重复进同一对话不会重复问。

PACK = {
    'id': '__PACK_ID__',
    'name': '未命名 · 对话',
    'version': '0.1.0',
    'entry': '__NS__.meet',
    'description': 'TODO：一句话说清跟谁谈、要问出什么',
    'modes': ['dialogue'],
    'requires': {'plugins': ['dialogue'], 'state': ['dialogueAsked']},
}

SCENES = {
    '__NS__.meet': {
        'title': 'TODO · 见面',
        'text': 'TODO：正文。写清对方是谁、此刻什么处境、为什么肯跟你说话。',
        'mode': 'dialogue',
        'dialogue': {
            'npc': 'TODO：对方称呼',
            'notes': 3,
            'onEnd': '__NS__.after',
            'topics': [
                {
                    'id': 'a', 'name': 'TODO：话题甲',
                    'reply': 'TODO：对方的回答。回答里最好再埋一个新话题的引子。',
                    'effect': {'__NS__Clues': 1},
                },
                {
                    'id': 'b', 'name': 'TODO：话题乙',
                    'reply': 'TODO：对方的回答。',
                    'effect': {'__NS__Clues': 1},
                },
                {
                    'id': 'c', 'name': 'TODO：话题丙（问过甲才出现）',
                    'if': 'flags.__NS__.askedA',
                    'reply': 'TODO：对方的回答。这是关键的一问。',
                    'effect': {'__NS__Clues': 1, 'flags.__NS__.key': True},
                },
            ],
        },
    },

    '__NS__.after': {
        'title': 'TODO · 谈完',
        'text': 'TODO：正文。谈完之后世界发生了什么变化。',
        'choices': [
            {'text': 'TODO：掌握了关键（需问过丙）', 'if': 'flags.__NS__.key', 'goto': '__NS__.endGood'},
            {'text': 'TODO：就这么着吧', 'goto': '__NS__.endPlain'},
        ],
    },

    '__NS__.endGood': {
        'title': '结局 · TODO',
        'text': 'TODO：结局正文。',
        'choices': [{'text': '再来一次', 'goto': '@restart'}],
    },

    '__NS__.endPlain': {
        'title': '结局 · TODO',
        'text': 'TODO：结局正文。',
        'choices': [{'text': '再来一次', 'goto': '@restart'}],
    },
}
