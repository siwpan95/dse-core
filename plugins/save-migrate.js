// 存档版本迁移（骨架）—— 内容改版时旧档不失效
//
// 问题：内容包会演进（场景改名、状态字段重命名、数值语义调整），而玩家手里的
// 存档是旧结构。没有迁移机制时只能「读档失败 → 回退入口」，体验等于丢档。
//
// 做法：存档记录带 `version`；读档时按版本链逐级升级到当前版本，再交给引擎。
//   cordis.yml:
//     - id: save-migrate
//       name: ./plugins/save-migrate.js
//       config:
//         version: 2
//         migrations:
//           2: './migrations/to-v2.js'   # 模块导出 (record) => record
//
// 骨架阶段：不内置任何迁移，只提供机制与诊断（migrate() 恒等返回 + 版本日志）。
// 真正需要迁移时，把迁移函数挂进来即可，引擎与 save 插件无需改动。

import { Service } from 'cordis'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'save-migrate'

export class SaveMigrateService extends Service {
  static inject = ['state', 'io']

  constructor(ctx, config) {
    super(ctx, 'save-migrate')
    this.config = config
    /** 当前存档格式版本 */
    this.version = Number(config.version ?? 1)
    /** version → 迁移函数（惰性加载外部模块） */
    this.migrations = new Map()
    this.loaded = false
  }

  async [Service.init]() {
    await this.loadMigrations()
    this.ctx.logger('save-migrate').info('save version=%d, migrations=%d', this.version, this.migrations.size)
  }

  /** 载入 config.migrations 声明的迁移模块（导出 (record) => record） */
  async loadMigrations() {
    if (this.loaded) return
    this.loaded = true
    const table = this.config.migrations ?? {}
    const root = fileURLToPath(this.ctx.root.baseUrl)
    for (const [version, path] of Object.entries(table)) {
      try {
        const mod = await import(pathToFileURL(resolve(root, path)).href)
        const fn = mod.default ?? mod.migrate
        if (typeof fn !== 'function') throw new Error(`未导出迁移函数: ${path}`)
        this.migrations.set(Number(version), fn)
      } catch (error) {
        this.ctx.logger('save-migrate').warn('迁移 %s 载入失败: %s', version, error.message)
      }
    }
  }

  /** 归档版本（写入存档时用） */
  stamp(record) {
    return { ...record, version: this.version }
  }

  /**
   * 把存档升级到当前版本
   * @param {object} record 存档记录
   * @returns {{ record: object, from: number, to: number, steps: number[] }}
   */
  migrate(record) {
    const from = Number(record?.version ?? 1)
    let current = { ...record }
    const steps = []
    const versions = [...this.migrations.keys()].sort((a, b) => a - b)
    for (const v of versions) {
      if (v <= from) continue
      const before = current
      try {
        current = this.migrations.get(v)(current) ?? current
      } catch (error) {
        this.ctx.logger('save-migrate').warn('迁移到 v%d 失败: %s（保留迁移前状态）', v, error.message)
        current = before
        break
      }
      steps.push(v)
      current.version = v
    }
    if (current.version !== this.version) current.version = this.version
    return { record: current, from, to: current.version, steps }
  }

  /** 是否需要迁移（诊断/测试用） */
  needsMigration(record) {
    return Number(record?.version ?? 1) < this.version
  }
}

export default SaveMigrateService
