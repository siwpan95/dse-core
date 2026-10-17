// 模板：日记回溯（mode: 'diary'）+ 年代跃迁
//
// 用法：dse new my-pack --template=diary
// 机制：场景声明 mode: 'diary' + diary: { onExit }，由 diary 插件接管：
//       列出玩家已走过的篇目，输入编号可只读地重读（不重放 onEnter）。
//
// 年代跃迁用法：diary 场景本身当作"翻到某一页"的入口。玩家每走过一个非 diary
// 场景，diary 插件就把它记进 state.diaryRead（存档可恢复），因此回溯目录
// 天然就是"我已读过的年表"。

export const pack = {
  id: '__PACK_ID__',
  name: '未命名 · 札记回溯',
  version: '0.1.0',
  entry: '__NS__.p1',
  description: 'TODO：一句话说清这是谁的札记、跨度多少年',
  modes: ['diary'],
  requires: { plugins: ['diary'], state: ['diaryRead'] },
}

export default {
  '__NS__.p1': {
    title: 'TODO · 第一幕（年份）',
    text: 'TODO：正文。第一幕要立住人物与他的处境。',
    choices: [
      { text: 'TODO：往下走', do: { 'flags.__NS__.p1': true }, goto: '__NS__.p2' },
      { text: 'TODO：翻回札记看看', goto: '__NS__.read' },
    ],
  },

  '__NS__.p2': {
    title: 'TODO · 第二幕（年份）',
    text: 'TODO：正文。年代跃迁靠"同一件事在不同年纪的看法"制造落差。',
    choices: [
      { text: 'TODO：往下走', do: { 'flags.__NS__.p2': true }, goto: '__NS__.end' },
      { text: 'TODO：翻回札记看看', goto: '__NS__.read' },
    ],
  },

  // 回溯入口：只读，不产生任何状态变更
  '__NS__.read': {
    title: 'TODO · 札记',
    text: 'TODO：正文。写"他翻开札记"这个动作，目录由插件渲染（编号重读 / back 返回）。',
    mode: 'diary',
    diary: { onExit: '__NS__.p1' },
  },

  '__NS__.end': {
    title: '结局 · TODO',
    text: 'TODO：结局正文。',
    choices: [{ text: '再来一次', goto: '@restart' }],
  },
}
