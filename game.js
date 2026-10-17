#!/usr/bin/env node
// dict-scene-engine 游戏启动器 —— 交互式入口
//
// 启动逻辑已抽到 lib/boot.js，由 game.js（交互）与 cli.js（命令行）共用，
// 避免两套启动代码漂移。命令行用法见：node cli.js --help

import { boot } from './lib/boot.js'

await boot()
