// 测试驱动器：用 SDK 在**外部项目根**上启动引擎
//
// 用法：node tests/fixtures/run.mjs <项目根> [输入序列]
//
// 存在的意义：验证 SDK 的 createEngine({ root }) —— 一个引擎可以驱动任意目录下
// 的内容项目，而不必把内容放进引擎自己的 content/。CLI 的 play 走的是引擎自身
// 根目录，这个脚本补上"外部项目"这条路径。

import { createEngine } from '../../sdk/index.js'

const [root, input] = process.argv.slice(2)
if (!root) {
  process.stderr.write('用法: node tests/fixtures/run.mjs <项目根> [输入序列]\n')
  process.exitCode = 1
} else {
  await createEngine({ root, input: input ?? 'quit', mute: true, quiet: true })
}
