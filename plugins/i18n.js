// 本地化插件（骨架）—— 文本 ID → 字符串表
//
// 业界惯例（Ink 用 #tag、Yarn 用 CSV 字符串表）：正文里写稳定 ID，显示时按
// 当前 locale 查表。这样翻译不改内容包结构，改文案也不动逻辑。
//
// 本插件是**可渐进启用的骨架**，不破坏既有内容：
//   - 识别 `@KEY@` 形式的引用（如 `@starter.start.title@`），命中则替换为本地化文本；
//   - 未命中则原样保留（内容里直接写中文、不写 ID 的老内容完全不受影响）；
//   - locale 优先级：state.locale > 环境变量 DSE_LOCALE > cordis.yml defaultLocale。
//
// 想全面本地化时，把内容包的 title/text 换成 `@key@`，再往 config.locales
// 填表即可；不想用时保持空表，引擎行为与没有本插件时一致。
//
// 命令：`lang` 查看/切换语言（lang / lang en-US）。

import { Service } from 'cordis'

export const name = 'i18n'

/** `@key@` 引用：key 允许字母数字、点、下划线、连字符 */
const KEY_PATTERN = /@([A-Za-z0-9_.-]+)@/g

export class I18nService extends Service {
  static inject = ['state']

  constructor(ctx, config) {
    super(ctx, 'i18n')
    this.config = config
    this.tables = config.locales ?? {}
    this.defaultLocale = config.defaultLocale ?? 'zh-CN'
    /** 未命中的 key 计数（诊断用：填表遗漏一眼可见） */
    this.misses = new Set()
  }

  [Service.init]() {
    // 文本渲染管道的最内层：引擎插值之后、其他装饰之前替换
    this.ctx.on('text/render', (text) => this.translate(text))
    this.ctx.on('engine/command', (line, choices, next) => this.handle(line, next))
    const locale = this.locale()
    this.ctx.logger('i18n').info('locale=%s, tables=%d', locale, Object.keys(this.tables).length)
  }

  /** 当前语言：state.locale > DSE_LOCALE > 配置默认 */
  locale() {
    return this.ctx.state?.get?.('locale') || process.env.DSE_LOCALE || this.defaultLocale
  }

  /** 查表：key → 文本；未命中返回 null（调用方决定回退） */
  lookup(key, locale = this.locale()) {
    const table = this.tables[locale]
    if (table && key in table) return table[key]
    // 回退到默认语言，避免翻译缺失导致页面出现空串
    const fallback = this.tables[this.defaultLocale]
    if (fallback && key in fallback) return fallback[key]
    return null
  }

  /** 翻译一段文本：把其中的 @key@ 替换为本地化文本，未命中保持原样 */
  translate(text) {
    if (typeof text !== 'string' || !text.includes('@')) return text
    return text.replace(KEY_PATTERN, (raw, key) => {
      const value = this.lookup(key)
      if (value === null) {
        this.misses.add(key)
        return raw
      }
      return String(value)
    })
  }

  /** `lang [<locale>]`：查看或切换语言 */
  handle(line, next) {
    const [cmd, arg] = String(line ?? '').trim().split(/\s+/)
    if (cmd?.toLowerCase() !== 'lang' && cmd !== '语言') return next()
    if (!arg) {
      this.ctx.io.print(`  当前语言: ${this.locale()}（可用: ${Object.keys(this.tables).join(', ') || '（未配置）'}）`)
      return { type: 'rerender' }
    }
    if (!this.tables[arg]) {
      this.ctx.io.print(`  没有语言包 "${arg}"（可用: ${Object.keys(this.tables).join(', ') || '（未配置）'}）`)
      return { type: 'rerender' }
    }
    this.ctx.state.set('locale', arg)
    this.ctx.io.print(`  已切换到 ${arg}`)
    return { type: 'rerender' }
  }

  /** 未命中清单（供 lint / 测试断言填表完整性） */
  missing() {
    return [...this.misses]
  }
}

export default I18nService
