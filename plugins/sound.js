// 音效插件 —— 订阅事件 → 程序化合成 PCM → 播放
//
// 设计要点：
//   1. 音效全部程序化合成（无外部音频资源），波形 + ADSR 包络，避免爆音
//   2. 纯事件订阅：scene/enter、choice/made、achievement/unlock、battle/*、engine/end
//      零侵入 —— 引擎与其他插件完全不知道音效存在
//   3. 播放由子进程完成（PlaySync），主进程不阻塞游戏输入
//   4. 事件 → 音效映射数据驱动，可在 cordis.yml 覆盖/扩充，支持 mute

import { Service } from 'cordis'
import { spawn } from 'node:child_process'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, platform } from 'node:os'

export const name = 'sound'

/** 波形函数：相位 → [-1, 1] */
const WAVES = {
  sine: (p) => Math.sin(p),
  square: (p) => (Math.sin(p) >= 0 ? 1 : -1),
  saw: (p) => 2 * ((p / (2 * Math.PI)) % 1) - 1,
  triangle: (p) => (2 / Math.PI) * Math.asin(Math.sin(p)),
}

/** ADSR 包络：attack 5% + 指数衰减 + 尾部淡出，消除爆音 */
function envelope(progress) {
  const attack = 0.05
  if (progress < attack) return progress / attack
  return Math.pow(1 - (progress - attack) / (1 - attack), 2)
}

/** 合成一段采样（支持单频或多音符序列） */
export function synth(spec, sampleRate = 22050) {
  const { freq = 440, notes, ms = 100, wave = 'sine', gain = 0.3 } = spec
  const shape = WAVES[wave] ?? WAVES.sine
  const samples = []
  for (const f of notes ?? [freq]) {
    const count = Math.max(1, Math.floor((sampleRate * ms) / 1000))
    for (let i = 0; i < count; i++) {
      const phase = 2 * Math.PI * f * (i / sampleRate)
      samples.push(shape(phase) * envelope(i / count) * gain)
    }
  }
  return samples
}

/** 编码为 16-bit PCM 单声道 WAV */
export function encodeWav(samples, sampleRate = 22050) {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)          // PCM
  buffer.writeUInt16LE(1, 22)          // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  }
  return buffer
}

/** 默认音效库：事件 → 音色（可被 cordis.yml 的 config.sounds 覆盖） */
export const PRESETS = {
  'scene-enter': { freq: 523.25, ms: 90, wave: 'sine', gain: 0.22 },            // C5
  'choice': { freq: 659.25, ms: 55, wave: 'square', gain: 0.12 },               // E5 短促
  'achievement': { notes: [659.25, 783.99, 1046.5], ms: 130, wave: 'sine' },    // 上行琶音
  'battle-hit': { notes: [220, 165], ms: 90, wave: 'saw', gain: 0.2 },          // 受击下行
  'battle-crit': { notes: [330, 440, 587], ms: 70, wave: 'square', gain: 0.2 }, // 暴击
  'battle-win': { notes: [523.25, 659.25, 783.99, 1046.5], ms: 120, wave: 'triangle' },
  'battle-lose': { notes: [392, 349.23, 293.66], ms: 220, wave: 'triangle' },   // 下行
  'game-over': { notes: [392, 349.23, 293.66, 261.63], ms: 260, wave: 'sine' },
  'hot-reload': { notes: [880, 1174.66], ms: 70, wave: 'sine', gain: 0.15 },
  'save': { freq: 783.99, ms: 100, wave: 'triangle', gain: 0.18 },
}

/** 事件 → 音效名（订阅表） */
const HOOKS = {
  'scene/enter': 'scene-enter',
  'choice/made': 'choice',
  'achievement/unlock': 'achievement',
  'save/applied': 'save',
  'battle/hit': 'battle-hit',
  'battle/crit': 'battle-crit',
  'battle/end': (isWin) => (isWin ? 'battle-win' : 'battle-lose'),
  'engine/end': 'game-over',
  'hot-reload/applied': 'hot-reload',
}

/** 各平台的默认播放命令（{file} 占位符会被替换） */
const PLAYERS = {
  win32: ['powershell.exe', ['-NoProfile', '-Command', '$p = New-Object System.Media.SoundPlayer; $p.SoundLocation = "{file}"; $p.PlaySync()']],
  darwin: ['afplay', ['{file}']],
  linux: ['aplay', ['-q', '{file}']],
}

export class SoundService extends Service {
  static inject = []

  constructor(ctx, config) {
    super(ctx, 'sound')
    this.config = config
    // 静音优先级：环境变量 DSE_MUTE=1 > cordis.yml 的 config.mute
    this.muted = process.env.DSE_MUTE === '1' || !!config.mute
    this.sampleRate = config.sampleRate ?? 22050
    this.sounds = { ...PRESETS, ...(config.sounds ?? {}) }
    this.counter = 0
    /** 已生成的临时文件列表，退出时清理 */
    this.files = []
    this.played = 0
    // 全检：DSE_SFX_DIR 供测试/隔离运行指定独立输出目录。
    // 此前只有固定默认路径，多个进程（含并发测试与手工运行实例）会互相污染，
    // 导致 e2e 的 G5「静音模式不生成任何音频文件」偶发失败。
    this.dir = config.dir ?? process.env.DSE_SFX_DIR ?? join(tmpdir(), 'dict-scene-engine-sfx')
  }

  async [Service.init]() {
    if (!this.muted) {
      await mkdir(this.dir, { recursive: true })
      this.ctx.root.effect(() => async () => this.cleanup())
    }
    // 事件注册放在 init 早期，但必须容忍「游戏已经退出了」的竞态：
    // 极速输入（管道里 1\n1\nquit 一闪而过）时，游戏可能在插件 init 完成前
    // 就 dispose，此时 ctx 已失效，ctx.on 会抛 INACTIVE_EFFECT。
    // 这是良性竞态（不再需要音效），不能让它把进程变成非零退出。
    try {
      for (const [event, mapping] of Object.entries(HOOKS)) {
        this.ctx.on(event, (...args) => {
          const key = typeof mapping === 'function' ? mapping(...args) : mapping
          this.play(key)
        })
      }
    } catch (error) {
      if (error?.code !== 'INACTIVE_EFFECT') throw error
      this.ctx.logger('sound').debug('游戏已退出，跳过音效事件注册')
      return
    }

    // 启动日志让出一个宏任务再打：插件 init 的执行顺序不保证等于声明顺序，
    // 否则本条日志可能早于 logger-console 注册 exporter 而丢失。
    await new Promise((resolve) => setTimeout(resolve, 0))
    try {
      if (this.muted) {
        this.ctx.logger('sound').info('音效已静音（mute: true）')
      } else {
        this.ctx.logger('sound').info('registered %d sound effects', Object.keys(this.sounds).length)
      }
    } catch {
      // 游戏可能已退出，日志丢弃即可，不能因此崩溃
    }
  }

  /** 播放一个音效（静音时只记日志） */
  async play(key) {
    const spec = this.sounds[key]
    if (!spec) return false
    if (this.muted) return true
    try {
      const samples = synth(spec, this.sampleRate)
      const wav = encodeWav(samples, this.sampleRate)
      const file = join(this.dir, `sfx-${this.counter++}-${key}.wav`)
      await writeFile(file, wav)
      this.files.push(file)
      this.spawnPlayer(file)
      this.played++
      return true
    } catch (error) {
      this.ctx.logger('sound').warn('音效播放失败 "%s": %s', key, error.message)
      return false
    }
  }

  /** 起子进程播放（不 await，避免阻塞游戏输入） */
  spawnPlayer(file) {
    const [command, args] = this.config.player ?? PLAYERS[platform()] ?? PLAYERS.linux
    const child = spawn(command, args.map((a) => a.replace('{file}', file)), {
      stdio: 'ignore',
      windowsHide: true,
    })
    // 关键：播放器进程不得保持父进程存活。引擎退出时不调用 process.exit()，
    // 而是等事件循环自然排空；未 unref 的子进程句柄会让游戏退出后仍挂着不退出
    // （快速操作时尤其明显：多个音效同时播放，子进程成堆）。
    child.unref()
    child.on('error', () => {
      // 无播放器/无音频设备时静默降级，不打断游戏
      this.ctx.logger('sound').debug('player unavailable, sound skipped')
    })
  }

  async cleanup() {
    await Promise.allSettled(this.files.splice(0).map((f) => unlink(f).catch(() => {})))
  }
}

export default SoundService
