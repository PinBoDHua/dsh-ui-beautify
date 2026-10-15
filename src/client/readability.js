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

/** WCAG AAA：正文文字。瞬态底（悬停 / 按下）上的主文字退到这条线，见 `hover-primary`。 */
export const AAA = 7

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
 *
 * ## 这些取值不是手抄的
 * v1.2 的注释写着「check.mjs 有一条断言把 fallback 与宿主基准表逐条比对」——
 * **那句话是假的**：当时的 `reference/host-tokens.json` 只记名字、不记取值，
 * 断言也只校验了「名字在表里」。于是 `--dsw-alias-button-contrast-fill` 一路写着
 * `#54555780`（那是 `button-tool-bar-fill` 的值），而宿主的真实取值是
 * `#61666b`（浅色）/ `#f9fafb`（深色）—— 一条既没被任何配对引用、取值又是错的声明。
 *
 * v1.3 补上了缺的那一半：`scripts/audit-consumers.mjs` 现在把宿主**声明过的取值**
 * 一并索引进 `reference/host-consumers.json`，check.mjs 把下面这张表与它逐条比对
 * （含一层 `var()` 解析）。这张表现在真的是一份可被机器核对的声明。
 */
export const HOST_FALLBACK = Object.freeze({
  // 主按钮文字 / 开关滑块 / StateDot 勾选共用；官方 = 纯白（浅色）/ 近黑（深色）。
  // 插件改为让强调色足够深（浅色）或足够亮（深色）来满足它，而不动这个令牌。
  '--dsw-alias-label-primary-foreground': Object.freeze({ light: '#ffffff', dark: '#0f1115' }),
  // 图片缩略图右上角那个「移除」小圆钮的底色（`AttachmentPreview` 系列的内联样式）。
  // 官方浅色 bluish-700 = #61666b、深色 bluish-50 = #f9fafb；压在上面的字是
  // label-primary-inverted。这一条在 v1.2 里取值写错且无人引用，v1.3 修好并接上配对。
  '--dsw-alias-button-contrast-fill': Object.freeze({ light: '#61666b', dark: '#f9fafb' })
})

/**
 * 宿主**从未声明**、却真的在被消费的令牌 —— 插件把它们补上。
 *
 * 与 `HOST_FALLBACK` 正好相反：那里是「宿主声明了、插件不覆盖」，这里是
 * 「宿主没声明、插件必须补」。两者都是**声明**，都必须能被机器复核：
 *
 *   · `HOST_FALLBACK` 的取值由 `reference/host-consumers.json` 里宿主**声明过的
 *     取值**逐条比对（v1.2 只在注释里声称比对了，其实比不了）；
 *   · 这张表里的令牌必须真的「有消费者、零声明」—— 索引说它被声明过，
 *     这里就该删掉；索引里根本没有它的消费者，说明这条补丁是多余的。
 *
 * ## 缺失的后果为什么值得单独一类
 * 自定义属性没有「默认值」这一说：`color: var(--dsw-alias-label-error)` 在
 * 计算值阶段变成 guaranteed-invalid，于是 `color` 按 `unset` 处理 ——
 * 对可继承属性就是**继承**。屏幕上不会报错，只会有一行本该是红色的提示
 * 和普通文字长得一模一样。这与 v1.0 修的「点 ✕ 关掉程序」同属一类：
 * 宿主漏了一格，用户承担后果。
 */
export const HOST_GAPS = Object.freeze({
  '--dsw-alias-label-error': Object.freeze({
    reason:
      '设置表单的保存失败提示（`settings-form__SettingsForm.module.css` 的 `.failed`）' +
      '以及编译产物里的 `._failed_ft7vz_23` 都写着 `color: var(--dsw-alias-label-error)`，' +
      '而这个令牌在宿主的任何一处都没有声明 —— 提示文字因此继承正文墨色，' +
      '「保存失败」在视觉上与普通说明没有区别。'
  }),
  '--dsw-alias-bg-layer-4': Object.freeze({
    reason:
      '表面阶梯的第四级。`settings-form__fields.module.css` 的帮助按钮写着' +
      '`.helpButton:hover { background: var(--dsw-alias-bg-layer-4) }`，' +
      '而宿主只声明到第三级 —— 悬停底色落到 initial（transparent），' +
      '那个「?」按钮于是没有任何悬停反馈。'
  })
})

/**
 * 插件**有意不覆盖**、宿主确实当文字色消费的令牌。
 *
 * 与 `UNCOVERED` 的分工：`UNCOVERED` 是「覆盖了但不做断言」，
 * 这里是「压根不覆盖，理由如下」。两者都会在 check.mjs 里被核对，
 * 因此不会退化成一堆没人读的注释。
 */
export const DELIBERATE = Object.freeze({
  '--dsw-alias-state-idle-primary': Object.freeze({
    reason:
      '宿主唯一的消费者是 StateDot 的 `[data-state=idle]`：一个 6px 的「空闲」状态点，' +
      '官方浅色只有 1.5:1 —— 那是**有意的弱化**，让待处理事项退到背景里。' +
      '语义色的另外三支（成功 / 警告 / 危险）都被插件接管了，唯独这一支保持原样：' +
      '把它抬到非文字档的 3:1，会让「待处理」比「进行中」还显眼，' +
      '正好拆掉插件自己在任务列表里搭的三态阶梯。'
  })
})

/**
 * 插件覆盖了、宿主也确实当文字色消费，但**有意不纳入契约**的令牌。
 *
 * 这是 v1.3 新增的一类声明，与 `HOST_FALLBACK` 正好相反：那里是「不覆盖但要评估」，
 * 这里是「覆盖了但不评估」。它存在的理由是 v1.2 自己写下的那句教训 ——
 * **断言的覆盖面本身才是最容易被忽略的东西**。有了宿主消费点索引之后，
 * 「某个被覆盖的令牌被当文字用、却不在契约里」成为一条可枚举的事实；
 * 而这条事实必须被**处理**：要么补进契约，要么在这里写明为什么不用。
 *
 * 漏写会被 check.mjs 挡住，所以这张表不会随时间漂移成一份过时清单。
 * 每条都必须给出 `reason`，断言还会校验这些令牌**真的**被覆盖、
 * **真的**没进契约、**真的**有文字消费者 —— 否则它又变成一段没人读的注释。
 */
export const UNCOVERED = Object.freeze({
  '--dsw-alias-border-l4': Object.freeze({
    reason:
      '宿主的 `color: var(--dsw-alias-border-l4)` 出现在 `.cardWorkspaceTrigger:after`，' +
      '而那条规则里同时写着 `border: 1px dashed`（不带颜色）—— 它借 currentColor 给' +
      '虚线边框上色，不是文字。它本来就是描边档，而插件这一档比官方更强' +
      '（浅色 20% 不透明度 vs 官方 16%），不存在变差。'
  })
})

/** 宿主代码着色（`theme/shiki.css`）—— 插件**现在**接管它，因此不再是 fallback。 */

/**
 * 一个令牌被两个方向相反的角色同时占用、**无法用一支颜色同时满足**的配对。
 *
 * ## 为什么需要这一类，而不是「悄悄不写这条配对」
 * v1.2 的教训是「一条永远不可能失败的断言，和没有断言是一回事」。
 * 它的对偶同样成立：**一条被悄悄省掉的配对，和「这里没问题」是一回事** ——
 * 下一个人读契约时，看到的是「该覆盖的都覆盖了」。
 *
 * 因此省掉的部分必须写下来，而且**「为什么省掉」本身要能被机器复核**：
 * `scripts/check.mjs` 会断言 `sharp` 与 `soft` 两个落点分处明暗两侧 ——
 * 也就是求解器无论如何都会给出 `null`（它的方向逻辑只支持「全部变暗」或
 * 「全部变亮」）。哪天有人把轻提示的底改成浅色，那条断言会立刻失败并说
 * 「这个矛盾已经不成立了，请把配对写回契约」。
 *
 * ## 这一条的具体内容
 * `--dsw-alias-state-success-primary`（以及 `-warn-label`）在浅色主题下被用在两处，
 * 而两处的方向相反：
 *
 *   1. **浅色表面上的正文** —— Tag 的成功/警告语气、差异视图的新增/删除行。
 *      白底要求它够**深**（相对亮度 ≤0.165）。
 *   2. **轻提示上的状态图标** —— 宿主的提示底在**两种主题里都是深色**
 *      （`Toast.module.css` 自己写了这句话：「The design platform's toast surface
 *      is dark in BOTH themes」）。深底要求它够**亮**（≥0.153）。
 *
 * 两个窗口几乎不重叠，而且第一个窗口的上界还随「淡染层由自己派生」这条自指约束
 * 一起往下压 —— 可行的明度带被压到千分之几，且纸感的底一暖就直接为负。
 * 这不是「色没调好」，是**一个令牌承担不了两个相反的角色**。
 *
 * 插件的取舍按「信息量」下：Tag 与差异行是**正文**（4.5 是硬线，出现频率也高得多），
 * 轻提示的图标是**冗余的状态字形**（同一行的文字已经说明了结果，按 1.4.11 只需 3:1）。
 * 因此解向角色 1；角色 2 在浅色下记为已知取舍，在深色下**照常进契约**
 * （那里的底比表面更暗得有限，两个要求同向，可以同时满足）。
 */
export const INFEASIBLE = Object.freeze([
  Object.freeze({
    id: 'toast-success-icon',
    label: '轻提示 · 成功图标（浅色）',
    fg: '--dsw-alias-state-success-primary',
    mode: 'light',
    sharp: Object.freeze({ against: '--dsw-alias-bg-layer-1', target: AA }),
    soft: Object.freeze({ against: '--dsw-alias-toast-bg', target: NON_TEXT })
  }),
  Object.freeze({
    id: 'toast-warn-icon',
    label: '轻提示 · 警告图标（浅色）',
    fg: '--dsw-alias-state-warn-label',
    mode: 'light',
    sharp: Object.freeze({ against: '--dsw-alias-bg-layer-1', target: AA }),
    soft: Object.freeze({ against: '--dsw-alias-toast-bg', target: NON_TEXT })
  })
])

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
  { id: 'selection-text', label: '选区上的正文', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-bg-document-selection', min: AA, kind: 'text' },

  // ================================================================
  // v1.3：语义色（成功 / 警告 / 危险）与差异视图
  //
  // 这一族是 v1.2 最大的遗漏，而且漏得很有说服力：Tag 的 **info** 语气
  // （`color-mix(business-primary 10%)` + `color: business-primary`）在 v1.2 里
  // 被认真求解过，而同一张样式表里、**隔三行的兄弟规则** ——
  // success 10%、warning 12%、danger 10%，形状一模一样 —— 一条都没被算。
  // 于是「通过」徽标在浅色下只有 2.06:1、「+ 新增行」的正文只有 1.91:1。
  //
  // 这三条配对的形状与 `tag-info` 完全一致（自指淡染层），阈值也一样，
  // 差别只在于它们压的是宿主的语义色而不是强调色。
  // ================================================================
  { id: 'tag-success', label: 'Tag success 语气', fg: '--dsw-alias-state-success-primary', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text', tintOf: '--dsw-alias-state-success-primary', tintAmount: 0.1 },
  { id: 'tag-warn', label: 'Tag warning 语气', fg: '--dsw-alias-state-warn-primary', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text', tintOf: '--dsw-alias-state-warn-primary', tintAmount: 0.12 },
  { id: 'tag-error', label: 'Tag danger 语气', fg: '--dsw-alias-state-error-primary', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text', tintOf: '--dsw-alias-state-error-primary', tintAmount: 0.1 },

  // ConnectionIndicator：`.success / .warning` 都是「淡底 + 同色文字」，
  // 底色由 tertiary 承担（插件把它派生成语义色在表面上的淡染层）。
  { id: 'conn-success', label: '连接指示 · 成功', fg: '--dsw-alias-state-success-primary', bg: '--dsw-alias-state-success-tertiary', min: AA, kind: 'text' },
  { id: 'conn-warn', label: '连接指示 · 警告', fg: '--dsw-alias-state-warn-label', bg: '--dsw-alias-state-warn-tertiary', min: AA, kind: 'text' },
  // 悬停态是「往淡底里再掺 6% 语义色」—— 另一个底，同样要校验。
  { id: 'conn-warn-hover', label: '连接指示 · 警告悬停', fg: '--dsw-alias-state-warn-label', bg: '--dsw-alias-state-warn-tertiary', min: AA, kind: 'text', tintOf: '--dsw-alias-state-warn-primary', tintAmount: 0.06 },

  // Toast 的成功 / 警告图标与文字直接铺语义色，压在插件的轻提示底色上。
  // **只在深色下成立**：浅色下这一对与同一支令牌的「Tag 正文」约束方向相反，
  // 见下面 INFEASIBLE 的说明。`modes` 让这条约束只在自己的可行域里生效 ——
  // 而不是把阈值调低到刚好能过（那是拿断言迁就结论）。
  { id: 'toast-success', label: '轻提示 · 成功', fg: '--dsw-alias-state-success-primary', bg: '--dsw-alias-toast-bg', min: NON_TEXT, kind: 'non-text', modes: ['dark'] },
  { id: 'toast-warn', label: '轻提示 · 警告', fg: '--dsw-alias-state-warn-label', bg: '--dsw-alias-toast-bg', min: NON_TEXT, kind: 'non-text', modes: ['dark'] },

  // 差异视图：`.add / .del` 的正文压在「语义色淡染层」上，而那一层又是**半透明**
  // 的，真正落在代码块底色上。因此 `over` 指明代理解析的落点 ——
  // 少了它，契约会把淡染层合成到画布上，算出一个没人看得见的比值。
  { id: 'diff-added-text', label: '差异 · 新增行正文', fg: '--dsw-alias-state-success-primary', bg: '--dsw-alias-code-diff-added', over: '--dsw-alias-markdown-code-block', min: AA, kind: 'text' },
  { id: 'diff-deleted-text', label: '差异 · 删除行正文', fg: '--dsw-alias-state-error-primary', bg: '--dsw-alias-code-diff-deleted', over: '--dsw-alias-markdown-code-block', min: AA, kind: 'text' },

  // 危险色当**文字**：设置表单的保存失败提示、菜单里的危险项。
  { id: 'error-on-surface', label: '危险文字 on 表面', fg: '--dsw-alias-state-error-primary', bg: '--dsw-alias-bg-layer-2', min: AA, kind: 'text' },
  { id: 'error-on-menu', label: '危险文字 on 菜单材质', fg: '--dsw-alias-state-error-primary', bg: '--dsw-menu-surface-fill', min: AA, kind: 'text' },
  { id: 'error-on-canvas', label: '危险文字 on 画布', fg: '--dsw-alias-state-error-primary', bg: '--dsw-alias-bg-base', min: AA, kind: 'text' },

  // 语义色的「柔和档」也被当文字用（shortcuts / plugin-manager 的内联样式），
  // 因此它同样不能只按装饰处理。
  { id: 'success-secondary', label: '成功（柔和档）on 表面', fg: '--dsw-alias-state-success-secondary', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text' },
  { id: 'warn-secondary', label: '警告（柔和档）on 表面', fg: '--dsw-alias-state-warn-secondary', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text' },

  // 危险色当**底色**：`.brokenBadge` 用它当徽标底，而字是 `bg-layer-3`。
  // 这条是「宿主消费点索引」直接指出来的一对：索引之前，没人知道
  // 语义色还要扛住一支表面色。
  { id: 'error-badge-text', label: '危险徽标文字', fg: '--dsw-alias-bg-layer-3', bg: '--dsw-alias-state-error-primary', min: AA, kind: 'text' },

  // 危险悬停底：菜单项悬停时铺 8% 危险色，正文压在其上。
  { id: 'danger-hover-text', label: '危险悬停底上的正文', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-interactive-bg-hover-danger', over: '--dsw-alias-bg-layer-2', min: AA, kind: 'text' },

  // ================================================================
  // v1.3：覆盖面缺口 —— 插件早就覆盖了、宿主也当文字用，却从没进过契约的令牌
  //
  // 这七条不是「新发现的配色问题」，而是**新发现的断言缺口**：它们由
  // `scripts/audit-consumers.mjs` 从宿主真实样式与 bundle 里枚举出来
  // （见 reference/host-consumers.json）。在此之前，没人知道
  // `--dsw-alias-label-primary-dimmed` 会被当正文用。
  // ================================================================
  { id: 'text-primary-dimmed', label: '次级正文（dimmed）', fg: '--dsw-alias-label-primary-dimmed', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text' },
  { id: 'text-primary-dimmed-canvas', label: '次级正文（dimmed）on 画布', fg: '--dsw-alias-label-primary-dimmed', bg: '--dsw-alias-bg-base', min: AA, kind: 'text' },
  { id: 'text-primary-bluish', label: '蓝调主文字', fg: '--dsw-alias-label-primary-bluish', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text' },
  // 反向文字：`background: label-primary` + `color: bg-layer-3`（Tag solid、构建号胶囊）
  { id: 'label-inverted', label: '反向文字 on 墨色底', fg: '--dsw-alias-bg-layer-3', bg: '--dsw-alias-label-primary', min: AA, kind: 'text' },
  // 同一支反向文字压在**缩略图上的半透明小圆钮**上（AttachmentPreview 的移除钮）。
  // 它是 HOST_FALLBACK 里那条取值的唯一去处 —— 修好取值与接上配对是同一件事。
  { id: 'label-inverted-photo', label: '反向文字 on 照片控件', fg: '--dsw-alias-label-primary-inverted', bg: '--dsw-alias-button-contrast-fill', min: AA, kind: 'text' },
  // 文档预览：两支令牌都由插件接管，此前从未互相校验。
  { id: 'document-preview-label', label: '文档预览文字', fg: '--dsw-alias-label-document-preview', bg: '--dsw-alias-bg-document-preview', min: AA, kind: 'text' },
  // 设置里的「更新可用」指示与账户提示图标（三处 bundle 的内联样式）。
  { id: 'brand-new-indicator', label: '更新指示文字', fg: '--dsw-alias-brand-primary-new-colorprimary-new-color', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text' },
  // 设置表单里那个「?」帮助按钮：24px 的图标按钮，悬停时底色换成 `bg-layer-4`
  // （**宿主从未声明**，见 presets.js 的宿主缺口修正），字形从 tertiary 提到 secondary。
  // 按非文字档要求 —— 这是图标，不是文字（`.helpButton` 里没有文本节点）。
  { id: 'help-button-hover', label: '帮助按钮悬停', fg: '--dsw-alias-label-secondary', bg: '--dsw-alias-bg-layer-4', min: NON_TEXT, kind: 'non-text' },
  // 保存失败提示：宿主写的是 `color: var(--dsw-alias-label-error)`，
  // 而这个令牌**从未被声明**（见 presets.js 的宿主缺口修正）。
  { id: 'label-error', label: '错误提示文字', fg: '--dsw-alias-label-error', bg: '--dsw-alias-bg-layer-2', min: AA, kind: 'text' },

  // ---- 悬停 / 按下：文字压在一个「会动的底」上 ----
  // 宿主把 `--dsw-alias-interactive-bg-hover` 铺在文字底下（`Menu.module.css` 的
  // `.item:hover`，同一行里还有 11px 的快捷键与标签文字）。契约此前只认平面表面，
  // 于是这一整类底从未被算过：深色模式下强调色是亮色，12% 的罩层把深底提亮，
  // 实测石墨 + 石墨灰 + 深色下 caption 掉到 **2.06**（目标 3）、tertiary **3.06**（4.5）。
  // 修法是把这两层加进求解的输入集（见 presets.js 的 HOVER_WASH），
  // 并把它们写进契约 —— 否则「解过了」和「断言过了」之间还是有一道缝。
  { id: 'hover-caption', label: '说明文字 on 悬停底', fg: '--dsw-alias-label-caption', bg: '--dsw-alias-interactive-bg-hover', over: '--dsw-alias-bg-layer-2', min: TEXT_TIERS.caption, kind: 'text' },
  { id: 'hover-tertiary', label: '三级文字 on 悬停底', fg: '--dsw-alias-label-tertiary', bg: '--dsw-alias-interactive-bg-hover', over: '--dsw-alias-bg-layer-2', min: TEXT_TIERS.tertiary, kind: 'text' },
  { id: 'hover-secondary', label: '次级文字 on 悬停底', fg: '--dsw-alias-label-secondary', bg: '--dsw-alias-interactive-bg-hover', over: '--dsw-alias-bg-layer-2', min: TEXT_TIERS.secondary, kind: 'text' },
  { id: 'hover-menu-caption', label: '菜单说明文字 on 悬停底', fg: '--dsw-alias-label-caption', bg: '--dsw-alias-interactive-bg-hover', over: '--dsw-menu-surface-fill', min: TEXT_TIERS.caption, kind: 'text' },
  { id: 'hover-menu-tertiary', label: '菜单三级文字 on 悬停底', fg: '--dsw-alias-label-tertiary', bg: '--dsw-alias-interactive-bg-hover', over: '--dsw-menu-surface-fill', min: TEXT_TIERS.tertiary, kind: 'text' },
  { id: 'active-menu-tertiary', label: '菜单三级文字 on 按下底', fg: '--dsw-alias-label-tertiary', bg: '--dsw-alias-interactive-bg-active', over: '--dsw-menu-surface-fill', min: TEXT_TIERS.tertiary, kind: 'text' },
  { id: 'active-menu-caption', label: '菜单说明文字 on 按下底', fg: '--dsw-alias-label-caption', bg: '--dsw-alias-interactive-bg-active', over: '--dsw-menu-surface-fill', min: TEXT_TIERS.caption, kind: 'text' },

  // 正文主力与次级正文在瞬态底上的底线。
  //
  // 这两级**解不到**自己那条高底线：罩层把深色底提亮之后，最亮的那层对纯白
  // 也只有 9.8:1，而 primary 要 12、dimmed 要 9 —— 数学上不可能（见 presets.js
  // 的 HOVER_WASH）。因此它们对平面表面求解、在瞬态底上退到下面两条线：
  //
  //   · primary：**AAA 的 7**。这是一条公认的外部标准，实测最低 8.29。
  //     插件对稳态底的 12 是美术标准，不该假装它在瞬态底上也成立。
  //   · dimmed：**下一级（secondary）的稳态底线 5.5**。理由不是「凑一个能过的数」，
  //     而是一条结构约束 —— dimmed 在阶梯上高于 secondary，它在任何底上都不该
  //     掉到 secondary 的底线以下，否则层级就读反了。实测最低 6.80。
  //
  // 两条阈值都写明了出处；改动配色把它们压下去，构建期就会响。
  { id: 'hover-primary', label: '主文字 on 悬停底（AAA）', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-interactive-bg-hover', over: '--dsw-alias-bg-layer-2', min: AAA, kind: 'text' },
  { id: 'active-primary', label: '主文字 on 按下底（AAA）', fg: '--dsw-alias-label-primary', bg: '--dsw-alias-interactive-bg-active', over: '--dsw-alias-bg-layer-2', min: AAA, kind: 'text' },
  { id: 'hover-dimmed', label: '次级正文 on 悬停底', fg: '--dsw-alias-label-primary-dimmed', bg: '--dsw-alias-interactive-bg-hover', over: '--dsw-alias-bg-layer-2', min: TEXT_TIERS.secondary, kind: 'text' },
  { id: 'active-dimmed', label: '次级正文 on 按下底', fg: '--dsw-alias-label-primary-dimmed', bg: '--dsw-alias-interactive-bg-active', over: '--dsw-alias-bg-layer-2', min: TEXT_TIERS.secondary, kind: 'text' },

  // ---- 思考态：扫光与底色的可分辨度 ----  // `.running` 把 `--dsw-alias-label-shimmer` 重指到 `-deep-diving-shimmer`，
  // 而 TextShimmer 的扫光正是用这支颜色把正文再画一遍（遮罩成一条扫过的带）。
  // 因此它与正文的可分辨度是一条真实约束；官方自己也只做到 1.6 左右（刻意的微光），
  // 阈值因此取官方水平而不是更高 —— 与快捷键键帽那条同一个做法。
  { id: 'think-shimmer', label: '思考扫光 vs 正文', fg: '--dsw-alias-label-deep-diving-shimmer', bg: '--dsw-alias-label-deep-diving', min: 1.5, kind: 'non-text' },
  { id: 'think-label', label: '思考态标签 on 表面', fg: '--dsw-alias-label-deep-diving', bg: '--dsw-alias-bg-layer-1', min: AA, kind: 'text' },
  { id: 'think-label-canvas', label: '思考态标签 on 画布', fg: '--dsw-alias-label-deep-diving', bg: '--dsw-alias-bg-base', min: AA, kind: 'text' }
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
 * 支持 `over`：背景是**半透明**的一层，而它真正压在上面的不是画布，
 * 是某个更具体的表面 —— 差异视图的 `.add / .del` 就是这种情况
 * （`--dsw-alias-code-diff-added` 是 8% 的绿，落在代码块底色上，
 * 而不是落在画布上）。少了它，契约会把淡染层合成到画布，
 * 算出一个界面上并不存在的比值。
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
  const underlay =
    pair.over === undefined
      ? canvas
      : composite(readRef(tokens, pair.over, mode) ?? canvas, canvas)
  const bg = composite(rawBg, underlay)
  return { fg: composite(rawFg, bg), bg }
}

/**
 * 评估一份令牌层在一个明暗下的可读性。
 *
 * `pair.modes` 可以限制一条配对只在某个明暗下成立：`INFEASIBLE` 里那些
 * 「两个角色方向相反」的令牌就属于这种情况 —— 与其把阈值调低到刚好能过，
 * 不如让约束只出现在它真正可行的那一侧。
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
    if (pair.modes !== undefined && !pair.modes.includes(mode)) continue
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
