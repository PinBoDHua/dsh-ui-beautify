/**
 * 界面美化 · Lumina —— 可读性契约。
 *
 * 这个模块是「本插件产出的配色必须读得出来」这件事的**唯一真相来源**：
 * 哪些前景压在哪些背景上、各自最低对比度是多少、宿主自身的取值是什么。
 * `presets.js` 用它求解颜色，`scripts/check.mjs` 用它做全组合断言，
 * 运行时测试用它验真正投射出去的那一层令牌，设置面板用它显示读数，
 * 验证台用它渲染对比度矩阵。
 *
 * ## 为什么值得单独一个模块
 * v1.1 的对比度是「调完色之后用眼睛看」的。眼睛看不到的地方就漏了 ——
 * 实测漏掉的是四处，见 CHANGELOG 1.2.0。把配对与阈值抽出来之后，
 * 「有没有达标」变成一个可以在构建期回答的问题。
 *
 * ## 为什么契约写成令牌名，而不是预设表里的中间变量
 * 契约要能直接跑在**真正交给宿主的那一刻**（令牌层对象）上。跑在最终产物上，
 * 才能抓到「某个令牌忘了覆盖、于是沿用宿主取值」这类缺陷。
 *
 * ## `fallback` 是什么，为什么必须有
 * 插件**有意不覆盖**一部分令牌 —— 例如 `--dsw-alias-label-primary-foreground`
 * 被主按钮文字、开关滑块、StateDot 的勾共用，覆盖它会连带改掉宿主已有的语义，
 * 收益为零而风险不小。插件改为让**强调色**去满足「压在上面的文字读得出来」，
 * 这才是正确的责任划分。
 *
 * 但这意味着评估时拿不到层里的值。`fallback` 就是宿主官方基准的取值，
 * 让契约仍然能算出一个真实的比值。它是**声明**，不是猜测：
 * `scripts/check.mjs` 有一条断言把 fallback 与宿主基准表逐条比对，
 * 宿主哪天真改了这些值，构建期就会失败并要求更新这张表。
 *
 * ## `missing` 为什么单独算一类
 * 令牌既不在层里、也没有 fallback，意味着这个颜色完全不由插件决定。
 * 它与「对比度不够」是两件事，混在一起会让结论失真，因此单独报出来。
 */

import { contrast, composite, tint } from './color.js'

/** WCAG AA：正文文字。 */
export const AA = 4.5

/** WCAG 1.4.11：非文字（图标、边框、控件状态）。 */
export const NON_TEXT = 3

/**
 * 中性文字阶梯的目标对比度。
 *
 * 这不是从官方照抄的一组比值，而是**分级底线**：
 *   · primary   12  —— 正文主力。官方 17–19；取 12 仍远高于 AAA 的 7。
 *   · dimmed     9  —— 次级正文，仍需一眼可读。
 *   · secondary 5.5 —— 官方 5.8，取略低于官方以免把层级压平。
 *   · tertiary  4.5 —— 12–13px 的提示文字属正文，按 AA 要求。
 *                      官方浅色只有 3.71（本身就不达标），插件补上。
 *   · caption    3  —— **刻意低于 AA 的一档**，取非文字档。
 *   · icon       3  —— 图标与字形，按非文字档。
 *
 * `caption` 这一档要说清楚，因为它是一个**有意识的例外**，不是「大字号档」：
 * 宿主把它用在 12 处，其中 11 处是分隔线、描边、装饰；唯一真正的文字消费者是
 * `Menu.module.css` 的 11px/600 分组标签 —— 11px 不属于 WCAG 的大字号
 * （大字号的线是 24px 常规或 18.66px 粗体），按 AA 应到 4.5。
 *
 * 那我们为什么仍然取 3：
 *   1. 把 caption 提到 4.5 就与 tertiary 齐平，「说明文字」这一档随之消失，
 *      而它承担着真实的信息分层（例如任务列表的已完成态）；
 *   2. 官方这一档是 2.13 —— 连 3 都不到，插件已经把它抬到 3.49–3.60；
 *   3. 它是一个 11px 的分组标签，而不是要读的正文。
 *
 * 这是本版唯一一处「已知低于 AA 且不打算修」的地方，因此写在这里而不是藏起来 ——
 * 面板读数与 README 也据此只统计正文级（阈值 ≥AA）的配对，
 * 不会让这一档拉低「全部达标」的可信度。
 *
 * 阶梯必须严格递减：越靠后的层级越淡，否则「层级」这个词就没有意义。
 * `scripts/check.mjs` 有一条断言把这件事钉住。
 */
export const TEXT_TIERS = Object.freeze({
  primary: 12,
  dimmed: 9,
  secondary: 5.5,
  tertiary: 4.5,
  caption: 3,
  icon: 3
})

/** 文字与强调色可能压在其上的表面。只对画布求解不够 —— 同一段文字也会落在卡片与代码块上。 */
export const SURFACE_KEYS = Object.freeze([
  'canvas',
  'surface1',
  'surface2',
  'surface3',
  'code',
  'codeBanner',
  'inlineCode',
  'module',
  'sidebar'
])

/** 从预设的中性色块里取出全部表面色。 */
export function surfaceColors(neutral) {
  return SURFACE_KEYS.map((key) => neutral[key]).filter(
    (value) => typeof value === 'string' && value.length > 0
  )
}

/** 宿主 shiki 主题的 9 个语法 token（`--shiki-*`），顺序与 shiki.css 一致。 */
export const SYNTAX_TOKENS = Object.freeze([
  'constant',
  'string',
  'comment',
  'keyword',
  'parameter',
  'function',
  'string-expression',
  'punctuation',
  'link'
])

/**
 * 插件**有意不覆盖**、契约却要评估的宿主令牌，取官方基准值。
 *
 * 每条都注明了出处与「为什么不覆盖」。宿主升级后由 check.mjs 的断言提示复核。
 */
export const HOST_FALLBACK = Object.freeze({
  // 主按钮文字 / 开关滑块 / StateDot 勾选共用；官方 = 纯白（浅色）/ 近黑（深色）。
  // 插件改为让强调色足够深（浅色）或足够亮（深色）来满足它，而不动这个令牌。
  '--dsw-alias-label-primary-foreground': Object.freeze({ light: '#ffffff', dark: '#0f1115' }),
  // 灯箱关闭按钮等「浮在照片上」的控件用；官方 = 半透明深色。
  '--dsw-alias-button-contrast-fill': Object.freeze({ light: '#54555780', dark: '#54555780' })
})

/** 宿主代码着色（`theme/shiki.css`）—— 插件**现在**接管它，因此不再是 fallback。 */

/**
 * 契约条目。
 *
 * `fg` / `bg` 可以是令牌名（`--` 开头），也可以是字面色（`#` 开头）——
 * 宿主的提示气泡文字是写死的 `--dsw-static-neutral-bluish-00`（纯白），
 * 插件既不能也不该改它，只能保证气泡底色够深。
 *
 * `kind` 区分文字与非文字：两者阈值不同，混在一起会让 3:1 的图标被当成
 * 不达标的文字，或者反过来放过真正读不清的正文。
 *
 * 数组在**装配完成后**才冻结：语法着色那 9 条由下面的循环按 `SYNTAX_TOKENS`
 * 生成，避免把同一件事手抄九遍。
 */
const PAIR_LIST = [
  // ---- 强调色当底，文字压在其上 ----
  { id: 'button-primary', label: '主按钮文字', fg: '--dsw-alias-label-primary-foreground', bg: '--dsw-alias-button-primary-fill', min: AA, kind: 'text' },
  { id: 'button-primary-hover', label: '主按钮悬停文字', fg: '--dsw-alias-label-primary-foreground', bg: '--dsw-alias-button-primary-hover', min: AA, kind: 'text' },
  { id: 'button-info', label: '信息按钮文字', fg: '--dsw-alias-label-primary-foreground', bg: '--dsw-alias-button-info-fill', min: AA, kind: 'text' },
  { id: 'switch-on-thumb', label: '开关滑块（开）', fg: '--dsw-alias-label-primary-foreground', bg: '--dsw-alias-brand-primary', min: NON_TEXT, kind: 'non-text' },
  { id: 'ghost-active-text', label: '幽灵激活态文字', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-button-ghost-active-fill', min: AA, kind: 'text' },
  // 宿主把侧栏选中项的强调色令牌当**徽标底色**用（ui-user-questions 的 .badge：
  // background = 该令牌，color = button-info-fill）。因此它的语义是「浅染层」而
  // 不是「强调色本体」—— 这一条断言的就是那对真实的前景/背景。
  { id: 'nav-badge', label: '侧栏徽标文字', fg: '--dsw-alias-button-info-fill', bg: '--dsw-specific-sidebar-nav-item-active-accent', min: AA, kind: 'text' },

  // ---- 强调色当文字，压在「自己的浅染层」上 ----
  // Tag 的 info 语气（ui-primitives）与设置里的更新指示（ui-settings-general）
  // 都是这个形状：`background: color-mix(accent 10%, transparent); color: accent`。
  // 浅染层由强调色自己派生，所以它是一处**自指**约束 —— 见 buildTokens 里的迭代求解。
  { id: 'tag-info', label: 'Tag info 语气', fg: '--dsw-alias-state-business-primary', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text', tintOf: '--dsw-alias-state-business-primary', tintAmount: 0.1 },

  // ---- 强调色当文字 ----
  { id: 'link-canvas', label: '链接 on 画布', fg: '--dsw-alias-link', bg: '--dsw-alias-bg-base', min: AA, kind: 'text' },
  { id: 'link-surface', label: '链接 on 表面', fg: '--dsw-alias-link', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text' },
  { id: 'link-code', label: '链接 on 代码块', fg: '--dsw-alias-link', bg: '--dsw-alias-markdown-code-block', min: AA, kind: 'text' },
  { id: 'brand-text', label: '品牌文字 on 表面', fg: '--dsw-alias-brand-text', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text' },
  { id: 'business-tertiary', label: '业务强调 on 业务浅底', fg: '--dsw-alias-state-business-primary', bg: '--dsw-alias-state-business-tertiary', min: AA, kind: 'text' },
  { id: 'focus-ring', label: '焦点环 on 画布', fg: '--dsw-focus-ring-color', bg: '--dsw-alias-bg-base', min: NON_TEXT, kind: 'non-text' },
  // 注意：`--dsw-specific-sidebar-nav-item-active-accent` **不是**文字色。
  // 全应用唯一的消费者是 ui-user-questions 的 `.badge`，把它当**底色**用
  // （`background: 该令牌; color: var(--dsw-alias-button-info-fill)`）。
  // 因此它出现在下面的 `nav-badge` 条目的 `bg` 一侧，而不是这一侧。v1.1 正是
  // 把它误当成文字色写成完整强调色，才导致徽标同色压同色（对比度 1.00）。

  // ---- 中性文字阶梯 ----
  { id: 'text-primary', label: '主文字 on 表面', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-bg-layer-1', min: TEXT_TIERS.primary, kind: 'text' },
  { id: 'text-primary-canvas', label: '主文字 on 画布', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-bg-base', min: TEXT_TIERS.primary, kind: 'text' },
  { id: 'text-secondary', label: '次级文字 on 表面', fg: '--dsw-alias-label-secondary', bg: '--dsw-alias-bg-layer-1', min: TEXT_TIERS.secondary, kind: 'text' },
  { id: 'text-tertiary', label: '三级文字 on 表面', fg: '--dsw-alias-label-tertiary', bg: '--dsw-alias-bg-layer-1', min: TEXT_TIERS.tertiary, kind: 'text' },
  { id: 'text-tertiary-code', label: '三级文字 on 代码块', fg: '--dsw-alias-label-tertiary', bg: '--dsw-alias-markdown-code-block', min: TEXT_TIERS.tertiary, kind: 'text' },
  { id: 'text-caption', label: '说明文字 on 表面', fg: '--dsw-alias-label-caption', bg: '--dsw-alias-bg-layer-1', min: TEXT_TIERS.caption, kind: 'text' },
  { id: 'menu-icon', label: '菜单图标 on 菜单材质', fg: '--dsw-alias-menu-icon', bg: '--dsw-menu-surface-fill', min: NON_TEXT, kind: 'non-text' },

  // ---- 侧栏与气泡 ----
  { id: 'sidebar-active', label: '侧栏选中项文字', fg: '--dsw-alias-label-primary', bg: '--dsw-specific-sidebar-nav-item-active', min: AA, kind: 'text' },
  { id: 'sidebar-base', label: '主文字 on 侧栏', fg: '--dsw-alias-label-primary', bg: '--dsw-specific-sidebar-fill', min: TEXT_TIERS.primary, kind: 'text' },
  { id: 'bubble-text', label: '气泡文字 on 气泡底', fg: '--dsw-alias-label-primary', bg: '--dsw-specific-bubble', min: AA, kind: 'text' },

  // ---- 代码 ----
  { id: 'code-text', label: '代码正文 on 代码块', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-markdown-code-block', min: AA, kind: 'text' },
  { id: 'code-banner-text', label: '代码信息条文字', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-markdown-code-block-banner', min: AA, kind: 'text' },
  { id: 'inline-code-text', label: '行内代码文字', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-markdown-inline-code', min: AA, kind: 'text' },
  { id: 'code-selected-text', label: '代码分段选中文字', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-markdown-code-segment-selected', min: AA, kind: 'text' },

  // ---- 提示：气泡文字是宿主写死的纯白（static-bluish-00），插件只负责让底够深 ----
  { id: 'tooltip-text', label: '提示气泡文字', fg: '#ffffff', bg: '--dsw-alias-tooltip-bg', min: AA, kind: 'text' },
  { id: 'tooltip-key-text', label: '提示快捷键文字', fg: '#ffffff', bg: '--dsw-alias-tooltip-key-bg', min: AA, kind: 'text' },
  // 键帽底板与气泡底的可分辨度。官方是 2.00（浅色）/ 1.82（深色）。阈值原本写 1.3，
  // 那等于没有约束（实测从未低于 1.7，不可能独立失败）；收紧到官方水平后才发现
  // v1.1 的 18% 白混其实只有 1.75 —— **比官方还难分辨**。
  { id: 'tooltip-key-legibility', label: '快捷键底板 vs 气泡底', fg: '--dsw-alias-tooltip-key-bg', bg: '--dsw-alias-tooltip-bg', min: 2, kind: 'non-text' },
  { id: 'toast-text', label: '轻提示文字', fg: '--dsw-alias-toast-label', bg: '--dsw-alias-toast-bg', min: AA, kind: 'text' },

  // ---- 输入框占位文字 ----
  // 宿主的唯一消费者是 `Input.module.css` 的
  // `.input::placeholder { color: var(--dsw-alias-label-dimmed) }`，字号 14px ——
  // 这是**正文**，不是装饰。而 v1.1 把这个令牌直接绑到描边色上
  // （浅色 = border4、深色 = border3），实测在输入框底色上只有 1.48–2.00:1，
  // 连 3:1 都不到 —— 占位文字在每种组合里都近乎看不见。
  // 这条配对是 v1.2 发布前独立复核时发现并补上的：它属于「令牌忘了被求解」
  // 那一类，也正是这份契约存在的理由。
  { id: 'input-placeholder', label: '输入框占位文字', fg: '--dsw-alias-label-dimmed', bg: '--dsw-specific-input-major', min: AA, kind: 'text' },

  // ---- 选区 ----
  { id: 'selection-text', label: '选区上的正文', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-bg-document-selection', min: AA, kind: 'text' }
]

/** 语法 token 的契约条目按 token 列表生成，避免手抄九遍。 */
for (const name of SYNTAX_TOKENS) {
  PAIR_LIST.push({
    id: `syntax-${name}`,
    label: `语法着色 · ${name}`,
    fg: `--shiki-token-${name}`,
    bg: '--dsw-alias-markdown-code-block',
    min: AA,
    kind: 'text'
  })
}

/** 冻结后的契约条目 —— 消费方只读，顺序即文档顺序。 */
export const PAIRS = Object.freeze(PAIR_LIST.map((pair) => Object.freeze(pair)))

/**
 * 读取层里某个取值。
 *
 * @param tokens - 令牌层。
 * @param ref - 令牌名（`--` 开头）或字面色（`#` 开头）。
 * @param mode - `'light' | 'dark'`。
 * @returns 取值字符串，取不到时返回 null。
 */
function readRef(tokens, ref, mode) {
  if (ref.startsWith('#')) return ref
  const entry = tokens[ref]
  if (entry !== null && typeof entry === 'object') {
    const value = entry[mode]
    if (typeof value === 'string' && value.trim() !== '') return value
    return HOST_FALLBACK[ref]?.[mode] ?? null
  }
  return HOST_FALLBACK[ref]?.[mode] ?? null
}

/**
 * 把一条契约条目解析成一对实色 `{ fg, bg }`。
 *
 * 支持 `tintOf`：背景不是某个令牌，而是**前景色自己的浅染层**
 * （`color-mix(in srgb, accent N%, transparent)` 压在 `bg` 上）。
 * 宿主有两处正是这个形状：
 *   · ui-primitives 的 Tag info 语气：`background: color-mix(accent 10%)` + `color: accent`
 *   · ui-settings-general 的更新指示：`background: color-mix(accent 8%)` + `color: accent`
 * 字压在自己的淡染层上，因此这是一处**自指**约束 —— 求解时必须一起考虑，
 * 否则强调色刚好落在「淡染后与自身几乎同色」的区间里（v1.1 就是这样）。
 *
 * @returns `{ fg, bg }` 实色；任一侧取不到时返回 null。
 */
function resolvePair(tokens, pair, mode, canvas) {
  const rawFg = readRef(tokens, pair.fg, mode)
  if (rawFg === null) return null
  if (pair.tintOf !== undefined) {
    const accent = readRef(tokens, pair.tintOf, mode)
    const base = readRef(tokens, pair.bg, mode)
    if (accent === null || base === null) return null
    // 淡染层自己也可能带 alpha，先落到画布上再合成前景。
    const surface = composite(base, canvas)
    return { fg: composite(rawFg, surface), bg: tint(surface, accent, pair.tintAmount) }
  }
  const rawBg = readRef(tokens, pair.bg, mode)
  if (rawBg === null) return null
  // 半透明的一方先合成到「它实际压在什么上」再算：直接拿 alpha 值算会高估。
  const bg = composite(rawBg, canvas)
  return { fg: composite(rawFg, bg), bg }
}

/**
 * 评估一份令牌层在一个明暗下的可读性。
 *
 * @param tokens - `buildTokens()` 的输出，或控制器**真正投射出去**的那一份。
 * @param mode - `'light' | 'dark'`。
 * @returns `{ checks, failures, missing, worst }`：
 *   · `checks` 每条含 `ratio` / `ok`，可直接用于展示；
 *   · `failures` 是「两边都有取值、但对比度不够」；
 *   · `missing` 是「完全不由插件决定」。
 */
export function evaluate(tokens, mode) {
  // 画布是所有半透明底色的最终落点：气泡、选中底、菜单材质、选区、淡染层都压在它上面。
  const canvas = readRef(tokens, '--dsw-alias-bg-base', mode) ?? '#ffffff'
  const checks = []
  const failures = []
  const missing = []

  for (const pair of PAIRS) {
    const resolved = resolvePair(tokens, pair, mode, canvas)
    if (resolved === null) {
      const absent = readRef(tokens, pair.fg, mode) === null ? pair.fg : pair.bg
      const entry = { ...pair, ratio: null, ok: false, absent }
      checks.push(entry)
      missing.push(entry)
      continue
    }
    const ratio = contrast(resolved.fg, resolved.bg)
    const entry = {
      ...pair,
      ratio,
      ok: ratio >= pair.min,
      fgValue: resolved.fg,
      bgValue: resolved.bg
    }
    checks.push(entry)
    if (!entry.ok) failures.push(entry)
  }

  const scored = checks.filter((entry) => entry.ratio !== null)
  const worst = scored.length
    ? scored.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low))
    : null
  // 「最差的一项」直接拿来当读数会有两个问题：装饰性底板（快捷键键帽 1.3、
  // 滑块 3）本来就允许更低；说明文字那一档的分级底线也是 3 而不是 4.5。
  // 两者都会让读数看起来比实际糟糕（实测会显示成 1.8:1 与 3.5:1）。
  // 因此另给一个**正文级**最劣项 —— 只统计阈值 ≥AA 的文字配对，也就是用户
  // 真正在读的那些；面板读数与文档摘要都用它，完整的逐项细节仍在 `checks` 里。
  const body = scored.filter((entry) => entry.kind === 'text' && entry.min >= AA)
  const worstBody = body.length
    ? body.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low))
    : null
  return { checks, failures, missing, worst, worstBody }
}

/** 两个明暗一起评估。面板读数、文档摘要与验证台矩阵都用它。 */
export function evaluateBoth(tokens) {
  const light = evaluate(tokens, 'light')
  const dark = evaluate(tokens, 'dark')
  const scored = [...light.checks, ...dark.checks].filter((e) => e.ratio !== null)
  const worst = scored.length
    ? scored.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low))
    : null
  const body = scored.filter((entry) => entry.kind === 'text' && entry.min >= AA)
  const worstBody = body.length
    ? body.reduce((low, entry) => (entry.ratio < low.ratio ? entry : low))
    : null
  return {
    light,
    dark,
    worst,
    worstBody,
    failures: [...light.failures, ...dark.failures],
    missing: [...light.missing, ...dark.missing],
    total: scored.length
  }
}
