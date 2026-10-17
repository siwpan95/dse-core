// 场景字典服务（引擎核心）：把「场景」抽象为一个字典（Dict<Scene>）
// 内容包导出一个场景字典对象即可被引擎解释执行。
//
// ⚠️ 安全说明：内容包是 ESM 模块，加载 = 执行（模块顶层代码立即运行，拥有完整
// Node 权限）。下面的 validate() 只用于发现字段拼写错误等开发期问题，**不是安全
// 控制** —— import() 先于 validate() 执行，不可信内容包无法靠校验拦截。
//
// 场景 Schema：
//   {
//     title: '场景标题',
//     text:  '描述文本，支持 {name} {hp} 等状态插值',
//     onEnter: { ...effects },          // 进入场景时执行的效果（可选）
//     choices: [                         // 选项（可选；无选项 = 结局场景）
//       {
//         text: '选项文本',
//         if: 'hp >= 10 && gold > 0',    // 显示条件（可选，基于玩家状态求值）
//         do: { hp: -5, gold: +1 },      // 选中后执行的效果（可选）
//         goto: 'next-scene',            // 目标场景 ID
//       },
//     ],
//   }

import { Service } from 'cordis'
import { assertInsideProject } from './lib/safe-path.js'

export const name = 'scenes'

export class SceneService extends Service {
  static inject = []

  constructor(ctx, config) {
    super(ctx, 'scenes')
    this.config = config
    /** @type {Record<string, object>} 场景字典本体 */
    this.dict = Object.create(null)
    /** 内容包路径列表（顺序即覆盖优先级：后者覆盖前者） */
    this.packs = []
    /** 已加载的内容包内容缓存：path -> pack 字典 */
    this.loaded = new Map()
  }

  async [Service.init]() {
    for (const path of this.config.packs ?? []) {
      await this.load(path)
    }
    this.rebuild()
    this.ctx.logger('scenes').info('loaded %d scenes from %d pack(s)', this.size, this.packs.length)
  }

  /** 加载一个内容包（JS 模块导出字典；同 ID 场景后者覆盖前者） */
  async load(path) {
    const pack = await this.importPack(path)
    this.loaded.set(path, pack)
    if (!this.packs.includes(path)) this.packs.push(path)
    return pack
  }

  /** 热重载一个内容包：绕过 ESM 缓存重新导入并重建字典
   *  @returns {Promise<boolean>} true=已替换；false=被拒绝（字典保持原样）
   */
  async reload(path) {
    if (!this.loaded.has(path)) {
      this.ctx.logger('scenes').warn('reload skipped: 内容包 %s 不在配置中', path)
      return false
    }
    const previous = this.loaded.get(path)
    let pack
    try {
      pack = await this.importPack(path, Date.now())
    } catch (error) {
      this.ctx.logger('scenes').error('reload rejected: %s（保留旧内容）', error.message)
      return false
    }
    this.loaded.set(path, pack)
    try {
      this.rebuild()
      return true
    } catch (error) {
      // rebuild 走双缓冲，此处 this.dict 未被污染；只需回滚内容缓存保持一致
      this.loaded.set(path, previous)
      this.ctx.logger('scenes').error('reload rejected: %s（保留旧内容）', error.message)
      return false
    }
  }

  async importPack(path, cacheBust) {
    // 路径白名单：只加载项目内的内容包（见 plugins/lib/safe-path.js）
    assertInsideProject(path, this.ctx.root.baseUrl, '内容包路径')
    let url = new URL(path, this.ctx.root.baseUrl).href
    if (cacheBust !== undefined) url += '?t=' + cacheBust
    const exports = await import(url)
    const pack = exports.default ?? exports
    if (!pack || typeof pack !== 'object') {
      throw new Error(`场景包 ${path} 未导出字典对象`)
    }
    const errors = this.validate(pack, path)
    if (errors.length) {
      throw new Error(`场景包 ${path} 校验失败:\n${errors.join('\n')}`)
    }
    return pack
  }

  /** 按 packs 顺序重建场景字典（双缓冲）：先在临时 dict 上全量校验，
   *  通过后才原子替换 this.dict —— 保证「校验失败 = 旧字典毫发无损」，
   *  不会出现日志宣称回滚、实际字典已被污染的情况。
   */
  rebuild() {
    const next = Object.create(null)
    for (const path of this.packs) {
      for (const [id, scene] of Object.entries(this.loaded.get(path) ?? {})) {
        next[id] = scene
      }
    }
    const dangling = this.findDangling(next)
    if (dangling.length) {
      throw new Error(`存在未定义的场景跳转:\n${dangling.join('\n')}`)
    }
    this.dict = next
    return true
  }

  /** 检查悬空 goto 引用与缺失 goto，返回错误列表（空数组 = 通过）
   *  '@' 开头的特殊目标（如 @restart）免检。
   *  ⚠️ 选项缺失 goto 也在此拦截（审计 F11）：运行时引擎对无 goto 的选项
   *  不流转、重进当前场景 → onEnter 副作用（扣钱/发物品）重复执行，与
   *  全检报告 #4 修过的 rerender 重放是同一类坑。lint 侧同步为 error。
   */
  findDangling(dict) {
    const dangling = []
    for (const [id, scene] of Object.entries(dict)) {
      for (const [i, choice] of (scene.choices ?? []).entries()) {
        const target = choice?.goto
        if (target === undefined) {
          dangling.push(`  - #${id} 第 ${i + 1} 个选项缺少 goto（选中后无法流转，会重放 onEnter）`)
          continue
        }
        if (!String(target).startsWith('@') && !(target in dict)) {
          dangling.push(`  - #${id} 第 ${i + 1} 个选项 -> "${target}"`)
        }
      }
    }
    return dangling
  }

  /** 校验字典结构，返回错误列表（空数组 = 通过） */
  validate(pack, source = '<inline>') {
    const errors = []
    for (const [id, scene] of Object.entries(pack)) {
      const at = `${source}#${id}`
      if (!scene || typeof scene !== 'object') {
        errors.push(`  - ${at}: 场景必须是对象`)
        continue
      }
      if (typeof scene.text !== 'string') {
        errors.push(`  - ${at}: 缺少 text 字段`)
      }
      if (scene.choices !== undefined && !Array.isArray(scene.choices)) {
        errors.push(`  - ${at}: choices 必须是数组`)
      }
      for (const [i, choice] of (scene.choices ?? []).entries()) {
        if (!choice || typeof choice !== 'object' || typeof choice.text !== 'string') {
          errors.push(`  - ${at}: 第 ${i + 1} 个选项缺少 text`)
        }
      }
    }
    return errors
  }

  get(id) {
    const scene = this.dict[id]
    // 全检 E1：不再把全部场景 ID（152 个）拼进错误信息 —— 既刷屏，又泄漏内容结构
    if (!scene) throw new Error(`场景 "${id}" 不存在（共 ${this.size} 个场景，用 dse scenes 查看）`)
    return scene
  }

  has(id) {
    return id in this.dict
  }

  get size() {
    return Object.keys(this.dict).length
  }

  get ids() {
    return Object.keys(this.dict)
  }
}

export default SceneService
