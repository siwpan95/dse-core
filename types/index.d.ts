// dse-core 类型声明骨架
//
// 现状：引擎是 JS（ESM），本文件只提供**编辑器补全与调用方类型提示**，
//       不参与运行时、不做编译期校验。字段说明以 docs/CONTENT-PACK-SPEC.md 为准。
// 用法：import type { Scene, Choice, PackManifest } from 'dse-core/types'

/** 效果对象：数值=加减，非数值=赋值，点路径=深层写入 */
export type Effects = Record<string, number | string | boolean | null>

/** 选项 */
export interface Choice {
  /** 选项文本，支持 {path} 插值 */
  text: string
  /** 显示条件表达式；缺省恒真 */
  if?: string
  /** 选中后执行的效果 */
  do?: Effects
  /** 跳转目标：场景 ID，或特殊目标 @restart / @loop:<场景ID> */
  goto?: string
}

/** 战斗配置（mode: 'battle'） */
export interface BattleSpec {
  enemy: string
  onWin?: string
  onLose?: string
  onFlee?: string
}

/** 经营配置（mode: 'trade'） */
export interface TradeSpec {
  name?: string
  days?: number
  onEnd?: string
}

/** 日记回溯配置（mode: 'diary'） */
export interface DiarySpec {
  onExit?: string
}

/** 对话话题 */
export interface Topic {
  id: string
  name: string
  reply: string
  if?: string
  effect?: Effects
}

/** 对话配置（mode: 'dialogue'） */
export interface DialogueSpec {
  npc?: string
  /** 注意点预算，0 = 不限 */
  notes?: number
  onEnd?: string
  topics?: Topic[]
}

/** 场景定义 */
export interface Scene {
  title?: string
  text: string
  onEnter?: Effects
  mode?: 'normal' | 'battle' | 'trade' | 'diary' | 'dialogue' | (string & {})
  choices?: Choice[]
  battle?: BattleSpec
  trade?: TradeSpec
  diary?: DiarySpec
  dialogue?: DialogueSpec
}

/** 场景字典：场景 ID → 场景定义 */
export type SceneDict = Record<string, Scene>

/** 内容包元数据（模块导出名 pack，可选） */
export interface PackManifest {
  id: string
  name?: string
  version?: string
  entry?: string
  description?: string
  author?: string
  modes?: string[]
  requires?: { plugins?: string[]; state?: string[] }
}

/** 引擎命令处理器的返回值 */
export type CommandResult =
  | { type: 'choice'; index: number }
  | { type: 'scene'; id: string }
  | { type: 'rerender' }
  | { type: 'noop' }
  | { type: 'quit' }
  | { type: 'nothing' }

/** 图分析结果（lib/graph.mjs 的 analyze） */
export interface GraphReport {
  scenes: number
  reachable: Set<string>
  reachableCount: number
  unreachable: string[]
  order: string[]
  depth: Map<string, number>
  dangling: Array<{ from: string; to: string; kind: string; raw: string }>
  endings: string[]
  endingsReachable: string[]
  deadEnds: string[]
}

/** createEngine 的选项 */
export interface EngineOptions {
  /** 项目根（含 cordis.yml）；缺省为引擎自身目录 */
  root?: string
  entry?: string
  input?: string | string[]
  banner?: boolean
  quiet?: boolean
  mute?: boolean
}

/** 编程式启动 */
export declare function createEngine(options?: EngineOptions): Promise<any>

/** 只读体检 */
export declare function inspectProject(root?: string): Promise<{
  root: string
  entry: string
  packFiles: string[]
  packs: PackManifest[]
  scenes: number
  endings: number
  endingsReachable: number
  unreachable: string[]
  dangling: Array<{ from: string; to: string; kind: string; raw: string }>
}>
