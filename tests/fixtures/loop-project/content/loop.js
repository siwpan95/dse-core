// 测试用内容包：时间循环短篇（验证 @loop 语义与 SDK 的外部项目根）
//
// 机制：goto '@loop:<场景>' = 部分重置后跳转 —— state 回 initial，但
// cordis.yml 里 loopKeep 声明的域（clues.loop）从旧状态保留。
// 于是"线索跨轮保留、行动力每轮复原"。
//
// 这里最后一个场景 loop.end **没有 choices**，是真正的终局（引擎打印「（完）」）；
// 与引擎自带示例里"只挂 @restart 重开"的结算页不同，两者都算结局，但收尾不同。

export const pack = {
  id: 'loop-demo',
  name: '循环短篇（测试夹具）',
  version: '0.1.0',
  entry: 'loop.dawn',
  description: '验证 @loop 部分重置与 loopKeep 保留域',
  modes: [],
  requires: { plugins: [], state: ['loop'] },
}

export default {
  'loop.dawn': {
    title: '清晨',
    text: '钟响了三下。你又是从这个门口醒来的——第几次了，你数不清。',
    choices: [
      {
        text: '出门（还剩 {loop.moves} 次机会）',
        if: 'loop.moves > 0',
        do: { 'loop.moves': -1 },
        goto: 'loop.street',
      },
      {
        text: '摊牌',
        if: 'clues.loop.a && clues.loop.b',
        goto: 'loop.end',
      },
    ],
  },

  'loop.street': {
    title: '街上',
    text: '街上的人和昨天一样多，也一样沉默。你只有两个地方可去。',
    choices: [
      { text: '查甲处', do: { 'clues.loop.a': true }, goto: 'loop.night' },
      { text: '查乙处', do: { 'clues.loop.b': true }, goto: 'loop.night' },
    ],
  },

  'loop.night': {
    title: '入夜',
    text: '天黑下来，你回到门口。明天，又是同一声钟。',
    choices: [
      { text: '睡下', goto: '@loop:loop.dawn' },
    ],
  },

  'loop.end': {
    title: '结局 · 摊牌',
    text: '你把两件事摆在一起，它们第一次对上了。钟没有再响。',
  },
}
