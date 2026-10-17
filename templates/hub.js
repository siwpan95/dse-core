// 模板：枢纽辐射（hub-and-spoke）
//
// 用法：dse new my-pack --template=hub
// 结构：一个可反复回到的枢纽，每条辐条是一条线索；线索走完回枢纽，
//       直到满足收束条件才开门。
// 适用：侦探调查、多线索并行、城镇探索。
//
// 要点：辐条场景必须能回到枢纽（否则玩家卡死）；收束条件写在枢纽的选项
//       `if` 上，条件不满足时选项自动隐藏，玩家自然会先去跑其它辐条。

export const pack = {
  id: '__PACK_ID__',
  name: '未命名 · 枢纽调查',
  version: '0.1.0',
  entry: '__NS__.hub',
  description: 'TODO：一句话说清要查什么',
  modes: [],
  requires: { plugins: [], state: ['__NS__Evidence'] },   // 计数类状态须在 cordis.yml 预声明
}

export default {
  '__NS__.hub': {
    title: 'TODO · 枢纽',
    text: 'TODO：正文。写清"这里是哪儿、现在几点、还有几处没去"。',
    choices: [
      {
        text: 'TODO：去甲处',
        if: '!flags.__NS__.spokeA',     // 走过一次后不再显示（一次性辐条）
        goto: '__NS__.spokeA',
      },
      {
        text: 'TODO：去乙处',
        if: '!flags.__NS__.spokeB',
        goto: '__NS__.spokeB',
      },
      {
        // 收束门：证据够了才出现
        text: 'TODO：摊牌（需 2 条线索）',
        if: '__NS__Evidence >= 2',
        goto: '__NS__.showdown',
      },
    ],
  },

  '__NS__.spokeA': {
    title: 'TODO · 辐条甲',
    text: 'TODO：正文。',
    onEnter: { 'flags.__NS__.spokeA': true, '__NS__Evidence': +1 },
    choices: [
      { text: 'TODO：回枢纽', goto: '__NS__.hub' },
    ],
  },

  '__NS__.spokeB': {
    title: 'TODO · 辐条乙',
    text: 'TODO：正文。',
    onEnter: { 'flags.__NS__.spokeB': true, '__NS__Evidence': +1 },
    choices: [
      { text: 'TODO：回枢纽', goto: '__NS__.hub' },
    ],
  },

  '__NS__.showdown': {
    title: 'TODO · 摊牌',
    text: 'TODO：正文。',
    choices: [
      { text: 'TODO：结局甲', goto: '__NS__.endA' },
      { text: 'TODO：结局乙', goto: '__NS__.endB' },
    ],
  },

  '__NS__.endA': {
    title: '结局 · TODO',
    text: 'TODO：结局正文。',
    choices: [{ text: '再来一次', goto: '@restart' }],
  },

  '__NS__.endB': {
    title: '结局 · TODO',
    text: 'TODO：结局正文。',
    choices: [{ text: '再来一次', goto: '@restart' }],
  },
}
