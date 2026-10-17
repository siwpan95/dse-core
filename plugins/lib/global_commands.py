"""全局命令注册表 —— 任何模式下都应放行的命令名。

背景（Node 版踩过）：combat / trade 各自手抄一份放行白名单，新增一个全局命令要改多处，
漏一处 = 该命令在战斗/经营中被模式插件吞掉。集中到这一份。

注意语义边界：**放行 ≠ 处理**。真正响应命令的是各插件（save 处理 save/load/slots、
achievements 处理 achievements）与引擎默认处理器（quit/stats/help/…）。
本表只回答"战斗中/经营中是否放行给分发链"。
"""

GLOBAL_COMMANDS = {
    # 引擎级
    'quit', 'exit', 'stats', 'status', 'help', '?',
    # 成就
    'achievements', '成就',
    # 存档（含中文别名）
    'save', '存', 'load', '读', 'slots', '档',
    # 本地化
    'lang', '语言',
}


def is_global_command(line) -> bool:
    """按首词匹配（'save battle' 与 'save' 都算全局命令），大小写不敏感。"""
    if not isinstance(line, str):
        return False
    parts = line.strip().lower().split()
    return bool(parts) and parts[0] in GLOBAL_COMMANDS
