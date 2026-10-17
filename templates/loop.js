// 模板：时间循环（@loop）
//
// 用法：dse new my-pack --template=loop
// 结构：每一轮从同一场景开始，行动力（moves）每轮复原，但"知识"跨轮保留。
//
// 机制（引擎语义，非新 mode）：
//   goto: '@loop:<场景ID>'  部分重置后跳到该场景
//   保留域由 cordis.yml 的 state.config.loopKeep 声明，例如：
//     loopKeep: [clues.__NS__, flags.__NS__]
//   于是 clues.__NS__.*（线索）跨轮保留，__NS__Moves（行动力）每轮复原。
//
// 校验：@loop: 的目标场景必须存在（lint 会查，并把该边计入可达性）。

export const pack = {
  id: '__PACK_ID__',
  name: '未命名 · 时间循环',
  version: '0.1.0',
  entry: '__NS__.dawn',
  description: 'TODO：一句话说清这一夜里要拼出什么',
  modes: [],
  requires: {
    plugins: [],
    state: ['__NS__Moves'],
  },
}

export default {
  '__NS__.dawn': {
    title: 'TODO · 第 N 天清晨',
    text: 'TODO：正文。每轮开场都要给一个"又回到这里"的信号（钟声、水声、同一句话）。',
    choices: [
      {
        text: 'TODO：出门（还剩 {__NS__Moves} 次机会）',
        if: '__NS__Moves > 0',
        do: { '__NS__Moves': -1 },
        goto: '__NS__.street',
      },
      {
        // 收束：线索齐了才走得出去
        text: 'TODO：去摊牌',
        if: 'clues.__NS__.a && clues.__NS__.b',
        goto: '__NS__.truth',
      },
    ],
  },

  '__NS__.street': {
    title: 'TODO · 街上',
    text: 'TODO：正文。',
    choices: [
      {
        text: 'TODO：查甲处',
        do: { 'clues.__NS__.a': true, 'flags.__NS__.askedA': true },
        goto: '__NS__.night',
      },
      {
        text: 'TODO：查乙处',
        do: { 'clues.__NS__.b': true, 'flags.__NS__.askedB': true },
        goto: '__NS__.night',
      },
    ],
  },

  '__NS__.night': {
    title: 'TODO · 入夜',
    text: 'TODO：正文。夜里收束一次，然后回到清晨——行动力复原，线索留下。',
    choices: [
      {
        text: 'TODO：睡下（回到清晨）',
        goto: '@loop:__NS__.dawn',   // 部分重置：loopKeep 里的域保留
      },
    ],
  },

  '__NS__.truth': {
    title: '结局 · TODO',
    text: 'TODO：结局正文。',
    choices: [{ text: '再来一次', goto: '@restart' }],
  },
}
