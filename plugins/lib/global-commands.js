// 全局命令注册表 —— 任何场景模式下都应交由对应插件/引擎处理的命令名
//
// 背景（硬编码审计 F2）：此前 combat.js 与 trade.js 各自手抄一份 12 项
// 「放行白名单」（quit/exit/stats/status/achievements/成就/save/存/load/读/
// slots/档），新增一个全局命令需三处同步，漏改一处 = 该命令在战斗/经营中
// 被模式插件吞掉。集中到本表后，接管输入的模式插件只需查一次
// isGlobalCommand(line) 即可放行，名单只维护这一份。
//
// 语义边界：
//   放行 ≠ 处理。真正响应命令的是各插件 prepend 监听的 engine/command
//   （save 插件处理 save/load/slots，achievements 处理 achievements）与引擎
//   默认处理器（quit/exit/stats/status/help）。本表只回答「战斗中/经营中
//   是否放行给分发链」这一个问题；新增全局命令时，仍须在 engine 默认
//   处理器（或对应插件）补上实现。
//
// 按首词匹配（而非整行）：'save battle' 与 'save' 都被识别为全局命令。
// 此前 combat 用整行 switch(line) 判白名单，战斗中带参命令（save battle）
// 实际落在 default 分支被拒，只能靠 save 插件先于 combat 拦截才侥幸可用。

export const GLOBAL_COMMANDS = new Set([
  // 引擎级：退出 / 状态 / 帮助（engine 默认处理器响应）
  'quit', 'exit', 'stats', 'status', 'help', '?',
  // 成就插件
  'achievements', '成就',
  // 存档插件（含中文别名）
  'save', '存', 'load', '读', 'slots', '档',
])

/** line 的首词是否为全局命令（大小写不敏感） */
export function isGlobalCommand(line) {
  if (typeof line !== 'string') return false
  const first = line.trim().toLowerCase().split(/\s+/)[0]
  return first ? GLOBAL_COMMANDS.has(first) : false
}
