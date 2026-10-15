window.__ModuleLoader__.load({
	id: "dsh-ui-beautify",
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
		const React = require("react")

// ---- src/client/color.js -----------------------------------------
/**
 * 界面美化 · Lumina —— 颜色工具与 WCAG 求解器。
 *
 * 这个模块是插件里**唯一**做颜色数学的地方：解析、混合、对比度，以及把
 * 「想要的颜色」变成「读得出来的颜色」的求解器。
 *
 * ## 为什么颜色需要求解器，而不是再手调一轮色值
 * v1.1 的强调色是七个手写常量。手调的取值在**默认预设 + 默认强调色**下看起来
 * 没问题，但预设有四个、强调色有七个、明暗两套 —— 一共 56 种组合，手调不可能
 * 覆盖。实测漏掉的是这几条（详见 CHANGELOG 1.2.0 与 DESIGN 四之六）：
 *
 *   1. 浅色下 `碧波青 #0d8f85` 上的白字只有 3.97:1、`琥珀金 #b26a06` 是 4.24:1，
 *      都低于 WCAG AA 的 4.5:1 —— 而这两个色正是主按钮的填充色；
 *   2. 同样这两个色当链接/品牌文字用时，对画布只有 3.61–3.99:1；
 *   3. 浅色下三级文字与说明文字在石墨/纸感预设里比官方基线还低。
 *
 * 修法有两种：把色值再手调一次（下次加第八个强调色，同一个坑重来一遍），
 * 或者**把「达标」写成一个可计算的约束**，让颜色自己朝达标的方向走。本模块选后者。
 *
 * ## 求解器为什么保持色相与饱和度
 * 求解只沿明度轴移动（必要时二分），色相与饱和度取自原色：用户选的是「碧波青」，
 * 求解后它依然是碧波青，只是深了 4%。若改成朝灰或朝另一个色相插值，就等于悄悄
 * 换掉了用户的选择 —— 那不是可接受的「修复」。
 *
 * ## 为什么达标的颜色原样返回
 * `ensureContrast` 与 `solveTone` 都遵循「不达标才动」。已经合格的取值不会被无谓
 * 改写，diff 里也就只剩真正需要修的那几处；也让「求解」这件事在不该生效时
 * 完全不可见。
 */

/** 十六进制颜色字面量：3 / 4 / 6 / 8 位，可带或不带 `#`。 */
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** 判定「亮侧 / 暗侧」的亮度分界。插件所有表面色都远离这个值（浅色系 0.85+，深色系 ≤0.08）。 */
const LIGHT_SIDE_THRESHOLD = 0.4

/** 二分次数：26 次把明度区间压到 2^-26，远超 8 位色深的可分辨范围。 */
const SEARCH_STEPS = 26

/**
 * 解析十六进制颜色。
 * @param value - 任意颜色字符串。
 * @returns `{ r, g, b, a }`（分量 0–255，alpha 0–1）；无法解析时返回 null。
 */
function parseHex(value) {
  const match = HEX.exec(String(value ?? '').trim())
  if (match === null) return null
  let body = match[1]
  if (body.length === 3 || body.length === 4) {
    body = [...body].map((char) => char + char).join('')
  }
  const channel = (index) => parseInt(body.slice(index, index + 2), 16)
  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: body.length === 8 ? channel(6) / 255 : 1
  }
}

/** 把 `{ r, g, b }` 格式化回 `#rrggbb`（分量夹到合法区间并取整）。 */
function toHex(color) {
  const channel = (value) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
}

/** sRGB 分量（0–255）→ 线性光。WCAG 2.x 的定义，不能省。 */
function linearize(value) {
  const channel = value / 255
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4)
}

/**
 * 相对亮度（WCAG 2.x，0–1）。
 *
 * 无法解析的颜色返回 0（即「按最暗处理」）。**不要依赖这个兜底去做判断** ——
 * 它会让一个拼错的颜色看起来像纯黑。需要「解析失败就失败」的地方用 `contrast`，
 * 它对无法解析的输入直接返回 0，任何阈值都过不去。
 *
 * @param color - 十六进制颜色。
 */
function luminance(color) {
  const parsed = parseHex(color)
  if (parsed === null) return 0
  return (
    0.2126 * linearize(parsed.r) +
    0.7152 * linearize(parsed.g) +
    0.0722 * linearize(parsed.b)
  )
}

/**
 * 把可能带 alpha 的 `foreground` 合成到实色 `background` 上，返回实色。
 *
 * 界面上「半透明色压在某个底上」的观感由合成后的实色决定；直接拿 alpha 值去算
 * 对比度会高估。因此所有对比度计算都先过这一步。
 *
 * 返回值的约定是**实色**：不透明的前景原样返回，半透明的前景合成后返回。
 * 前景无法解析时也只能原样返回（没有可用的信息去合成），此时不保证是实色 ——
 * 但 `contrast` 会在更前面一步就把这种输入拦成 0，所以这个分支进不了对比度计算。
 */
function composite(foreground, background) {
  const fg = parseHex(foreground)
  if (fg === null) return String(foreground)
  const bg = parseHex(background)
  // 底无法解析时按「零透明的前景」返回：去掉 alpha 而不是留着它 ——
  // 留着一个半透明值会让调用方以为拿到的是实色，从而把 alpha 带进后续计算。
  if (fg.a >= 1 || bg === null) return toHex({ ...fg, a: 1 })
  return toHex({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a)
  })
}

/**
 * 对比度比值（1–21，WCAG 2.x）。
 *
 * **任一侧无法解析时返回 0**，而不是 21。这不是吹毛求疵：`luminance` 对垃圾输入
 * 的兜底是 0（按最暗处理），于是 `contrast('oops', '#ffffff')` 会算出 21:1 ——
 * 一个拼错的令牌名会得到「满分」而不是失败，恰好是这个模块最该避免的静默失效。
 * 返回 0 之后，契约里的任何阈值都过不去，构建期就会响。
 *
 * @param foreground - 前景色；带 alpha 时先合成到背景上。
 * @param background - 背景色（实色）。
 */
function contrast(foreground, background) {
  if (parseHex(foreground) === null || parseHex(background) === null) return 0
  const a = luminance(composite(foreground, background))
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * 把 `color` 按 `amount` 的比例混进 `base`，返回实色十六进制。
 *
 * 参数顺序刻意写成「底色在前、掺入色在后」，因为绝大多数调用都是
 * 「往画布/表面上掺一点强调色」；反过来写极易读成「强调色占 amount」，
 * 从而把 12% 的淡染写成 88% 的实色 —— 这是本插件第一版真的踩过的坑。
 *
 * @param base - 底色。
 * @param color - 要掺入的颜色。
 * @param amount - 掺入比例，0..1。
 */
function tint(base, color, amount) {
  const a = parseHex(base)
  const b = parseHex(color)
  if (a === null || b === null) return base
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount
  })
}

/** 给实色追加两位 alpha，得到 8 位十六进制。 */
function alpha(hex, amount) {
  const parsed = parseHex(hex)
  if (parsed === null) return hex
  const byte = Math.max(0, Math.min(255, Math.round(amount * 255)))
  return `${toHex(parsed)}${byte.toString(16).padStart(2, '0')}`
}

/**
 * 把 8 位十六进制色的 alpha 归零，得到「同色相、全透明」的版本。
 *
 * 渐变里不能用 CSS 的 `transparent` 关键字收尾：它等于 `rgb(0 0 0 / 0)`，
 * 而 sRGB 插值会把中途的颜色往**黑**里带，于是本该干净淡出的光斑边缘
 * 会出现一圈发灰的脏边。用同色相零 alpha 才能淡出自己的颜色。
 */
function fadeOut(color) {
  const parsed = parseHex(color)
  return parsed === null ? color : `${toHex(parsed)}00`
}

// ------------------------------------------------------------------ HSL

/** 十六进制 → `{ h: 0–360, s: 0–1, l: 0–1 }`。 */
function toHsl(color) {
  const parsed = parseHex(color) ?? { r: 0, g: 0, b: 0 }
  const [rr, gg, bb] = [parsed.r / 255, parsed.g / 255, parsed.b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const delta = max - min
  const l = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0, l }
  const s = delta / (1 - Math.abs(2 * l - 1))
  let h
  if (max === rr) h = ((gg - bb) / delta) % 6
  else if (max === gg) h = (bb - rr) / delta + 2
  else h = (rr - gg) / delta + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

/** `{ h, s, l }` → 十六进制实色。 */
function fromHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = l - c / 2
  const table = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x]
  ]
  const [r, g, b] = table[Math.floor(hp) % 6]
  return toHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 })
}

// -------------------------------------------------------------- 求解器

/**
 * 判断一组背景属于亮侧还是暗侧。
 *
 * 求解器的前提是「组内背景同侧」：暗色文字一旦在组内最暗的背景上达标，在所有
 * 更亮的背景上只会更清楚（反之亦然）。混侧的组会让可行区间可能为空 —— 这不是
 * 本插件会遇到的情形，`scripts/check.mjs` 有一条断言把这件事钉住。
 *
 * 只返回 `side`：「平均亮度」与「最难的那个背景」都算过，但没有一个调用方需要 ——
 * 求解器自己会在区间上二分，不需要预先挑出最难的背景。留着它们会让读者以为
 * 求解依赖这两个值，因此删掉（`side` 是 check.mjs 唯一用到的字段）。
 *
 * @returns `'light' | 'dark' | 'mixed'`。
 */
function analyzeBackdrops(backgrounds) {
  const list = backgrounds.filter((value) => parseHex(value) !== null)
  if (list.length === 0) return 'mixed'
  if (list.every((value) => luminance(value) > LIGHT_SIDE_THRESHOLD)) return 'light'
  if (list.every((value) => luminance(value) <= LIGHT_SIDE_THRESHOLD)) return 'dark'
  return 'mixed'
}

/**
 * 沿明度轴移动 `color`，直到它对本组里**每一个**背景都达到 `target`，返回实色十六进制。
 *
 * 已经全部达标时原样返回（只做合成与格式归一）。色相、饱和度取自原色。
 *
 * 为什么一次二分就够：对比度对「亮背景」随明度单调递减、对「暗背景」随明度单调
 * 递增，因此每个约束都是单调的，可行区间是区间 —— 直接在区间上二分即可，不需要
 * 逐个背景反复微调（那会让结果依赖背景的排列顺序）。
 *
 * **这句话成立的区间是本插件的搜索范围，不是整个明度轴。** 严格说，当候选色的
 * 明度越过背景自身的明度时，比值会「折返」（先降到 1:1 再升上去），单调性就不成立：
 * 实测对 `#808080` 这样的中间调背景，全程有约 1840 档非单调；对 `#f6f8fc` 有 135 档。
 * 之所以安全，是因为四个预设的表面色全部落在极亮（相对亮度 ≥0.85）或极暗（≤0.08）
 * 两端，候选解永远在背景的**另一侧**，不会越过它。
 * `scripts/check.mjs` 有一条断言检查这件事：表面色不得落在中间带内 ——
 * 将来加一个中间调的预设，那条断言会先失败，而不是让求解器悄悄给出劣解。
 *
 * @param color - 起始颜色。
 * @param backgrounds - 会被这个颜色压在其上的背景色列表。
 * @param target - 目标对比度。
 */
function solveTone(color, backgrounds, target) {
  return solveColor(
    color,
    backgrounds.map((against) => ({ against, target }))
  )
}

/**
 * 多约束求解：沿明度轴移动 `color`，直到**全部** `requirements` 都满足，返回实色十六进制。
 *
 * `requirements` 每项是 `{ against, target }`，语义是「本颜色与 `against` 之间至少
 * `target`」。这条语义对「本颜色是文字」与「本颜色是底、`against` 是压在它上面的
 * 文字」是同一条 —— 对比度本来就对称，因此不需要区分角色。
 *
 * ## 方向是怎么定的
 * 每个约束自己决定「本颜色该变亮还是变暗」：对方亮，本颜色就得暗下去；对方暗，
 * 本颜色就得亮起来。全部约束方向一致时可行区间是一个区间，二分即可；
 * **方向冲突则无解**（例如要求同时压住纯黑与纯白的文字），此时返回 `null`，
 * 由调用方与 `scripts/check.mjs` 的断言在构建期暴露，而不是悄悄给一个不达标的值。
 *
 * 这正是强调色需要的东西：浅色模式下「白字压在强调色上」要求强调色够暗，
 * 「强调色当链接压在画布上」也要求它够暗 —— 两条同向，可以一起求解。
 * 而 v1.1 是手写色值，两个方向各调各的，于是总有一头不达标。
 *
 * @param color - 起始颜色。
 * @param requirements - `{ against, target }[]`。
 * @returns `#rrggbb`，或方向冲突 / 无解时返回 `null`。
 */
function solveColor(color, requirements) {
  const list = requirements.filter(
    (item) => parseHex(item.against) !== null && Number.isFinite(item.target)
  )
  const base = composite(color, list[0]?.against ?? '#ffffff')
  if (list.length === 0) return base
  const passes = (candidate) =>
    list.every((item) => contrast(candidate, item.against) >= item.target)
  if (passes(base)) return base

  /**
   * 方向由**哪一端真的够得着目标**决定，而不是由背景落在阈值哪一侧决定。
   *
   * v1.2 用的是 `luminance(against) > 0.4 ? 压暗 : 提亮`。那是一条**有死区的规则**：
   * 背景亮度落在 (0.183, 0.4] 之间时它选「提亮」，而提亮最多只能到
   * `1.05 / (L + 0.05)` —— 对 L = 0.3 只有 3.0，永远够不到 4.5；同一时刻压暗
   * 却能到 7.0。于是求解器对一个**有解**的约束返回 `null`：
   *
   *   solveColor('#808080', [{ against: '#a8a8a8', target: 4.5 }])   // v1.2 → null
   *
   * 现在的判据是两端各自的**可达上限**：压暗到纯黑给 `(L + 0.05) / 0.05`，
   * 提亮到纯白给 `1.05 / (L + 0.05)`。哪一端够得着就往哪端走；两端都够不着 →
   * 无解；两端都够得着 → 回到「背景落在哪一侧」做平局判定（保留原来的取向，
   * 只是它不再独占决策权）。
   *
   * 对当前全部输入，两种算法给出同一个方向（极亮的底只有压暗能到 4.5，
   * 极暗的底只有提亮能到），因此这是一处**只修死区、不改现状**的改动；
   * `tests/runtime.test.mjs` 有一条用上面那个最小复现钉住它。
   */
  const reachable = (item, direction) => {
    const background = luminance(item.against)
    const best =
      direction === 'darken'
        ? (background + 0.05) / 0.05
        : 1.05 / (background + 0.05)
    return best >= item.target
  }
  let needDarken = false
  let needLighten = false
  let bothAllowedEverywhere = true
  for (const item of list) {
    const byDarken = reachable(item, 'darken')
    const byLighten = reachable(item, 'lighten')
    // 两端都够不着：这条约束本身就无解，任何方向都不会成功
    if (!byDarken && !byLighten) return null
    if (!byLighten) needDarken = true
    if (!byDarken) needLighten = true
    if (!(byDarken && byLighten)) bothAllowedEverywhere = false
  }
  // 同时存在「只能压暗」与「只能提亮」→ 方向冲突，无解。
  // 严格说中调色偶尔能同时满足两端，但那要求候选解越过背景自身的明度 ——
  // 正是二分搜索不成立的那段区间，因此按无解处理、交由构建期断言暴露。
  if (needDarken && needLighten) return null
  const darken = bothAllowedEverywhere
    ? list.every((item) => luminance(item.against) > LIGHT_SIDE_THRESHOLD)
    : needDarken

  const { h, s, l } = toHsl(base)
  let lo = darken ? 0 : l
  let hi = darken ? l : 1
  let best = null
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const mid = (lo + hi) / 2
    if (passes(fromHsl(h, s, mid))) {
      best = mid
      if (darken) lo = mid
      else hi = mid
    } else if (darken) {
      hi = mid
    } else {
      lo = mid
    }
  }
  // 全程无解：连最极端的明度都不满足。不返回一个「差一点」的值 ——
  // 那会让不达标的配色以「已求解」的名义混进产物。
  return best === null ? null : fromHsl(h, s, best)
}

/**
 * 单背景版本的 `solveTone`。带 alpha 的颜色会先合成到 `against` 上再求解。
 *
 * @param color - 待调整的颜色。
 * @param against - 参照背景（实色）。
 * @param target - 目标对比度。
 */
function ensureContrast(color, against, target) {
  return solveTone(color, [against], target)
}

// ---- src/client/readability.js -----------------------------------
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



/** WCAG AA：正文文字。 */
const AA = 4.5

/** WCAG 1.4.11：非文字（图标、边框、控件状态）。 */
const NON_TEXT = 3

/** WCAG AAA：正文文字。瞬态底（悬停 / 按下）上的主文字退到这条线，见 `hover-primary`。 */
const AAA = 7

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
const TEXT_TIERS = Object.freeze({
  primary: 12,
  dimmed: 9,
  secondary: 5.5,
  tertiary: 4.5,
  caption: 3,
  icon: 3
})

/** 文字与强调色可能压在其上的表面。只对画布求解不够 —— 同一段文字也会落在卡片与代码块上。 */
const SURFACE_KEYS = Object.freeze([
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
function surfaceColors(neutral) {
  return SURFACE_KEYS.map((key) => neutral[key]).filter(
    (value) => typeof value === 'string' && value.length > 0
  )
}

/** 宿主 shiki 主题的 9 个语法 token（`--shiki-*`），顺序与 shiki.css 一致。 */
const SYNTAX_TOKENS = Object.freeze([
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
const HOST_FALLBACK = Object.freeze({
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
const HOST_GAPS = Object.freeze({
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
const DELIBERATE = Object.freeze({
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
const UNCOVERED = Object.freeze({
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
const INFEASIBLE = Object.freeze([
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
const PAIRS = Object.freeze(PAIR_LIST.map((pair) => Object.freeze(pair)))

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
function evaluate(tokens, mode) {
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
function evaluateBoth(tokens) {
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

// ---- src/client/presets.js ---------------------------------------
/**
 * 界面美化 · Lumina —— 设计令牌预设表。
 *
 * 这里是插件唯一的「配色与几何真相来源」。所有值最终通过
 * `ctx.theme.overrideTokens(source, tokens)` 交给宿主的主题管线，由 ui-layout 的
 * presenter 以行内样式写到 `document.body` 上；因此本文件不产生任何 CSS。
 *
 * ## 为什么走宿主的主题管线而不是自己塞 CSS 变量
 * 宿主 ui-theme 把令牌作为行内样式写在 body 上（见 dsh-client-ui-layout 的
 * ThemePresenter.apply）。行内样式优先级最高，自建 `<style>` 里重声明 `--dsw-*`
 * 对它无效。走 overrideTokens 才能：
 *   1. 与官方主题叠加而非互斥 —— 用户切换浅色/深色时自动重解析；
 *   2. 随插件卸载/HMR 干净回滚（返回的 disposer 由 ctx.effect 持有）；
 *   3. 被宿主的令牌检查工具（exportInspectTokens）看见。
 *
 * ## 值形状
 * 每个令牌都必须给出 `{ light, dark }` 一对字符串；给裸字符串会被宿主的
 * validateOverrides 抛错（它在运行时真的会校验，这是官方契约）。
 *
 * ## 本版的关键变化：承载文字的颜色改为「解出来」（v1.2）
 * v1.1 的每个色值都是手写的。手调在「默认预设 + 默认强调色」下看不出问题，但
 * 4 预设 × 7 强调色 × 2 明暗 = 56 种组合，人眼覆盖不了。实测漏掉四处，
 * 其中一处是**完全看不见**的：
 *
 *   宿主把 `--dsw-specific-sidebar-nav-item-active-accent` 当**徽标底色**用
 *   （ui-user-questions：`.badge { background: 该令牌; color: var(--dsw-alias-button-info-fill) }`），
 *   而 v1.1 把这个令牌写成了完整强调色 —— 于是徽标的字与底同色，对比度 1.00。
 *
 * 因此 v1.2 把「读得出来」写成 `readability.js` 里的契约，并让颜色**解出来**：
 * 中性骨架仍是手写的美术决定，但凡承载文字的颜色都过一遍 `solveTone`，达标即
 * 原样返回。这样加第八个强调色时不会再重蹈覆辙。
 *
 * ## 命名约定
 * - `--dsw-*`：宿主官方令牌，覆盖它即改变宿主组件外观。
 * - `--dshb-*`：本插件自有令牌（b = beautify）。它们只作为原语存在，
 *   由 styles/*.css 组合成宿主令牌 —— 用于那些宿主在每个元素上重声明、
 *   因此行内样式够不着的令牌（`--dsw-elevation-*`）。
 */




/** 把一对明暗值包成宿主要求的形状。 */
const t = (light, dark) => ({ light, dark })

/**
 * 强调色。`light` 用于浅色主题（压暗以保证白底对比度），`dark` 用于深色主题
 * （提亮以保证深底对比度）。二者不是同一个色相的简单透明度变化，而是分别调校，
 * 因此这里显式写两遍。
 */
const ACCENTS = [
  { id: 'deepseek', name: '深海蓝', light: '#3f6fe0', dark: '#7aaaff' },
  { id: 'violet', name: '星云紫', light: '#6741d9', dark: '#a78bfa' },
  { id: 'teal', name: '碧波青', light: '#0d8f85', dark: '#2dd4bf' },
  { id: 'amber', name: '琥珀金', light: '#b26a06', dark: '#fbbf24' },
  { id: 'rose', name: '绯樱粉', light: '#c72e63', dark: '#f472b6' },
  { id: 'forest', name: '苔原绿', light: '#1f7a4d', dark: '#4ade80' },
  { id: 'graphite', name: '石墨灰', light: '#414a58', dark: '#c3ccdb' }
]

/**
 * 圆角档位。
 *
 * 刻意**不用统一乘数**，而是逐档给出设计值。两处硬约束：
 *
 * 1. 宿主的 `--dsw-radius-md` 同时用在 32px 高的输入框、34–36px 高的按钮/
 *    菜单行和卡片上。乘 1.4 会得到 17px，超过 32px 输入框半高（16px），
 *    圆角一越界控件就塌成胶囊 —— 这是第一版「圆润」档的实际后果。
 *    因此 `md` 的上限锁在 14px（占 32px 的 44%），并把这条约束写成
 *    scripts/check.mjs 里的断言。
 * 2. 圆角层级要单调：xs ≤ sm ≤ md ≤ lg ≤ xl ≤ panel。宿主自带的 4/8/12/16/20/28
 *    大致每级 +4，三档都在这个性格上做伸缩，而不是各调各的。
 *
 * 于是三档的差异主要落在大表面上（卡片、气泡、输入区卡片、对话框），
 * 小控件只做小幅收紧/放松 —— 把 32px 的输入框磨得比卡片还圆，
 * 正是「看起来没打磨过」的典型来源。
 *
 * `contentRadius` 是 Windows 标题栏模式下内容区左上角那个圆角
 * （宿主 `--dsh-windows-content-radius`），跟随 `lg` 一档走，
 * 与相邻表面保持同一支笔。
 */
const RADIUS_SCALES = [
  {
    id: 'compact',
    name: '紧凑',
    radii: { xs: 3, sm: 6, md: 9, lg: 12, xl: 15, panel: 22 },
    contentRadius: 12
  },
  {
    id: 'standard',
    name: '标准',
    radii: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, panel: 28 },
    contentRadius: 16
  },
  {
    id: 'soft',
    name: '圆润',
    radii: { xs: 5, sm: 10, md: 14, lg: 21, xl: 26, panel: 36 },
    contentRadius: 21
  }
]

/**
 * 圆角**形状**（与圆角半径正交的一条轴）。
 *
 * 宿主自带 `theme/corner_shape.css`：
 *
 *   @supports (corner-shape: superellipse(1.5)) {
 *     :root { --dsw-corner-shape: superellipse(1.5) }
 *     *, :before, :after { corner-shape: var(--dsw-corner-shape) }
 *   }
 *
 * 也就是说官方在支持该属性的浏览器上把**所有**圆角都做成了方圆形
 * （超椭圆，苹果那种「更饱满」的圆角），并把它交给一个令牌控制 ——
 * 而 v1.2 从来没有碰过这个令牌。
 *
 * 这条轴与半径完全正交：半径决定「切多深」，形状决定「切口是什么曲线」。
 * 三档里 `squircle` 就是官方的 `superellipse(1.5)`，因此**默认值不改变现有观感**；
 * 另外两档才是有意的偏离。
 *
 * 为什么值得做成一个开关：`corner-shape` 是这两年的新属性，观感差异在
 * 16–28px 的大圆角上非常明显（卡片、对话框、输入区），而「正圆 / 方圆形」
 * 是一个真实的审美分歧点 —— 有人认为方圆形更「高级」，有人认为它「不够利落」。
 * 插件不该替用户选，但应该把它变成一行可选项。
 *
 * 圆形按钮与胶囊不受影响：宿主的 StateDot / Pill / Switch / Tag / 滚动条滑块
 * 都自己写了 `corner-shape: round`，那是刻意的（正圆才像圆），
 * `scripts/check.mjs` 有一条断言把这件事钉在插件自己的样式表上。
 */
const CORNER_SHAPES = [
  { id: 'round', name: '正圆', css: 'round' },
  { id: 'squircle', name: '方圆形', css: 'superellipse(1.5)' },
  { id: 'crisp', name: '硬朗', css: 'superellipse(2.4)' }
]

/**
 * 四个预设。
 *
 * `neutral` 是每个预设的「表面与墨色」骨架，明暗各一组；`shadow` 是该预设的
 * 阴影气质（冷调/中性/深黑/暖调）；`ambient` 是氛围光叠加层的两组光斑颜色。
 * 品牌色不写死在这里 —— 它来自用户选中的强调色，见 buildTokens。
 */
const PRESETS = [
  {
    id: 'aurora',
    name: '极光',
    tagline: '冷调分层 · 通透',
    swatch: ['#3f6fe0', '#eef2f9', '#0c1017'],
    neutral: {
      light: {
        canvas: '#f6f8fc',
        surface1: '#ffffff',
        surface2: '#ffffff',
        surface3: '#ffffff',
        sidebar: '#eef2f9',
        overlay: '#dde5f2',
        module: '#f1f5fb',
        input: '#ffffff',
        code: '#f3f6fb',
        codeBanner: '#eaeff8',
        inlineCode: '#eef2f9',
        citation: '#eef2f9',
        tag: '#eef2f9',
        placeholder: '#f1f5fb',
        menu: '#fbfcffd9',
        menuHeader: '#fbfcfff2',
        toast: '#1a2436',
        scrollbar: '#c6d2e4',
        scrollbarHover: '#a3b3cb',
        switchThumb: '#ffffff',
        documentPreview: '#eef2f9',
        documentPreviewLabel: '#48566e',
        ink: '#0e1626',
        inkDimmed: '#28344a',
        inkSecondary: '#48566e',
        inkTertiary: '#6b7a91',
        inkCaption: '#8c98ab',
        icon: '#3c4a61',
        border1: '#1b2a4a0f',
        border2: '#1b2a4a1a',
        border3: '#1b2a4a24',
        border4: '#1b2a4a33'
      },
      dark: {
        canvas: '#0c1017',
        surface1: '#151b26',
        surface2: '#1b2230',
        surface3: '#222a3a',
        sidebar: '#101620',
        overlay: '#2a3244',
        module: '#222a3a',
        input: '#151b26',
        code: '#111721',
        codeBanner: '#171e2a',
        inlineCode: '#1b2230',
        citation: '#222a3a',
        tag: '#222a3a',
        placeholder: '#1b2230',
        menu: '#1a2130cc',
        menuHeader: '#161c28f2',
        toast: '#2a3244',
        scrollbar: '#3b4661',
        scrollbarHover: '#525f7d',
        switchThumb: '#8fa0bb',
        documentPreview: '#0c1017',
        documentPreviewLabel: '#b6c2d4',
        ink: '#eef2f8',
        inkDimmed: '#dae2ee',
        inkSecondary: '#a8b4c8',
        inkTertiary: '#7d8899',
        inkCaption: '#697485',
        icon: '#c6d0e0',
        border1: '#ffffff14',
        border2: '#ffffff24',
        border3: '#ffffff2e',
        border4: '#ffffff3d'
      }
    },
    shadow: {
      light: {
        stroke: '#1b2a4a29',
        lv1: '0 1px 2px 0 #101d360a',
        lv1blur: '0 4px 12px 0 #101d3608',
        lv2: '0 4px 12px 0 #101d3608, 0 2px 8px 0 #101d360d',
        lv3: '0 0 1px 0 #101d361f, 0 4px 12px 0 #101d360a, 0 14px 36px 0 #101d3617',
        panel: '0 3px 8px 0 #101d360a, 0 0 16px 0 #101d3608',
        prominent: '0 4px 12px 0 #101d360f, 0 0 22px 0 #101d3612',
        soft: '0 6px 20px 0 #101d360d, 0 0 28px 0 #101d360a'
      },
      dark: {
        stroke: '#ffffff2b',
        lv1: '0 1px 2px 0 #0000003d',
        lv1blur: '0 4px 12px 0 #0000002e',
        lv2: '0 4px 14px 0 #00000033, 0 2px 8px 0 #0000003d',
        lv3: '0 0 1px 0 #00000073, 0 6px 18px 0 #0000003d, 0 16px 40px 0 #00000052',
        panel: '0 3px 10px 0 #0000003d, 0 0 18px 0 #00000033',
        prominent: '0 6px 18px 0 #0000004d, 0 0 26px 0 #0000003d',
        soft: '0 8px 26px 0 #00000047, 0 0 32px 0 #00000033'
      }
    },
    ambient: {
      light: ['#3f6fe01f', '#7c5cff14'],
      dark: ['#4d7ff01f', '#8b5cf614']
    }
  },
  {
    id: 'midnight',
    name: '午夜',
    tagline: '深邃高对比 · 夜航',
    swatch: ['#5b8cf7', '#e9edf5', '#080a10'],
    neutral: {
      light: {
        canvas: '#f2f4f8',
        surface1: '#ffffff',
        surface2: '#ffffff',
        surface3: '#ffffff',
        sidebar: '#e9edf5',
        overlay: '#d6dded',
        module: '#eef2f8',
        input: '#ffffff',
        code: '#f1f4f9',
        codeBanner: '#e7ecf4',
        inlineCode: '#eaeff6',
        citation: '#eaeff6',
        tag: '#eaeff6',
        placeholder: '#eef2f8',
        menu: '#fafcffd9',
        menuHeader: '#fafcfff2',
        toast: '#12192a',
        scrollbar: '#bcc8dc',
        scrollbarHover: '#93a3bd',
        switchThumb: '#ffffff',
        documentPreview: '#e9edf5',
        documentPreviewLabel: '#3c4a61',
        ink: '#0a0d14',
        inkDimmed: '#1d2536',
        inkSecondary: '#414c63',
        inkTertiary: '#69748c',
        inkCaption: '#8a94a8',
        icon: '#33405a',
        border1: '#0b1a3314',
        border2: '#0b1a3320',
        border3: '#0b1a332e',
        border4: '#0b1a3342'
      },
      dark: {
        canvas: '#080a10',
        surface1: '#111520',
        surface2: '#171d2b',
        surface3: '#1f2739',
        sidebar: '#0b0e15',
        overlay: '#28334a',
        module: '#1f2739',
        input: '#111520',
        code: '#0d1119',
        codeBanner: '#141924',
        inlineCode: '#171d2b',
        citation: '#1f2739',
        tag: '#1f2739',
        placeholder: '#171d2b',
        menu: '#151b28d9',
        menuHeader: '#111622f2',
        toast: '#28334a',
        scrollbar: '#34405a',
        scrollbarHover: '#4a5876',
        switchThumb: '#8296b8',
        documentPreview: '#080a10',
        documentPreviewLabel: '#bcc8dc',
        ink: '#f4f7fc',
        inkDimmed: '#e0e8f4',
        inkSecondary: '#aab6cc',
        inkTertiary: '#7f8b9f',
        inkCaption: '#68738a',
        icon: '#ccd8ea',
        border1: '#ffffff1a',
        border2: '#ffffff2b',
        border3: '#ffffff38',
        border4: '#ffffff4d'
      }
    },
    shadow: {
      light: {
        stroke: '#0b1a3333',
        lv1: '0 1px 2px 0 #08122b0d',
        lv1blur: '0 4px 14px 0 #08122b0a',
        lv2: '0 4px 14px 0 #08122b0a, 0 2px 8px 0 #08122b12',
        lv3: '0 0 1px 0 #08122b26, 0 6px 16px 0 #08122b0f, 0 18px 44px 0 #08122b1f',
        panel: '0 4px 10px 0 #08122b0f, 0 0 18px 0 #08122b0a',
        prominent: '0 6px 16px 0 #08122b17, 0 0 26px 0 #08122b17',
        soft: '0 8px 24px 0 #08122b14, 0 0 32px 0 #08122b0f'
      },
      dark: {
        stroke: '#ffffff33',
        lv1: '0 1px 3px 0 #00000059',
        lv1blur: '0 5px 16px 0 #00000042',
        lv2: '0 5px 16px 0 #00000047, 0 2px 10px 0 #00000052',
        lv3: '0 0 1px 0 #0000008a, 0 8px 22px 0 #00000057, 0 20px 52px 0 #0000006b',
        panel: '0 4px 12px 0 #00000057, 0 0 20px 0 #00000047',
        prominent: '0 8px 22px 0 #00000066, 0 0 30px 0 #00000052',
        soft: '0 10px 32px 0 #00000061, 0 0 36px 0 #00000047'
      }
    },
    ambient: {
      light: ['#2f5fd41a', '#0ea5a412'],
      dark: ['#3b82f62e', '#22d3ee1a']
    }
  },
  {
    id: 'graphite',
    name: '石墨',
    tagline: '中性克制 · 专注',
    swatch: ['#414a58', '#f1f1f3', '#131315'],
    neutral: {
      light: {
        canvas: '#f7f7f8',
        surface1: '#ffffff',
        surface2: '#ffffff',
        surface3: '#ffffff',
        sidebar: '#f1f1f3',
        overlay: '#e2e2e5',
        module: '#f4f4f6',
        input: '#ffffff',
        code: '#f4f4f6',
        codeBanner: '#ececef',
        inlineCode: '#f0f0f2',
        citation: '#f0f0f2',
        tag: '#f0f0f2',
        placeholder: '#f4f4f6',
        menu: '#fafafad9',
        menuHeader: '#fafafaf2',
        toast: '#2b2b2e',
        scrollbar: '#c9c9ce',
        scrollbarHover: '#a6a6ad',
        switchThumb: '#ffffff',
        documentPreview: '#f1f1f3',
        documentPreviewLabel: '#4c4c52',
        ink: '#141416',
        inkDimmed: '#2c2c30',
        inkSecondary: '#5c5f66',
        inkTertiary: '#82868f',
        inkCaption: '#a0a4ac',
        icon: '#414147',
        border1: '#00000012',
        border2: '#0000001f',
        border3: '#0000002b',
        border4: '#0000003d'
      },
      dark: {
        canvas: '#131315',
        surface1: '#1e1e21',
        surface2: '#26262a',
        surface3: '#2e2e33',
        sidebar: '#18181b',
        overlay: '#35353a',
        module: '#2e2e33',
        input: '#1e1e21',
        code: '#161618',
        codeBanner: '#1e1e21',
        inlineCode: '#26262a',
        citation: '#2e2e33',
        tag: '#2e2e33',
        placeholder: '#26262a',
        menu: '#232327d9',
        menuHeader: '#1c1c20f2',
        toast: '#35353a',
        scrollbar: '#4a4a51',
        scrollbarHover: '#5f5f68',
        switchThumb: '#a9a9b2',
        documentPreview: '#131315',
        documentPreviewLabel: '#c9c9ce',
        ink: '#f2f2f3',
        inkDimmed: '#dededf',
        inkSecondary: '#adadb4',
        inkTertiary: '#83838b',
        inkCaption: '#6d6d75',
        icon: '#cfcfd6',
        border1: '#ffffff14',
        border2: '#ffffff24',
        border3: '#ffffff2e',
        border4: '#ffffff3d'
      }
    },
    shadow: {
      light: {
        stroke: '#00000029',
        lv1: '0 1px 2px 0 #0000000f',
        lv1blur: '0 4px 12px 0 #0000000a',
        lv2: '0 4px 12px 0 #0000000a, 0 2px 8px 0 #00000012',
        lv3: '0 0 1px 0 #00000029, 0 5px 14px 0 #00000012, 0 16px 38px 0 #0000001f',
        panel: '0 3px 8px 0 #0000000f, 0 0 16px 0 #0000000a',
        prominent: '0 5px 14px 0 #00000017, 0 0 22px 0 #00000017',
        soft: '0 6px 20px 0 #00000014, 0 0 28px 0 #0000000f'
      },
      dark: {
        stroke: '#ffffff2b',
        lv1: '0 1px 2px 0 #00000047',
        lv1blur: '0 4px 12px 0 #00000033',
        lv2: '0 4px 14px 0 #00000038, 0 2px 8px 0 #00000042',
        lv3: '0 0 1px 0 #0000007a, 0 6px 18px 0 #00000042, 0 16px 40px 0 #0000005c',
        panel: '0 3px 10px 0 #00000042, 0 0 18px 0 #00000038',
        prominent: '0 6px 18px 0 #00000052, 0 0 26px 0 #00000042',
        soft: '0 8px 26px 0 #0000004d, 0 0 32px 0 #00000038'
      }
    },
    ambient: {
      light: ['#64748b14', '#94a3b80f'],
      dark: ['#94a3b81a', '#64748b14']
    }
  },
  {
    id: 'paper',
    name: '纸感',
    tagline: '暖白墨色 · 阅读',
    swatch: ['#a8492a', '#f3efe6', '#17150f'],
    neutral: {
      light: {
        canvas: '#faf8f3',
        surface1: '#fffdf8',
        surface2: '#fffdf8',
        surface3: '#fffdf8',
        sidebar: '#f3efe6',
        overlay: '#e8e0d0',
        module: '#f6f2e9',
        input: '#fffdf8',
        code: '#f6f2e9',
        codeBanner: '#efe9dc',
        inlineCode: '#f2ede2',
        citation: '#f2ede2',
        tag: '#f2ede2',
        placeholder: '#f6f2e9',
        menu: '#fffcf6d9',
        menuHeader: '#fffcf6f2',
        toast: '#332e24',
        scrollbar: '#d4c9b4',
        scrollbarHover: '#b9ab90',
        switchThumb: '#fffdf8',
        documentPreview: '#f3efe6',
        documentPreviewLabel: '#5d5443',
        ink: '#1f1b14',
        inkDimmed: '#3a3325',
        inkSecondary: '#5d5443',
        inkTertiary: '#8a7f6a',
        inkCaption: '#a89c85',
        icon: '#4a4234',
        border1: '#3a2f1f1a',
        border2: '#3a2f1f24',
        border3: '#3a2f1f30',
        border4: '#3a2f1f40'
      },
      dark: {
        canvas: '#17150f',
        surface1: '#211e16',
        surface2: '#2a261c',
        surface3: '#332e22',
        sidebar: '#1b1811',
        overlay: '#3d3728',
        module: '#332e22',
        input: '#211e16',
        code: '#1b1813',
        codeBanner: '#231f18',
        inlineCode: '#2a261c',
        citation: '#332e22',
        tag: '#332e22',
        placeholder: '#2a261c',
        menu: '#26221ad9',
        menuHeader: '#1f1c15f2',
        toast: '#3d3728',
        scrollbar: '#544c3b',
        scrollbarHover: '#6b6250',
        switchThumb: '#b8ab92',
        documentPreview: '#17150f',
        documentPreviewLabel: '#d4c9b4',
        ink: '#f3eee3',
        inkDimmed: '#e3dccd',
        inkSecondary: '#c0b6a2',
        inkTertiary: '#958b78',
        inkCaption: '#7d7462',
        icon: '#d3c8b4',
        border1: '#ffffff17',
        border2: '#ffffff26',
        border3: '#ffffff33',
        border4: '#ffffff45'
      }
    },
    shadow: {
      light: {
        stroke: '#3a2f1f2e',
        lv1: '0 1px 2px 0 #3a2f1f0f',
        lv1blur: '0 4px 12px 0 #3a2f1f0a',
        lv2: '0 4px 12px 0 #3a2f1f0a, 0 2px 8px 0 #3a2f1f12',
        lv3: '0 0 1px 0 #3a2f1f29, 0 5px 14px 0 #3a2f1f12, 0 16px 38px 0 #3a2f1f1f',
        panel: '0 3px 8px 0 #3a2f1f0f, 0 0 16px 0 #3a2f1f0a',
        prominent: '0 5px 14px 0 #3a2f1f17, 0 0 22px 0 #3a2f1f17',
        soft: '0 6px 20px 0 #3a2f1f14, 0 0 28px 0 #3a2f1f0f'
      },
      dark: {
        stroke: '#ffffff2e',
        lv1: '0 1px 2px 0 #00000052',
        lv1blur: '0 4px 12px 0 #0000003d',
        lv2: '0 4px 14px 0 #00000042, 0 2px 8px 0 #0000004d',
        lv3: '0 0 1px 0 #00000085, 0 6px 18px 0 #0000004d, 0 16px 40px 0 #00000066',
        panel: '0 3px 10px 0 #0000004d, 0 0 18px 0 #00000042',
        prominent: '0 6px 18px 0 #0000005c, 0 0 26px 0 #0000004d',
        soft: '0 8px 26px 0 #00000057, 0 0 32px 0 #00000042'
      }
    },
    ambient: {
      light: ['#c2803a1f', '#8a5a2b14'],
      dark: ['#d99a4a1f', '#a86a3014']
    }
  }
]

/** 精修排版时替换的字体栈。中文回退顺序按 Windows/macOS 实际可用性排列。 */
const FONT_STACK = {
  ui: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans SC", "Helvetica Neue", Helvetica, Arial, sans-serif',
  code: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", "SF Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, "PingFang SC", "Microsoft YaHei", monospace'
}

/** 三档圆角对应的宿主令牌名。 */
const RADIUS_TOKENS = {
  xs: '--dsw-radius-xs',
  sm: '--dsw-radius-sm',
  md: '--dsw-radius-md',
  lg: '--dsw-radius-lg',
  xl: '--dsw-radius-xl',
  panel: '--dsw-radius-panel'
}

/**
 * 浅染比例。宿主多处把强调色的淡染层当**背景**用（Tag 语气、徽标、更新指示），
 * 而这些层由程序算出而不是用户挑的，因此比例也在这里集中定义。
 */
const TINTS = Object.freeze({
  /** ui-primitives 的 Tag info 语气：`color-mix(accent 10%, transparent)`。 */
  tag: 0.1,
  /** 插件自己的侧栏选中底：长期驻留视野，淡一些。 */
  navActive: 0.13,
  navActiveDark: 0.16,
  /** 徽标底（宿主 .badge 直接改用该令牌）。 */
  badge: 0.12,
  badgeDark: 0.18
})

/**
 * 快捷键键帽底板与气泡底的最低可分辨度。
 *
 * 官方是 2.00（浅色）/ 1.82（深色），所以 2.0 是「至少不输给官方」这条线。
 * v1.1 的固定 18% 白混只有 1.75 —— 阈值原本写在契约里是 1.3，等于没有约束。
 */
const TOOLTIP_KEY_MIN = 2

/**
 * 思考态扫光朝画布退让的比例。
 *
 * 官方那一对（正文 / 扫光）的可分辨度是 1.6 上下 —— 它本来就是一道
 * 「若有若无」的微光，因此这里不能按 3:1 去解，只能复刻那种强度。
 * 42% 是实测能让 56 组组合都落在 1.5 以上、又不超过 3.0 的取值：
 * 再小会让扫光与正文糊在一起，再大就成了一道真正的条纹。
 */
const THINK_SHIMMER_MIX = 0.42

/**
 * 让一个文字色对**一整组**背景都达标。
 *
 * 文字不总是落在画布上：同一段灰字会出现在画布、卡片、代码块、侧栏上。
 * 只对画布求解是不够的 —— 代码块底色比卡片暗一档，那里往往才是最先读不清的地方
 * （实测三级文字在代码块上比在卡片上低 0.3–0.4）。
 *
 * `scripts/check.mjs` 有一条断言要求这组背景同属亮侧或暗侧：混侧时可行区间可能
 * 为空，而那不是本插件会遇到的情形，应当构建期失败而不是运行期给出奇怪的颜色。
 *
 * @param color - 起始文字色。
 * @param backgrounds - 该文字可能压在其上的全部背景。
 * @param target - 目标对比度。
 */
function ensureContrastAllSurfaces(color, backgrounds, target) {
  return solveTone(color, backgrounds, target)
}

/**
 * 自指约束的求解余量。
 *
 * 自指约束（背景由被求解的颜色自己派生）在迭代里收敛到**边界**上：最后一轮解出的
 * 颜色，其派生的背景是用上一轮颜色算的，两者相差一个 8 位色的舍入量。实测这会
 * 让最差的一处停在 4.47 而非 4.50。给目标加一点余量，把结果推离边界，
 * 而不是把断言放宽到 4.4 —— 后者会让真正的回归悄悄通过。
 */
const SELF_REFERENTIAL_MARGIN = 0.15

/**
 * 求解结果的缓存。
 *
 * 求解是纯函数（输入只有强调色与预设），但一次要跑 2 轮 × 约 40 条约束 × 26 步
 * 二分，实测约 7ms。面板每次渲染都会调 `buildTokens`，静态审计要跑 1344 种状态
 * 组合 —— 不缓存的话审计要多花十几秒，面板拨开关时也会掉帧。
 *
 * 键是「强调色 id | 预设 id」：两者都不变，结果必然相同（求解不读任何全局状态）。
 */
const accentCache = new Map()
const syntaxCache = new Map()

/**
 * 求解一个强调色的两个明暗取值。
 *
 * ## 为什么只有一支，而不是「填充支 + 文字支」
 * 试过拆两支（填充只对压在其上的文字负责、文字对全部表面负责），但实测两支的
 * 解只差 1–2 个色阶（例如 `#2357d6` 与 `#2254d0`）—— 肉眼完全不可区分，
 * 却让「同一个强调色」变成两个不同的值，用户看到的主按钮与链接会有一丝对不上，
 * 维护者也要多记一条规则。**一个强调色就是一个身份色**，因此这里只解一支，
 * 让它同时满足全部约束。
 *
 * ## 约束从哪来
 * 强调色在本插件里承担三种角色，每一种都有对侧的约束：
 *
 *   1. **当底**：白字（浅色）/ 近黑字（深色）压在其上 —— 主按钮、开关轨道、
 *      StateDot、以及 ui-conversation 那个 34px 圆形按钮。
 *   2. **当文字**：压在全部表面色上 —— 链接、品牌文字、Tag 语气、业务强调。
 *   3. **当浅染层的来源**：淡染层本身是背景，而它上面又要压强调色文字（自指）。
 *      最典型的是 ui-user-questions 的徽标：底色是
 *      `--dsw-specific-sidebar-nav-item-active-accent`（本色的淡染），
 *      文字是 `--dsw-alias-button-info-fill`（本色自己）。
 *
 * ## 为什么是迭代
 * 第 3 类约束的背景**由强调色自己派生**，所以「解强调色」与「算淡染层」互为因果。
 * 一遍求解用的是旧色算出的淡染层；用解出的新色重算后可能又差一点。实测一遍的
 * 余量是 4.33（目标 4.5），两遍收敛到 4.5 以上。第三轮起收益低于 8 位色的可
 * 分辨精度，因此固定两轮 —— 轮数写成常量，而不是「跑到收敛为止」。
 *
 * @param accent - 强调色条目（含 `light` / `dark` 原始色）。
 * @param preset - 预设条目（提供表面色）。
 * @returns `{ light, dark }` 求解后的实色。
 */
function solveAccent(accent, preset) {
  const cacheKey = `${accent.id}|${preset.id}`
  const hit = accentCache.get(cacheKey)
  if (hit !== undefined) return hit

  const out = {}
  for (const mode of ['light', 'dark']) {
    const neutral = preset.neutral[mode]
    const surfaces = surfaceColors(neutral)
    // 压在强调色填充上的文字：浅色是纯白，深色是近黑（都是宿主的官方取值，
    // 见 readability.js 的 HOST_FALLBACK —— 插件有意不覆盖那个令牌）。
    const onAccent = mode === 'light' ? '#ffffff' : '#0f1115'
    const navAmount = mode === 'light' ? TINTS.navActive : TINTS.navActiveDark
    const badgeAmount = mode === 'light' ? TINTS.badge : TINTS.badgeDark

    let color = accent[mode]
    for (let pass = 0; pass < 2; pass += 1) {
      const layers = []
      for (const surface of surfaces) {
        layers.push(
          tint(surface, color, TINTS.tag),
          tint(surface, color, navAmount),
          tint(surface, color, badgeAmount)
        )
      }
      layers.push(tint(neutral.sidebar, color, navAmount))
      layers.push(tint(neutral.sidebar, color, badgeAmount))
      const solved = solveColor(color, [
        // 1. 当底：压在上面的文字读得出来
        { against: onAccent, target: AA },
        // 2. 当文字：压在全部表面上
        ...surfaces.map((surface) => ({ against: surface, target: AA })),
        // 3. 当文字：压在自己的淡染层上（自指，留一点余量）
        ...layers.map((layer) => ({ against: layer, target: AA + SELF_REFERENTIAL_MARGIN }))
      ])
      // 无解时保留上一轮的值：`scripts/check.mjs` 的断言会把它变成构建期失败，
      // 而不是在这里悄悄塞一个不达标的颜色。
      if (solved === null) break
      color = solved
    }
    out[mode] = color
  }
  accentCache.set(cacheKey, out)
  return out
}

/**
 * 求解语法着色。
 *
 * 宿主的 `shiki.css` 把九个 token 色写死在 `:root` / `[data-ds-dark-theme]` 上，
 * 深浅两套**都与主题绑定**，却不随插件的预设走。插件改了代码块底色
 * （`--dsw-alias-markdown-code-block`）之后，这些色就落在了一个它们从未被设计过的
 * 底上：浅色下九个里有六个低于 AA，最差的注释只有 2.97 —— 官方底上本来也只有 3.18，
 * 但插件把纸感的底压得更暖之后又低了 0.21。
 *
 * 修法是**接管这九个令牌**，按当前代码块底色求解到 AA，并且保持色相 ——
 * 语法高亮的可读性来自「这几类 token 互相可区分」，而区分靠的是色相，
 * 不是明度。因此这里只沿明度轴移动，不动色相。
 *
 * 深色下宿主的九个色本来就有 6.95 以上，求解器会原样返回 —— 实测确实一个都没变。
 *
 * @param shiki - 宿主原始 token 色（`{ light, dark }` 两张表）。
 * @param preset - 预设条目（提供代码块底色）。
 */
function solveSyntax(shiki, preset) {
  const cacheKey = preset.id
  const hit = syntaxCache.get(cacheKey)
  if (hit !== undefined) return hit

  const out = {}
  for (const mode of ['light', 'dark']) {
    const background = preset.neutral[mode].code
    const table = {}
    for (const name of SYNTAX_TOKENS) {
      table[name] = ensureContrast(shiki[mode][name], background, AA)
    }
    out[mode] = table
  }
  syntaxCache.set(cacheKey, out)
  return out
}

/** 宿主 `theme/shiki.css` 的九个 token 色，逐字节照抄。求解器以此为起点。 */
const HOST_SHIKI = Object.freeze({
  light: Object.freeze({
    constant: '#1c7ed6',
    string: '#2f9e44',
    comment: '#868e96',
    keyword: '#d6336c',
    parameter: '#e8590c',
    function: '#6741d9',
    'string-expression': '#2b8a3e',
    punctuation: '#495057',
    link: '#1971c2'
  }),
  dark: Object.freeze({
    constant: '#4dabf7',
    string: '#69db7c',
    comment: '#adb5bd',
    keyword: '#faa2c1',
    parameter: '#ffa94d',
    function: '#b197fc',
    'string-expression': '#8ce99a',
    punctuation: '#ced4da',
    link: '#74c0fc'
  })
})

/**
 * 宿主 `design_platform.css` 的语义色，逐字节照抄。求解器以此为起点。
 *
 * ## 为什么语义色与强调色是两套，而且都不共用
 * 强调色是**用户的身份色**（品牌、按钮、链接），语义色是**状态的语言**：
 * 绿 = 成功、琥珀 = 警告、红 = 危险。后者的色相不是审美选择，而是一条被反复
 * 学习的约定 —— 把「危险」换成紫色，界面就不再可信。
 *
 * 因此这里的处理与强调色**正好相反**：
 *   · 强调色：色相由用户挑，明度由求解器决定（只保证读得出来）；
 *   · 语义色：色相与饱和度锁死（约定不可动），只沿明度轴移动到读得出来。
 * 两者都只动明度，但理由不同，`scripts/check.mjs` 也分别断言。
 *
 * ## 种子为什么是「宿主的两支」
 * 宿主的语义色在浅色/深色两套里几乎相同（绿-500 与琥珀-500 两边都用），
 * 只有危险色的浅色档用了更深的红-600。照抄宿主而不是自选，是为了让
 * 「插件之前的界面」与「插件之后的界面」在同一套语言里 ——
 * 用户看到的仍然是那个绿，只是终于读得出来了。
 */
const HOST_SEMANTIC = Object.freeze({
  light: Object.freeze({
    success: '#22c55e',
    successSoft: '#4ed17e',
    warn: '#f59e0b',
    warnSoft: '#f7ad31',
    error: '#ec1313',
    errorSoft: '#f25a5a'
  }),
  dark: Object.freeze({
    success: '#22c55e',
    successSoft: '#4ed17e',
    warn: '#f59e0b',
    warnSoft: '#f7ad31',
    error: '#f25a5a',
    errorSoft: '#f25a5a'
  })
})

/**
 * 语义色的淡染比例，取自宿主 `Tag.module.css` 的原始注释：
 * 「The tint is 10%, except `warning`, which keeps the 12%」。
 * 这三个语气（success / warning / danger）与 v1.2 已经求解过的 `info` 语气
 * 是同一张样式表里隔几行的兄弟规则，比例也照抄，唯一的改动是**把颜色解出来**。
 */
const SEMANTIC_WASH = Object.freeze({ success: 0.1, warn: 0.12, error: 0.1 })

/** 差异视图的整行淡染比例，取自宿主 `--dsw-static-green-500-a08/a12`。 */
const DIFF_WASH = Object.freeze({ light: 0.08, dark: 0.12 })

/** 深色下调色板键名 → 语义族成员。 */
const SEMANTIC_MEMBERS = Object.freeze([
  ['success', 'successSoft'],
  ['warn', 'warnSoft'],
  ['error', 'errorSoft']
])

const semanticCache = new Map()

/**
 * 求解一个预设的语义色（四支：成功 / 警告 / 危险，各含一支「柔和档」）。
 *
 * ## 约束从哪来
 * 与强调色同一个套路，但这次的**每一条都有消费者**：
 *
 *   1. **当文字**：压在全部表面色与画布上 —— `.failed` 的保存失败提示、
 *      菜单里的危险项、（柔和档的）shortcuts / plugin-manager 内联样式；
 *   2. **当文字，压在自己的淡染层上**：Tag 的 success / warning / danger 语气
 *      （`color-mix(色 10%/12%, transparent)` + `color: 色`），这是一处**自指**约束，
 *      因此与强调色一样迭代两轮；
 *   3. **当底色**：`.brokenBadge` 把危险色铺成徽标底，字是 `--dsw-alias-bg-layer-3`
 *      —— 也就是插件的 surface3。**只有危险色有这条消费者**，所以只有它带这条约束：
 *      给成功与警告加一条不存在的需求，只会让它们的明度被推着走。
 *
 * 轻提示上的那一对**不在**约束里，也解不出来 —— 见 `readability.js` 的 INFEASIBLE。
 *
 * @param preset - 预设条目（提供表面色与画布）。
 * @returns `{ light, dark }`，每侧含 `success/successSoft/warn/warnSoft/error/errorSoft`。
 */
function solveSemantic(preset) {
  const cacheKey = preset.id
  const hit = semanticCache.get(cacheKey)
  if (hit !== undefined) return hit

  const out = {}
  for (const mode of ['light', 'dark']) {
    const neutral = preset.neutral[mode]
    const surfaces = surfaceColors(neutral)
    const all = [...surfaces, neutral.canvas]
    const seeds = HOST_SEMANTIC[mode]
    const result = {}

    for (const [base, soft] of SEMANTIC_MEMBERS) {
      const wash = SEMANTIC_WASH[base]
      let color = seeds[base]
      for (let pass = 0; pass < 2; pass += 1) {
        const layers = all.map((surface) => tint(surface, color, wash))
        const requirements = [
          // 1. 当文字：压在全部表面与画布上
          ...all.map((surface) => ({ against: surface, target: AA })),
          // 菜单材质是半透明的，落点仍以画布计
          { against: neutral.menu, target: AA },
          // 2. 当文字：压在自己的淡染层上（自指，留余量）
          ...layers.map((layer) => ({ against: layer, target: AA + SELF_REFERENTIAL_MARGIN }))
        ]
        // 3. 当底色：只有危险色有这条消费者（.brokenBadge）
        if (base === 'error') {
          requirements.push({ against: neutral.surface3, target: AA })
        }
        const solved = solveColor(color, requirements)
        if (solved === null) break
        color = solved
      }
      result[base] = color
      // 柔和档：宿主的 green-400 / amber-400 是「同色相、更低饱和度」的一档，
      // 它同样被当文字用（shortcuts / plugin-manager），所以也解到 AA。
      // 一次把全部约束交给求解器 —— 逐个表面反复调用会让前一个表面的结论
      // 被后一个表面推翻（最后一次调用说了算），那是错的。
      result[soft] =
        solveColor(
          seeds[soft],
          all.map((surface) => ({ against: surface, target: AA }))
        ) ?? seeds[soft]
    }
    out[mode] = result
  }
  semanticCache.set(cacheKey, out)
  return out
}

/**
 * 面板色板要显示的颜色 —— **求解后**的取值，而不是配色表里的原始值。
 *
 * 为什么必须求解后再显示：求解会沿明度轴微调强调色（最多约 11%），如果色板画的是
 * 原始值、界面用的是求解值，用户就会看到「我选的那个颜色和我得到的不一样」。
 * 色板上的那一点必须是最终会渲染出来的那一点，否则这一版新增的求解就成了
 * 一件用户看不见、也无法预期的事。
 *
 * @param presetId - 当前预设 id（求解依赖预设的表面色）。
 * @returns `{ [accentId]: { light, dark } }`。
 */
function accentSwatches(presetId) {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
  const out = {}
  for (const accent of ACCENTS) out[accent.id] = solveAccent(accent, preset)
  return out
}

/**
 * 由「预设 + 强调色 + 圆角 + 若干开关」算出完整的令牌覆盖层。
 *
 * @param state - 当前外观状态（见 state.js 的 normalizeState）。
 * @returns 令牌名 → { light, dark }。
 */
function buildTokens(state) {
  const preset = PRESETS.find((p) => p.id === state.preset) ?? PRESETS[0]
  const accentEntry = ACCENTS.find((a) => a.id === state.accent) ?? ACCENTS[0]
  const radius = RADIUS_SCALES.find((r) => r.id === state.radius) ?? RADIUS_SCALES[1]
  const corner = CORNER_SHAPES.find((c) => c.id === state.corner) ?? CORNER_SHAPES[1]
  const L = preset.neutral.light
  const D = preset.neutral.dark
  const SL = preset.shadow.light
  const SD = preset.shadow.dark

  /**
   * 强调色与它的派生量在这里统一解出来。
   * 手写取值只提供色相与饱和度，明度由求解器按可读性契约决定 —— 见 `solveAccent`。
   */
  const accent = solveAccent(accentEntry, preset)
  const semantic = solveSemantic(preset)
  const syntax = solveSyntax(HOST_SHIKI, preset)

  /**
   * 文字阶梯也过一遍求解：四个预设的墨色是美术选择，但「三级文字能不能读」
   * 不该由美术选择决定。实测石墨与纸感的浅色下三级文字只有 3.65 / 3.88，
   * 比官方基线（3.71）还低 —— 求解器把它们抬到 AA。
   *
   * ## v1.3：把「悬停淡染层」也算进去
   * 这一族此前只对**平面**表面求解，而宿主动辄把 `--dsw-alias-interactive-bg-hover`
   * 铺在文字底下（`Menu.module.css` 的 `.item:hover`，行里还有 11px 的
   * `.shortcutKeys` 与 `.label`）。深色模式下强调色是亮色，那层 12% 的罩层把
   * 深底**提亮**，于是同一段灰字的有效底变亮了：
   *
   *   石墨 + 石墨灰 + 深色，卡片上的 caption 从 3.x 掉到 **2.06**（目标 3）、
   *   tertiary 掉到 **3.06**（目标 4.5）—— 全 1680 组「文字 × 悬停底」里
   *   **969 组低于自己的档位**。
   *
   * 这是「契约的输入集少了一类底」的典型：不是算错，是没算 —— 与 v1.2 漏掉
   * 输入框占位文字、v1.3 漏掉语义色是同一类。修法是把这两层加进 `all`，
   * 让整支阶梯在**它真正会落在的所有底**上都达标。
   *
   * ## 哪几级进得了这个约束集，是算出来的，不是挑出来的
   * 罩层把深色底**提亮**，于是「最亮的那支墨还能不能达标」变成一条算术题：
   * 底越亮，纯白能拿到的对比度越低。实测最亮的那层（surface3 + 按下罩层）
   * 相对亮度 0.057，**纯白对它也只有 9.8:1** —— 于是：
   *
   *   · tertiary(4.5) / caption(3) / secondary(5.5) / icon(3)：可行，纳入；
   *   · primary(12) 与 dimmed(9)：**数学上不可行**（12 需要底 ≤0.0375）。
   *
   * 这两级因此保持「对平面表面求解」：它们的高底线是稳态界面的美术标准，
   * 而不是一个瞬态底色上的承诺。悬停时它们仍然读得出来（实测最低 8.6:1，
   * 高于 AAA 的 7），只是不再满足插件自定的 12 —— `scripts/check.mjs`
   * 会把这个实测值连同它的来源一起钉住，而不是让这条界线消失在注释里。
   */
  const HOVER_WASH = { light: 0.08, dark: 0.12 }
  const ACTIVE_WASH = { light: 0.14, dark: 0.2 }
  const neutralText = {}
  for (const mode of ['light', 'dark']) {
    const neutral = preset.neutral[mode]
    const surfaces = surfaceColors(neutral)
    const canvas = neutral.canvas
    const accentColor = accent[mode]
    const flat = [...surfaces, canvas]
    /** 悬停 / 按下时文字真正压在什么上：强调色罩层合成到每一支平面底上。 */
    const washed = flat.flatMap((surface) => [
      tint(surface, accentColor, HOVER_WASH[mode]),
      tint(surface, accentColor, ACTIVE_WASH[mode])
    ])
    const transient = [...flat, ...washed]
    neutralText[mode] = {
      ink: solveTone(neutral.ink, flat, TEXT_TIERS.primary),
      inkDimmed: ensureContrastAllSurfaces(neutral.inkDimmed, flat, TEXT_TIERS.dimmed),
      inkSecondary: ensureContrastAllSurfaces(
        neutral.inkSecondary,
        transient,
        TEXT_TIERS.secondary
      ),
      inkTertiary: ensureContrastAllSurfaces(
        neutral.inkTertiary,
        transient,
        TEXT_TIERS.tertiary
      ),
      inkCaption: ensureContrastAllSurfaces(
        neutral.inkCaption,
        transient,
        TEXT_TIERS.caption
      ),
      // 占位文字（`--dsw-alias-label-dimmed`）是**正文**，不是描边：
      // 宿主唯一的消费者是 `.input::placeholder`，14px。v1.1 把它绑在描边色上，
      // 实测只有 1.48–2.00:1。这里从说明文字那支墨出发解到 AA ——
      // 从 inkCaption 起步而不是 inkTertiary，是为了让占位文字比三级文字淡一点，
      // 保持「提示 < 正文」的层级感。输入框不会悬停变色，因此仍按平面底求解。
      placeholder: ensureContrastAllSurfaces(neutral.inkCaption, flat, AA),
      icon: ensureContrastAllSurfaces(neutral.icon, transient, NON_TEXT)
    }
  }

  /** 令牌表。先铺中性骨架，再叠强调色派生量，便于审阅。 */
  const tokens = {}

  // ---- 画布与表面 ---------------------------------------------------------
  tokens['--dsw-alias-bg-base'] = t(L.canvas, D.canvas)
  tokens['--dsw-alias-bg-layer-1'] = t(L.surface1, D.surface1)
  tokens['--dsw-alias-bg-layer-2'] = t(L.surface2, D.surface2)
  tokens['--dsw-alias-bg-layer-3'] = t(L.surface3, D.surface3)
  tokens['--dsw-specific-sidebar-fill'] = t(L.sidebar, D.sidebar)
  tokens['--dsw-alias-bg-overlay'] = t(L.overlay, D.overlay)
  tokens['--dsw-alias-bg-module-platform'] = t(L.module, D.module)
  tokens['--dsw-alias-bg-multi-select'] = t(L.module, D.module)
  tokens['--dsw-specific-input-major'] = t(L.input, D.input)
  tokens['--dsw-specific-login-input'] = t(L.module, D.input)
  tokens['--dsw-specific-tip'] = t(L.module, D.module)
  tokens['--dsw-specific-selector'] = t(L.module, D.module)

  // ---- 侧栏导航 -----------------------------------------------------------
  // 选中态用强调色「淡染」surface，而不是铺满强调色：侧栏是长期停留在视野里的
  // 区域，高饱和实色会在几分钟内变成视觉噪音。
  tokens['--dsw-specific-sidebar-nav-item-active'] = t(
    tint(L.sidebar, accent.light, TINTS.navActive),
    tint(D.sidebar, accent.dark, TINTS.navActiveDark)
  )
  // **这是 v1.2 修掉的一处真实缺陷，也是本版最严重的一处。**
  // 宿主把它当徽标**底色**用（ui-user-questions：
  // `.badge { background: 该令牌; color: var(--dsw-alias-button-info-fill) }`）。
  // v1.1 在这里写的是完整强调色，而 `button-info-fill` 用的也是同一个强调色 ——
  // 于是徽标的字与底**完全同色**，对比度 1.00，字数完全消失。
  //
  // 现在它是一层淡染，与官方语义一致（浅色 deepseek-100、深色 bluish-800
  // 都是「同系但更接近底色的浅染层」，而不是强调色本体）。
  tokens['--dsw-specific-sidebar-nav-item-active-accent'] = t(
    tint(L.sidebar, accent.light, TINTS.badge),
    tint(D.sidebar, accent.dark, TINTS.badgeDark)
  )
  tokens['--dsw-specific-sidebar-nav-item-hover'] = t(
    tint(L.sidebar, accent.light, 0.06),
    tint(D.sidebar, accent.dark, 0.1)
  )

  // ---- 边框 ---------------------------------------------------------------
  tokens['--dsw-alias-border-l1'] = t(L.border1, D.border1)
  tokens['--dsw-alias-border-l2'] = t(L.border2, D.border2)
  tokens['--dsw-alias-border-l2-darkmode-thin'] = t(L.border1, D.border1)
  tokens['--dsw-alias-border-l3'] = t(L.border3, D.border3)
  tokens['--dsw-alias-border-l4'] = t(L.border4, D.border4)
  // 官方把这两个写成 `transparent` —— 语义是「这个方向有意不画线」，不是
  // 「一条几乎看不见的线」。v1.1 给了它们可见的描边色，于是在官方刻意留白的
  // 位置（账户对话框、命令面板重试按钮）多出边框。v1.2 交回透明。
  tokens['--dsw-alias-border-inverted'] = t('#00000000', '#ffffff0f')
  tokens['--dsw-alias-border-inverted2'] = t('#00000000', '#ffffff14')

  // ---- 文本与图标 ---------------------------------------------------------
  tokens['--dsw-alias-label-primary'] = t(neutralText.light.ink, neutralText.dark.ink)
  tokens['--dsw-alias-label-primary-dimmed'] = t(
    neutralText.light.inkDimmed,
    neutralText.dark.inkDimmed
  )
  tokens['--dsw-alias-label-primary-inverted'] = t(L.surface1, D.surface1)
  tokens['--dsw-alias-label-secondary'] = t(
    neutralText.light.inkSecondary,
    neutralText.dark.inkSecondary
  )
  tokens['--dsw-alias-label-tertiary'] = t(
    neutralText.light.inkTertiary,
    neutralText.dark.inkTertiary
  )
  tokens['--dsw-alias-label-caption'] = t(
    neutralText.light.inkCaption,
    neutralText.dark.inkCaption
  )
  tokens['--dsw-alias-label-dimmed'] = t(
    neutralText.light.placeholder,
    neutralText.dark.placeholder
  )
  tokens['--dsw-alias-menu-icon'] = t(neutralText.light.icon, neutralText.dark.icon)
  tokens['--dsw-alias-label-primary-bluish'] = t(neutralText.light.ink, neutralText.dark.ink)

  // ---- 品牌与强调 ---------------------------------------------------------
  // 官方主题在浅色下用近黑、深色下用近白做主按钮，界面因此缺少识别色。
  // 这里把品牌位交给强调色，是整套美化里视觉收益最大的一处改动。
  //
  // 下面这一组**共用同一个求解结果**：宿主把它们分别当「底」与「字」用，
  // 但官方主题里它们的取值本来就相同（都是品牌色），因此插件也保持一致 ——
  // 一个强调色就是一个身份色，不该在按钮与链接之间出现两个色阶。
  // 求解器已把所有角色（当底承载白字、当字压遍全部表面与自指淡染层）
  // 一起算进约束，所以同一个值在两种角色下都成立。
  tokens['--dsw-alias-brand-primary'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-brand-primary-invert'] = t(L.surface1, D.canvas)
  tokens['--dsw-alias-brand-text'] = t(accent.light, accent.dark)
  // 设置里的「更新可用」指示与账户提示图标都用它当文字色，底是它自己的 8% 淡染。
  // 文字支的求解已经把 8% 淡染层算进约束里，因此这里直接复用。
  tokens['--dsw-alias-brand-primary-new-colorprimary-new-color'] = t(
    accent.light,
    accent.dark
  )
  tokens['--dsw-alias-button-primary-fill'] = t(accent.light, accent.dark)
  // 悬停色是**另一个底**，压在它上面的还是同一支前景色（白/近黑），因此它也要过
  // 一遍求解。v1.1 直接朝黑/白各混 14%/16%，实测浅色下碧波青的悬停态只有 3.5 ——
  // 比常态还低，鼠标一放上去按钮文字就糊了。
  tokens['--dsw-alias-button-primary-hover'] = t(
    solveTone(tint(accent.light, '#000000', 0.14), ['#ffffff'], AA),
    solveTone(tint(accent.dark, '#ffffff', 0.16), ['#0f1115'], AA)
  )
  tokens['--dsw-alias-button-primary-dimmed'] = t(
    tint(accent.light, L.canvas, 0.82),
    tint(accent.dark, D.canvas, 0.8)
  )
  tokens['--dsw-alias-button-info-fill'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-button-info-hover'] = t(
    solveTone(tint(accent.light, '#000000', 0.12), ['#ffffff'], AA),
    solveTone(tint(accent.dark, '#ffffff', 0.14), ['#0f1115'], AA)
  )
  tokens['--dsw-alias-state-business-primary'] = t(accent.light, accent.dark)
  // 业务浅底：Tag 的 info 语气、徽标与状态标签用它当底，强调色文字压在上面。
  // 由**文字支**派生 —— 与求解文字支时假设的淡染层一致，契约才算得准。
  tokens['--dsw-alias-state-business-tertiary'] = t(
    tint(L.surface1, accent.light, 0.12),
    tint(D.surface1, accent.dark, 0.18)
  )
  tokens['--dsw-alias-link'] = t(accent.light, accent.dark)
  tokens['--dsw-focus-ring-color'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-label-deep-diving'] = t(accent.light, accent.dark)
  // 思考态的**扫光**：宿主把 `--dsw-alias-label-shimmer` 在这一处重指到
  // `-deep-diving-shimmer`（`.running { --dsw-alias-label-shimmer: var(...-deep-diving-shimmer);
  // color: var(...-deep-diving) }`），TextShimmer 再用它把正文**再画一遍**、
  // 遮罩成一条扫过的带。因此它是「同一个色相的两个明度」，
  // v1.2 只接管了其中一支（正文 = 强调色），扫光留在宿主的蓝上 ——
  // 非蓝强调色下，扫光颜色不属于用户选的那套配色。
  // 现在两支同源：扫光 = 强调色朝画布方向退一段，退到与正文刚好可分辨（≥1.5，
  // 官方自己那一对是 1.6 上下 —— 它本来就是一道若有若无的微光）。
  tokens['--dsw-alias-label-deep-diving-shimmer'] = t(
    tint(accent.light, L.canvas, THINK_SHIMMER_MIX),
    tint(accent.dark, D.canvas, THINK_SHIMMER_MIX)
  )

  // ---- 语义色（成功 / 警告 / 危险）---------------------------------------
  // 这是 v1.3 的主题。v1.2 把强调色解了出来，却把**同一张样式表里隔三行的
  // 兄弟规则**整族留给了宿主：Tag 的 info 语气被求解，success/warning/danger
  // 三个语气一条没算；差异视图的 `.add` 正文实测只有 **1.91:1**。
  // 理由与做法见 solveSemantic —— 色相锁死、只动明度。
  //
  // 这里**没有开关**：它不是一种「口味」，而是一处与 v1.2 同类（甚至更明显）的
  // 可读性缺陷 —— 「通过」徽标的正文、差异视图的新增行正文，都是要被读的内容。
  // v1.2 也没有为「把字解到达标」提供开关。
  tokens['--dsw-alias-state-success-primary'] = t(
    semantic.light.success,
    semantic.dark.success
  )
  // 淡染层：与 Tag 的 `color-mix(色 10%, transparent)` 同源，
  // 只是把它落成实色（宿主把它当 ConnectionIndicator 的底）。
  tokens['--dsw-alias-state-success-tertiary'] = t(
    tint(L.surface1, semantic.light.success, SEMANTIC_WASH.success),
    tint(D.surface1, semantic.dark.success, SEMANTIC_WASH.success)
  )
  tokens['--dsw-alias-state-success-secondary'] = t(
    semantic.light.successSoft,
    semantic.dark.successSoft
  )
  tokens['--dsw-alias-state-warn-primary'] = t(semantic.light.warn, semantic.dark.warn)
  tokens['--dsw-alias-state-warn-tertiary'] = t(
    tint(L.surface1, semantic.light.warn, SEMANTIC_WASH.warn),
    tint(D.surface1, semantic.dark.warn, SEMANTIC_WASH.warn)
  )
  // 宿主的 label 与 primary 是两支琥珀（600 / 500）。插件的求解已经保证了
  // 「同色相 + 压得住自己的淡染层」，再分两支只会让它们各自解到不同明度、
  // 于是在连接指示里同时出现两种琥珀。合成一支 —— 一个状态一个颜色。
  tokens['--dsw-alias-state-warn-label'] = t(semantic.light.warn, semantic.dark.warn)
  tokens['--dsw-alias-state-warn-secondary'] = t(
    semantic.light.warnSoft,
    semantic.dark.warnSoft
  )
  tokens['--dsw-alias-state-error-primary'] = t(semantic.light.error, semantic.dark.error)
  tokens['--dsw-alias-state-error-secondary'] = t(
    semantic.light.errorSoft,
    semantic.dark.errorSoft
  )
  // `--dsw-alias-state-idle-primary` **刻意不接管**：它是「待处理」状态点的
  // 弱化档，宿主的 1.5:1 是有意为之。理由写在 readability.js 的 UNCOVERED。

  // 差异视图的整行淡染：宿主用的是 8%（浅色）/ 12%（深色）的 alpha 绿红，
  // 由浏览器合成在半透明层上。这里保持同样的语义（一层随底色走的淡染），
  // 只把颜色换成求解后的语义色 —— 于是 `.add` 的正文终于对得上它的底。
  tokens['--dsw-alias-code-diff-added'] = t(
    alpha(semantic.light.success, DIFF_WASH.light),
    alpha(semantic.dark.success, DIFF_WASH.dark)
  )
  tokens['--dsw-alias-code-diff-deleted'] = t(
    alpha(semantic.light.error, DIFF_WASH.light),
    alpha(semantic.dark.error, DIFF_WASH.dark)
  )
  // 文件级差异：整块底、行号槽、左侧标记。宿主这三支是写死的十六进制
  // （浅色 `#e6f4e7` / `#edf7ed` / `#01a241`），完全不随预设走 ——
  // 在纸感（暖白）与午夜（冷黑）上都是一块突兀的冷绿。现在按同一支语义色
  // 在画布上派生：行底掺 10%，行号槽掺 5%（宿主的槽比行**更淡**，两种明暗都是），
  // 标记用求解后的本色。
  for (const [family, [light, dark]] of [
    ['added', [semantic.light.success, semantic.dark.success]],
    ['deleted', [semantic.light.error, semantic.dark.error]]
  ]) {
    tokens[`--dsw-alias-file-diff-${family}-bg`] = t(
      tint(L.canvas, light, 0.1),
      tint(D.canvas, dark, 0.1)
    )
    tokens[`--dsw-alias-file-diff-${family}-gutter`] = t(
      tint(L.canvas, light, 0.05),
      tint(D.canvas, dark, 0.05)
    )
    tokens[`--dsw-alias-file-diff-${family}-marker`] = t(light, dark)
  }
  tokens['--dsw-alias-interactive-bg-hover-danger'] = t(
    alpha(semantic.light.error, 0.08),
    alpha(semantic.dark.error, 0.15)
  )

  // ---- 宿主缺口的修正 -----------------------------------------------------
  // 这两个令牌**宿主从未声明过**，却有组件在消费它们。这不是猜测：
  // `scripts/audit-consumers.mjs` 把「被消费、却从未声明」的令牌从宿主样式与
  // 51 个 bundle 里枚举出来（见 reference/host-consumers.json），它们就在那张表里。
  // 缺失的后果各不相同，但都是静默的：
  //
  //   · `--dsw-alias-label-error` —— `color: var(--该令牌)` 在计算值阶段成为
  //     guaranteed-invalid，`color` 于是按 `unset` 处理（= 继承）。
  //     结果：设置页的「保存失败」提示用的是正文墨色，与普通文字一模一样，
  //     用户看不出这次保存失败了。
  //   · `--dsw-alias-bg-layer-4` —— 同理，`background` 落到 initial（transparent）。
  //     结果：设置页那个「?」帮助按钮悬停时没有底色反馈。
  //
  // 修法就是把这两支补上，并从预设里取值 —— 与 v1.0 修灯箱关闭按钮同属一类：
  // 不改宿主，只把它漏掉的那一格填上。
  tokens['--dsw-alias-label-error'] = t(semantic.light.error, semantic.dark.error)
  // 表面阶梯的第四级。宿主的 1/2/3 在浅色下全是纯白，第四级本来就是
  // 「悬停时那一点可见的差」；这里按同一支笔派生：浅色往墨色掺 6%，
  // 深色往白色掺 6%（深色下越高越亮），于是它天然是第 3 级之上的一档。
  tokens['--dsw-alias-bg-layer-4'] = t(
    tint(L.surface3, neutralText.light.ink, 0.06),
    tint(D.surface3, '#ffffff', 0.06)
  )

  // ---- 交互态 -------------------------------------------------------------
  // 这些淡染层之上压的是正文（`--dsw-alias-label-primary`）或强调色本身，
  // 因此淡染的来源统一用**文字支**：它比填充支更暗（浅色）/更亮（深色），
  // 用它算出来的淡染层与文字之间的对比度才不会在边缘上打滑。
  tokens['--dsw-alias-interactive-bg-hover'] = t(
    alpha(accent.light, 0.08),
    alpha(accent.dark, 0.12)
  )
  tokens['--dsw-alias-interactive-bg-active'] = t(
    alpha(accent.light, 0.14),
    alpha(accent.dark, 0.2)
  )
  tokens['--dsw-alias-interactive-bg-hover-accent'] = t(
    alpha(accent.light, 0.16),
    alpha(accent.dark, 0.22)
  )
  tokens['--dsw-alias-interactive-bg-hover-solid'] = t(
    tint(L.canvas, accent.light, 0.07),
    tint(D.canvas, accent.dark, 0.12)
  )
  // 幽灵激活态：底色之上压的是 `--dsw-alias-label-primary`（正文色），
  // 因此这里求解的是**底色**而不是文字色 —— 淡染太重会让正文读不清。
  tokens['--dsw-alias-button-ghost-active-fill'] = t(
    ensureContrast(tint(L.surface1, accent.light, 0.1), neutralText.light.ink, AA),
    ensureContrast(tint(D.surface1, accent.dark, 0.16), neutralText.dark.ink, AA)
  )
  tokens['--dsw-alias-button-ghost-active-hover'] = t(
    tint(L.surface1, accent.light, 0.16),
    tint(D.surface1, accent.dark, 0.24)
  )
  tokens['--dsw-alias-button-ghost-active-border'] = t(
    alpha(accent.light, 0.45),
    alpha(accent.dark, 0.5)
  )

  // ---- 气泡与选区 ---------------------------------------------------------
  // 官方气泡是 deepseek-50（极淡的品牌底）。这里换成极淡的强调色底，
  // 保持同样的「一眼区分说话人、但不抢戏」的强度。
  tokens['--dsw-specific-bubble'] = t(
    tint(L.surface1, accent.light, 0.09),
    tint(D.surface1, accent.dark, 0.15)
  )
  tokens['--dsw-specific-bubble-highlight'] = t(
    tint(L.surface1, accent.light, 0.19),
    tint(D.surface1, accent.dark, 0.27)
  )
  // 选区底：正文（label-primary）压在其上。32% 是官方强度，但强调色比官方蓝
  // 更深时这个叠加会明显变暗，因此由求解器把它挡在 AA 之外。
  tokens['--dsw-alias-bg-document-selection'] = t(
    alpha(accent.light, 0.32),
    alpha(accent.dark, 0.34)
  )

  // ---- 代码语法着色 -------------------------------------------------------
  // 宿主的九个 token 色写在 `:root` 上，深浅两套都与主题绑定却不随预设走。
  // 插件改了代码块底色之后它们就落在了没被设计过的底上（浅色下六个低于 AA）。
  // 这里按当前底色逐个求解，保持色相不变 —— 见 solveSyntax。
  for (const name of SYNTAX_TOKENS) {
    tokens[`--shiki-token-${name}`] = t(
      syntax.light[name],
      syntax.dark[name]
    )
  }

  // ---- 菜单与浮层 ---------------------------------------------------------
  tokens['--dsw-menu-surface-fill'] = t(L.menu, D.menu)
  tokens['--dsw-specific-menu'] = t(L.menu, D.menu)
  tokens['--dsw-alias-menu-group-header-fill'] = t(L.menuHeader, D.menuHeader)

  // ---- 代码与 Markdown ---------------------------------------------------
  tokens['--dsw-alias-markdown-code-block'] = t(L.code, D.code)
  tokens['--dsw-alias-markdown-code-block-banner'] = t(L.codeBanner, D.codeBanner)
  tokens['--dsw-alias-markdown-inline-code'] = t(L.inlineCode, D.inlineCode)
  tokens['--dsw-alias-markdown-citation'] = t(L.citation, D.citation)
  tokens['--dsw-alias-markdown-tag'] = t(L.tag, D.tag)
  tokens['--dsw-alias-markdown-placeholder'] = t(L.placeholder, D.placeholder)
  tokens['--dsw-alias-markdown-code-segment-selected'] = t(
    L.surface1,
    D.surface2
  )
  tokens['--dsw-alias-markdown-code-segment-unselected'] = t(
    L.codeBanner,
    D.code
  )
  tokens['--dsw-alias-turn-trigger-bg'] = t(L.code, D.codeBanner)

  // ---- 提示与轻提示 -------------------------------------------------------
  tokens['--dsw-alias-toast-bg'] = t(L.toast, D.toast)
  tokens['--dsw-alias-toast-label'] = t('#ffffff', '#f7f9fc')
  tokens['--dsw-alias-tooltip-bg'] = t(L.toast, D.toast)
  // 键帽底板要与气泡底**可分辨**（契约要求 ≥2.0；官方 2.00 / 1.82）。
  // v1.1 用的是固定 18% 白混，实测只有 1.75 —— 比官方还难分辨，属于
  // 「看着没问题、量出来才知道」的那一类。现在从同一个混合值出发按底线求解，
  // 解不出来就退回原值（不会为了达标把键帽变成一块突兀的亮片）。
  tokens['--dsw-alias-tooltip-key-bg'] = t(
    solveTone(tint(L.toast, '#ffffff', 0.18), [L.toast], TOOLTIP_KEY_MIN) ??
      tint(L.toast, '#ffffff', 0.18),
    solveTone(tint(D.toast, '#ffffff', 0.18), [D.toast], TOOLTIP_KEY_MIN) ??
      tint(D.toast, '#ffffff', 0.18)
  )

  // ---- 滚动条 -------------------------------------------------------------
  tokens['--dsw-alias-scrollbar-bg-l1'] = t(L.scrollbar, D.scrollbar)
  tokens['--dsw-alias-scrollbar-bg-l2'] = t(L.scrollbar, D.scrollbar)
  tokens['--dsw-alias-scrollbar-hover-l1'] = t(
    L.scrollbarHover,
    D.scrollbarHover
  )
  tokens['--dsw-alias-scrollbar-hover-l2'] = t(
    L.scrollbarHover,
    D.scrollbarHover
  )
  // 开关滑块：官方在浅色下用纯白、深色下用 bluish-400 灰。既然轨道被换成了
  // 强调色，滑块必须回到白系才读得出「亮点在轨道上滑动」——灰色滑块压在
  // 蓝色轨道上会糊成一片低对比。
  tokens['--dsw-alias-switch-thumb'] = t('#ffffff', '#eef3fb')

  // ---- 文档预览 -----------------------------------------------------------
  tokens['--dsw-alias-bg-document-preview'] = t(
    L.documentPreview,
    D.documentPreview
  )
  tokens['--dsw-alias-label-document-preview'] = t(
    L.documentPreviewLabel,
    D.documentPreviewLabel
  )

  // ---- 阴影阶（宿主只在 body 上声明，行内覆盖可达所有后代） -----------------
  tokens['--dsw-shadow-lv1'] = t(SL.lv1, SD.lv1)
  tokens['--dsw-shadow-lv1-blur'] = t(SL.lv1blur, SD.lv1blur)
  tokens['--dsw-shadow-lv2'] = t(SL.lv2, SD.lv2)
  tokens['--dsw-shadow-lv3'] = t(SL.lv3, SD.lv3)

  // ---- 高度（elevation）----------------------------------------------------
  // 宿主把这一族声明在 `body, body *` 上 —— 每个元素都自带声明，行内样式够不着。
  // 因此这里只交出「原语」，由 styles/elevation.css 以更高特异性组合成宿主令牌。
  tokens['--dshb-elev-stroke-color'] = t(SL.stroke, SD.stroke)
  tokens['--dshb-elev-panel'] = t(SL.panel, SD.panel)
  tokens['--dshb-elev-prominent'] = t(SL.prominent, SD.prominent)
  tokens['--dshb-elev-soft'] = t(SL.soft, SD.soft)

  // ---- 插件自有：氛围光 ---------------------------------------------------
  tokens['--dshb-ambient-a'] = t(preset.ambient.light[0], preset.ambient.dark[0])
  tokens['--dshb-ambient-b'] = t(preset.ambient.light[1], preset.ambient.dark[1])
  // 同色相零 alpha 的淡出终点，避免渐变边缘出现发灰的脏边（见 fadeOut）
  tokens['--dshb-ambient-a-fade'] = t(
    fadeOut(preset.ambient.light[0]),
    fadeOut(preset.ambient.dark[0])
  )
  tokens['--dshb-ambient-b-fade'] = t(
    fadeOut(preset.ambient.light[1]),
    fadeOut(preset.ambient.dark[1])
  )

  // ---- 圆角 ---------------------------------------------------------------
  for (const [key, name] of Object.entries(RADIUS_TOKENS)) {
    const px = `${radius.radii[key]}px`
    tokens[name] = t(px, px)
  }
  // 圆角形状：宿主把它声明在 `:root`、由 `*` 规则消费，因此 body 上的行内值
  // 能正常继承到全部后代（唯一够不着的是 `html` 自己，而它没有可见圆角）。
  // 取值必须是合法的 `corner-shape` 语法 —— 宿主那句 `@supports` 保证
  // 不支持的浏览器根本不会消费这个令牌，所以写错也只是静默无效，
  // 因此 check.mjs 直接断言三档的语法。
  tokens['--dsw-corner-shape'] = t(corner.css, corner.css)
  // Windows 标题栏模式下内容区左上角的那个圆角。宿主把它声明在 frame 元素上，
  // 行内值够不着，因此这里只交出原语，由 base.css 以更高特异性贴上去。
  tokens['--dshb-content-radius'] = t(
    `${radius.contentRadius}px`,
    `${radius.contentRadius}px`
  )

  // ---- 排版 ---------------------------------------------------------------
  if (state.typography) {
    tokens['--dsw-font-family'] = t(FONT_STACK.ui, FONT_STACK.ui)
    tokens['--ds-font-family-code'] = t(FONT_STACK.code, FONT_STACK.code)

    // Markdown 正文阶梯在宿主里是 body 上的复合令牌，行内覆盖可直达所有后代。
    // 官方基准行高 24px，中文与混排的舒适区在 25–26px；这里取 25px，
    // 并让标题阶梯同步 +1px，保持层级的相对距离不变。
    const base = 'var(--dsh-content-font-size, 14px)'
    const delta = 'var(--dsh-content-font-delta)'
    tokens['--dsw-font-markdown-base'] = t(
      `${base} / calc(25px + ${delta}) var(--dsw-font-family)`,
      `${base} / calc(25px + ${delta}) var(--dsw-font-family)`
    )
    const heading = (size, lead, weight) => {
      const value = `${weight} calc(${size}px + ${delta}) / calc(${lead}px + ${delta}) var(--dsw-font-family)`
      return t(value, value)
    }
    tokens['--dsw-font-markdown-h1'] = heading(21, 32, 700)
    tokens['--dsw-font-markdown-h1-line-height'] = t(
      `calc(32px + ${delta})`,
      `calc(32px + ${delta})`
    )
    tokens['--dsw-font-markdown-h2'] = heading(19, 29, 700)
    tokens['--dsw-font-markdown-h2-line-height'] = t(
      `calc(29px + ${delta})`,
      `calc(29px + ${delta})`
    )
    tokens['--dsw-font-markdown-h3'] = heading(18, 27, 650)
    tokens['--dsw-font-markdown-h3-line-height'] = t(
      `calc(27px + ${delta})`,
      `calc(27px + ${delta})`
    )
    tokens['--dsw-font-markdown-h4'] = heading(14, 25, 600)
    tokens['--dsw-font-markdown-h4-line-height'] = t(
      `calc(25px + ${delta})`,
      `calc(25px + ${delta})`
    )
  }

  // ---- 毛玻璃 -------------------------------------------------------------
  if (!state.glass) {
    // 关掉菜单/浮层的背景模糊，换成近乎不透明的填充，避免半透明层叠导致的
    // 文字对比度下降（低端 GPU 上还能省一次合成）。
    tokens['--dsw-menu-backdrop-filter'] = t('none', 'none')
    tokens['--dsw-mask-blur'] = t('none', 'none')
    tokens['--dsw-menu-surface-fill'] = t(L.surface1, D.surface2)
    tokens['--dsw-specific-menu'] = t(L.surface1, D.surface2)
    tokens['--dsw-alias-menu-group-header-fill'] = t(L.surface1, D.surface2)
  }

  return tokens
}

// ---- src/client/state.js -----------------------------------------
/**
 * 界面美化 · Lumina —— 外观状态的读写与归一化。
 *
 * 状态只描述「用户选了什么」，不含任何颜色值 —— 颜色由 presets.js 从
 * 预设 + 强调色推导。这样新增一个预设只需改 presets.js，持久化格式不变。
 *
 * 持久化用 localStorage 而不是宿主 settings 命名空间，原因有两条：
 *   1. 宿主的 settings schema 由各 feature 包自己拥有，第三方插件无法向其中
 *      增加字段（ui-theme 的 README 明确写了「第三方主题 id 仍是进程内扩展，
 *      不会跨越内置 settings schema」）；
 *   2. 这些偏好是纯展示层的，丢失只需重选，不值得占用宿主配置面的迁移成本。
 */

const STORAGE_KEY = 'dsh-ui-beautify:prefs:v1'

/** 外观状态默认值。也是任何非法输入的兜底。 */
const DEFAULT_STATE = Object.freeze({
  enabled: true,
  preset: 'aurora',
  accent: 'deepseek',
  radius: 'standard',
  corner: 'squircle',
  ambient: true,
  motion: true,
  typography: true,
  taskList: true,
  glass: true
})

const BOOLEAN_KEYS = [
  'enabled',
  'ambient',
  'motion',
  'typography',
  'taskList',
  'glass'
]
const STRING_KEYS = ['preset', 'accent', 'radius', 'corner']

/**
 * 把任意输入归一化成合法状态：未知键丢弃、非法值回落默认值。
 *
 * 读取持久化数据必须走这里 —— 用户可能降级插件版本，旧状态里会有已删除的
 * 预设 id；直接信任会让 `PRESETS.find(...)` 拿到 undefined。
 *
 * @param raw - 来自 localStorage 或面板的任意值。
 * @param options - `known` 提供各枚举键的合法取值集合。
 * @returns 全新的合法状态对象。
 */
function normalizeState(raw, options) {
  const known = options ?? {}
  const source = raw && typeof raw === 'object' ? raw : {}
  const next = { ...DEFAULT_STATE }
  for (const key of BOOLEAN_KEYS) {
    if (typeof source[key] === 'boolean') next[key] = source[key]
  }
  for (const key of STRING_KEYS) {
    const allowed = known[key]
    const value = source[key]
    if (typeof value !== 'string') continue
    // 只有在 `known` **完全没有**提供这个键时才放行任意字符串（无选项的调用路径）。
    // 提供了一张空表意味着「这个键目前没有合法取值」，那就应当回落默认值 ——
    // 旧写法把空表当成「没有约束」，于是一张空表会把拼错的值原样放进去。
    if (Array.isArray(allowed)) {
      if (allowed.includes(value)) next[key] = value
    } else {
      next[key] = value
    }
  }
  return next
}

/** 读持久化状态；任何异常（隐私模式、配额、JSON 损坏）都回落到默认值。 */
function loadState(options) {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    return normalizeState(JSON.parse(raw), options)
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/** 写持久化状态；写失败不影响本次会话内的生效（状态已在内存里）。 */
function saveState(state) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 持久化失败是可接受的降级：本次会话仍然按所选外观渲染 */
  }
}

// ---- src/client/styles.generated.js ------------------------------
/**
 * 本文件由 scripts/build.mjs 生成，请勿手工编辑。
 * 修改样式请编辑 src/client/styles/*.css，然后运行 `node scripts/build.mjs`。
 */
const STYLES = [
  ["base", "/*\n * 界面美化 · Lumina —— 基础层：画布氛围、选区、滚动条、交互过渡。\n *\n * 规则约束（与宿主 docs/web-styling 的取向一致）：\n *   1. 只使用三类稳定选择器 —— 元素选择器、ARIA role/状态属性、\n *      宿主明确设置的 data-* 属性；\n *   2. 需要覆盖宿主令牌化属性时，用 `html body` 前缀提升特异性，\n *      不写 !important（inline 令牌本来就该由 overrideTokens 负责）；\n *   3. CSS Module 的类名形如 `{hash}_{local}`，哈希随构建变化，\n *      因此只在确有必要时用 `[class*='_local']` 这种与哈希无关的后缀匹配，\n *      匹配不到时静默降级，绝不报错。\n */\n\n/* ------------------------------------------------------------------ *\n * 1. 页面根：把主题色透出到浏览器/窗口底色，并保住 body 背景的可预测性\n * ------------------------------------------------------------------ */\n\nhtml body {\n  background-color: var(--dsw-alias-bg-base);\n}\n\n/* ------------------------------------------------------------------ *\n * 2. 氛围光\n *\n *    只挂在**侧栏列**上。这一条是踩过坑之后收紧的：\n *\n *    最初同时挂在框架（`[class*='_frame']`）上。框架本来被两列完全盖住，\n *    唯一露出来的地方是 Windows 标题栏模式下中心列左上角那个\n *    `border-radius: 16px` 的圆角 —— 而 background-image 的默认原点\n *    （background-origin: padding-box）恰好就在内容区左上角。于是那个圆角\n *    里露出的是光斑**最亮的那一点**，被圆角切成一块带硬边的蓝色楔形，\n *    在浅色下非常显眼。\n *\n *    框架不需要氛围光：它可见的部分只有标题栏拖拽带（被 `:before` 盖住）\n *    和上述圆角露出的区域，而那两处应当是与侧栏连续的纯色。\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-ambient='on'] body [class*='_sidebarCol'] {\n  background-image: radial-gradient(\n      120% 55% at 0% 0%,\n      var(--dshb-ambient-a),\n      var(--dshb-ambient-a-fade) 70%\n    ),\n    radial-gradient(\n      120% 50% at 100% 100%,\n      var(--dshb-ambient-b),\n      var(--dshb-ambient-b-fade) 72%\n    );\n  /* radial-gradient 默认就铺满整个盒子，no-repeat 对它是空操作，\n     写出来只会让下一个人以为这里有平铺行为。 */\n}\n\n/* ------------------------------------------------------------------ *\n * 3. 文本选区：官方是 40% 蓝，这里改为强调色，与品牌位保持一致\n * ------------------------------------------------------------------ */\n\nhtml body ::selection {\n  background-color: var(--dsw-alias-bg-document-selection);\n}\n\n/* ------------------------------------------------------------------ *\n * 4. 滚动条\n *\n *    官方是 5px 无边框、无轨道留白。插件把轨道留白改成 4px、给滑块留 1.5px\n *    透明边，于是**可见**滑块从 5px 变成 3px、而**命中区域**从官方的 5px\n *    变成 6px（宽了 1px，+20%）。\n *\n *    上一版的注释写的是「命中区域不变宽……保持 6px」—— 那句话是错的：官方本来\n *    就不是 6px。这 1px 是有意留的（3px 的滑块已经偏细，再把命中区域收回去会\n *    明显更难抓住），但注释必须说的是事实。\n *\n *    这个变量还被宿主自己消费：`markdown__MarkdownText` 的宽表格用\n *    `padding-bottom: var(--dsh-scrollbar-width, 5px)` 给横向滚动条留位，\n *    所以改它等于同时改了表格底部的留白 —— 又一处理由不去动它。\n * ------------------------------------------------------------------ */\n\nhtml body {\n  --dsh-scrollbar-width: 6px;\n  --dsh-scrollbar-thumb-border: 1.5px;\n  --dsh-scrollbar-track-margin: 4px;\n}\n\n/* ------------------------------------------------------------------ *\n * 5. 交互过渡\n *    只过渡「颜色类」属性 —— 布局属性加过渡会造成拖拽/折叠时的粘滞感。\n *    尊重 prefers-reduced-motion：命中时整段失效。\n * ------------------------------------------------------------------ */\n\n@media (prefers-reduced-motion: no-preference) {\n  html[data-dshb-motion='on']\n    body\n    :is(\n      button,\n      a,\n      summary,\n      input,\n      textarea,\n      select,\n      [role='button'],\n      [role='menuitem'],\n      [role='menuitemcheckbox'],\n      [role='menuitemradio'],\n      [role='option'],\n      [role='tab'],\n      [role='switch'],\n      [role='checkbox'],\n      [role='radio']\n    ) {\n    transition: background-color var(--ds-transition-duration-fast)\n        var(--ds-ease-in-out),\n      border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),\n      color var(--ds-transition-duration-fast) var(--ds-ease-in-out),\n      box-shadow var(--ds-transition-duration-fast) var(--ds-ease-in-out),\n      opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);\n  }\n\n  /* 浮层与卡片入场时给一点高度变化，避免菜单「凭空出现」 */\n  html[data-dshb-motion='on'] body [data-menu-material],\n  html[data-dshb-motion='on'] body [role='dialog'],\n  html[data-dshb-motion='on'] body [role='menu'],\n  html[data-dshb-motion='on'] body [role='listbox'] {\n    transition: opacity var(--ds-transition-duration) var(--ds-ease-in-out),\n      transform var(--ds-transition-duration) var(--ds-ease-in-out),\n      box-shadow var(--ds-transition-duration) var(--ds-ease-in-out);\n  }\n}\n\n/* ------------------------------------------------------------------ *\n * 6. 焦点环：颜色已由 --dsw-focus-ring-color 令牌接管（随强调色走），\n *    这里只补一点外发光，让键盘焦点在复杂卡片上更容易被找到。\n * ------------------------------------------------------------------ */\n\nhtml body :focus-visible {\n  outline-offset: 2px;\n}\n\n/* ------------------------------------------------------------------ *\n * 7. 内容区圆角\n *\n *    Windows 标题栏模式下，宿主把中心列左上角切成\n *    `border-radius: var(--dsh-windows-content-radius) 0 0 0; corner-shape: round`，\n *    那个圆角露出的正是框架底色 —— 也就是侧栏填充色。它是整块内容区视觉上\n *    最靠外的一个圆角，必须与相邻表面（卡片、面板）用同一支笔。\n *\n *    宿主把该令牌声明在 frame 元素**自身**上：\n *\n *      [data-windows-titlebar] .BynINW_frame { --dsh-windows-content-radius: 16px }\n *\n *    那是一条 **两个类级选择器**的规则（属性 + 类），座标 (0,2,0)。\n *    v1.2 用的是 `html body [class*='_frame']` —— 两个元素选择器 + 一个属性选择器，\n *    座标 (0,1,2)。**属性选择器与类同级**，所以 1 < 2：宿主赢，这条规则从未生效。\n *    缺陷一直没被发现，是因为默认档（standard）的内容区圆角恰好也是 16px。\n *\n *    现在把 Windows 条件挂到 `html` 上：`html[data-windows-titlebar] body …`\n *    座标 (0,2,2) > (0,2,0)，两处都赢；语义上也更准确 —— 这个圆角本来\n *    就只在 Windows 标题栏模式下存在。\n *\n *    宿主同时写了 `corner-shape: round`：这个角是**正圆**，不是全局的方圆形。\n *    保持不动 —— 它是内容区最外沿的轮廓，跟随全局方圆形会让四个角与窗口\n *    自身的圆角对不上。`scripts/check.mjs` 有一条断言盯着这里的选择器形状。\n * ------------------------------------------------------------------ */\n\nhtml[data-windows-titlebar] body [class*='_frame'] {\n  --dsh-windows-content-radius: var(--dshb-content-radius);\n}\n"],
  ["elevation", "/*\n * 界面美化 · Lumina —— 高度（elevation）令牌重组层。\n *\n * ## 为什么这一层必须存在\n * 宿主 gradient-shadow-text.css 把 `--dsw-elevation-*` 声明在 `body, body *` 上 ——\n * 也就是**每一个元素都自带一份声明**。插件通过 ctx.theme.overrideTokens 拿到的\n * 是 body 上的行内样式，行内值只能被继承；元素自带的声明优先于继承，所以行内\n * 覆盖对这一族令牌完全无效（这是宿主令牌体系里唯一一处这样的例外）。\n *\n * ## 怎么解\n * 插件改为交出「原语」：--dshb-elev-stroke-color / --dshb-elev-panel 等，\n * 它们没有第二个声明点，行内值可正常继承到所有后代；再由本表把这些原语组合成\n * 宿主令牌。选择器写成 `html body` / `html body *`，特异性严格高于宿主的\n * `body` / `body *`，因此不依赖样式表顺序、也不需要 !important。\n */\n\nhtml body,\nhtml body * {\n  --dsw-elevation-stroke: 0 0 0 0.5px var(--dshb-elev-stroke-color);\n  --dsw-elevation-panel: var(--dsw-elevation-stroke), var(--dshb-elev-panel);\n  --dsw-elevation-prominent: var(--dsw-elevation-stroke),\n    var(--dshb-elev-prominent);\n  --dsw-elevation-soft: var(--dsw-elevation-stroke), var(--dshb-elev-soft);\n}\n\n/*\n * 宿主在深色模式下给菜单材质换了一根更亮的描边色。官方值来自 border-l3，\n * 这里改用本预设的 stroke 原语，让菜单描边与其余浮层保持同一支笔。\n * 选择器特异性 (0,0,2,2) 高于宿主的 (0,0,2,1)。\n */\nhtml body[data-ds-dark-theme] [data-menu-material],\nhtml body [data-menu-material] {\n  --dsw-elevation-stroke-color: var(--dshb-elev-stroke-color);\n}\n"],
  ["typography", "/*\n * 界面美化 · Lumina —— 内容排版精修层（可用 data-dshb-typography 整体关闭）。\n *\n * 这一层处理令牌表达不了的东西：字形平滑、等宽数字、代码块与引用块的细节。\n * 全部使用元素选择器 —— 它们由宿主 Markdown 渲染器产出，与 CSS Module 哈希无关，\n * 因此跨版本稳定；代价是无法区分「会话里的表格」与「插件面板里的表格」，\n * 这对视觉一致性而言反而是好事。\n *\n * 打开/关闭由 <html data-dshb-typography=\"on|off\"> 控制。\n */\n\n/* ------------------------------------------------------------------ *\n * 1. 字形渲染\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-typography='on'] body {\n  -webkit-font-smoothing: antialiased;\n  -moz-osx-font-smoothing: grayscale;\n  text-rendering: optimizeLegibility;\n}\n\n/* 中文正文在 system-ui 下字距偏挤；0.01em 是几乎察觉不到、但整页读起来更松的量 */\nhtml[data-dshb-typography='on'] body :is(p, li, dd, dt, td, th) {\n  letter-spacing: 0.01em;\n}\n\n/* 表格、代码、时间戳里的数字等宽，列才对得齐 */\nhtml[data-dshb-typography='on'] body :is(table, code, kbd, samp, pre) {\n  font-variant-numeric: tabular-nums;\n  font-feature-settings: 'tnum' 1, 'cv05' 1;\n}\n\n/* ------------------------------------------------------------------ *\n * 2. 行内代码：**刻意不加任何东西**\n *\n *    v1.0–v1.2 这里有一条 `html body :not(pre) > code { border: 1px solid …;\n *    border-radius: var(--dsw-radius-xs); padding: 0.1em 0.34em }`，理由写的是\n *    「官方只给底色，这里补一根极淡描边」。**那句话是错的**，而且规则本身也打不过：\n *\n *      · 宿主 `markdown__MarkdownText.module.css` 的\n *        `.markdown :not(pre) > code` 已经写着\n *        `border: 0.5px solid var(--dsw-alias-border-l1)`、\n *        `border-radius: var(--dsw-radius-sm)`、`padding: 0 5px`\n *        —— 描边、圆角、内边距官方全都给了；\n *      · 那条规则座标 (0,1,2)，而插件的 `html body :not(pre) > code` 是 (0,0,4)：\n *        **类级 1 > 0，宿主赢**。行内代码在实际出现的唯一位置（Markdown 正文里）\n *        拿到的一直是宿主的值，插件声明的三个属性一个都没生效；\n *      · 它还是整个文件里唯一没有 `data-dshb-typography` 前缀的规则 ——\n *        于是「内容精修」关掉之后，它仍然在 markdown **之外** 的 `<code>` 上生效。\n *\n *    修法是删掉整条，而不是加 `!important` 或提特异性去赢一个本来就正确的官方样式 ——\n *    与 v1.1 删掉 `<pre>` 那条边框规则是同一个判断：**样式表再叠一层，收益是零，\n *    代价是打一架**。行内代码的外观由令牌决定（`--dsw-alias-markdown-inline-code`、\n *    `--dsw-radius-sm`），它们本来就随预设走。\n * ------------------------------------------------------------------ */\n\n/* 代码块：**刻意不动 `<pre>`**。\n *\n * 第一版给所有 `pre` 加了边框 + 圆角 + 顶部内高光，理由是「大面积实色显得扁平」。\n * 那是个错误：宿主的代码块把视觉身份放在 `pre` 自己身上 ——\n *\n *   .block { border-radius: var(--dsw-radius-lg); background: … }        ← 卡片\n *   .block :where(pre) { padding: 16px; background: …;\n *                        border-bottom-*-radius: var(--dsw-radius-lg) }   ← pre 自带圆角\n *\n * 于是我的规则会在卡片内部套出第二层细圆角边框。官方基线是**单层干净卡片**，\n * 而带这条规则的版本能在验证台里肉眼看出那个内框\n * （见 verify/out/panels-official-light.png 与 panels-pre-border-aurora-light.png\n * 的对照，夹具 `?bug=pre-border` 就是这条被删掉的规则）。\n *\n * 代码块与正文的区分已经由令牌层完成：`--dsw-alias-markdown-code-block` 与\n * `-banner` 都随预设调整过。样式表再叠一层，收益是零，代价是打一架。\n */\n\n/* ------------------------------------------------------------------ *\n * 3. 引用与分隔\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-typography='on'] body blockquote {\n  border-inline-start: 3px solid var(--dsw-alias-state-business-primary);\n  border-radius: 0 var(--dsw-radius-sm) var(--dsw-radius-sm) 0;\n  padding-inline-start: 0.85em;\n}\n\nhtml[data-dshb-typography='on'] body hr {\n  border: 0;\n  border-top: 1px solid var(--dsw-alias-border-l2);\n}\n\n/* ------------------------------------------------------------------ *\n * 4. 表格\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-typography='on'] body th {\n  background-color: var(--dsw-alias-markdown-code-block-banner);\n}\n\nhtml[data-dshb-typography='on'] body table {\n  border-radius: var(--dsw-radius-sm);\n  overflow: clip;\n}\n\n/* ------------------------------------------------------------------ *\n * 5. 链接与图片\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-typography='on'] body a {\n  text-underline-offset: 0.22em;\n  text-decoration-thickness: 0.06em;\n}\n\nhtml[data-dshb-typography='on'] body :is(img, video) {\n  border-radius: var(--dsw-radius-sm);\n}\n"],
  ["task-list", "/*\n * 界面美化 · Lumina —— 任务列表面板增强（可用 data-dshb-tasklist 整体关闭）。\n *\n * ## 要解决的问题\n * 宿主的 TodoPanel 三态在视觉上几乎不可分：任务项文字**恒为同一种**\n * `--dsw-alias-label-secondary`，状态只由一个 6px 的状态点承担 —— 已完成是绿点、\n * 进行中是转圈、待处理是灰点。十几行排下来，扫一眼得到的印象是「都差不多」，\n * 于是「做完了没有」这个问题在面板上读不出来。\n *\n * 另外列表 `max-height: 180px` 配 `overflow-y: auto`，行高 28px 不是整数倍，\n * 最后一行常常被硬切成两半，且没有任何「还能滚」的提示 —— 看起来像渲染坏了。\n *\n * ## 做了什么\n * 1. 把状态差从「6px 圆点」放大到「整行可辨」：\n *    已完成 → 文字降权 + 删除线；进行中 → 强调色淡染行底 + 左侧强调条 + 文字加重；\n *    待处理 → 保持宿主原样（它是基线，不需要被强调）。\n * 2. 列表底部加渐隐，并在末尾留出与渐隐等高的空白 —— 滚到底时渐隐落在空白上，\n *    最后一行不会被误伤；未滚到底时渐隐正好压住被切开的半行，把「硬切」\n *    变成「下面还有」的提示。\n * 3. 表头是 `<button>`，宿主没给 hover 反馈；补上，并保持图标横向位置不变。\n *\n * ## 选择器约定\n * 只用宿主**有意暴露**的钩子：面板根的 `data-testid=\"todo-panel\"`、\n * 任务项的 `data-status=\"completed|in_progress|pending\"`（封闭联合，来自\n * ui-conversation 的 TodoItem 类型）、以及 `aria-expanded`。\n * 全程不碰 `.aSus8q_item` 这类编译哈希类名 —— 宿主改一次构建就会失效。\n *\n * 内容节点用 `> span:last-child` 定位：任务项固定只有两个子元素\n * （状态点 span + 内容 span），这个结构由 JSX 决定，比类名稳定。\n */\n\n/* ------------------------------------------------------------------ *\n * 1. 状态阶梯\n * ------------------------------------------------------------------ */\n\n/* 已完成：降权 + 删除线。删除线用描边色而不是文字色，\n   让「划掉」这件事读得出来、又不至于抢走正文的注意力。 */\nhtml[data-dshb-tasklist='on']\n  body\n  [data-testid='todo-panel']\n  li[data-status='completed']\n  > span:last-child {\n  color: var(--dsw-alias-label-caption);\n  text-decoration: line-through;\n  text-decoration-color: var(--dsw-alias-border-l4);\n  text-decoration-thickness: 1px;\n}\n\n/* 进行中：这一行是「现在正在做的事」，给它最强的视觉权重。\n   左右各 6px 的负外边距与内边距配成一对，行被撑宽了 12px 又收回 12px，\n   状态点与文字的横向位置与其他行严格对齐。\n\n   **不要在这里写 border-radius**：宿主的面板列表是 `overflow-y: auto` 的滚动容器\n   （`overflow-x` 因此计算成 auto），行盒宽出容器 12px、左右各 6px 落在容器的\n   内边距盒之外被裁掉 —— 高亮带是**通栏**的，圆角永远不可见。\n   v1.2 写了 `border-radius: var(--dsw-radius-xs)`，那是一行死代码；\n   真正可见的后果是那 6px 溢出变成了**一条横向滚动条**（见下面的 ul 规则）。 */\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] li[data-status='in_progress'] {\n  position: relative;\n  margin-inline: -6px;\n  padding-inline: 6px;\n  background: var(--dsw-alias-interactive-bg-hover-accent);\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n}\n\n/* 左侧强调条。绝对定位的包含块是行的内边距盒，inset-inline-start: 0\n   因此落在行的左边缘，而不是文字起点。 */\nhtml[data-dshb-tasklist='on']\n  body\n  [data-testid='todo-panel']\n  li[data-status='in_progress']::before {\n  content: '';\n  position: absolute;\n  inset-inline-start: 0;\n  inset-block: 2px;\n  width: 2px;\n  border-radius: 1px;\n  background: var(--dsw-alias-state-business-primary);\n}\n\n/* 待处理刻意不做任何样式：三档里只有它保持宿主原样，\n   另外两档的差异才有参照物。 */\n\n/* ------------------------------------------------------------------ *\n * 2. 列表溢出：底部渐隐 + 横向溢出封口\n * ------------------------------------------------------------------ */\n\n/* `overflow-x: hidden` 不是装饰，是上面那条负外边距的**收尾**：宿主的列表容器是\n   `overflow-y: auto`，按规范 `overflow-x` 会计算成 `auto`，于是行盒宽出的 12px\n   变成了真实的横向滚动溢出 —— 实测 6px 溢出、面板底下多一条横向滚动条。\n   把横向封掉之后，那条通栏高亮带仍然通栏，只是不再能把列表拖来拖去。 */\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] ul {\n  padding-block-end: 12px;\n  overflow-x: hidden;\n  mask-image: linear-gradient(\n    to bottom,\n    #000 calc(100% - 12px),\n    transparent 100%\n  );\n}\n\n/* ------------------------------------------------------------------ *\n * 3. 表头：它是个按钮，宿主没给可点的反馈\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] button {\n  margin-inline: -6px;\n  padding-inline: 6px;\n  border-radius: var(--dsw-radius-sm);\n}\n\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] button:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] button:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid\n    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));\n  outline-offset: 1px;\n}\n"],
  ["safety", "/*\n * 界面美化 · Lumina —— 安全修正层。\n *\n * 这一层不放任何装饰。它只修一个宿主自身的问题：**页面控件被原生窗口按钮盖住，\n * 用户点到的是「关闭程序」**。\n *\n * ## 问题\n * Windows 上宿主用 Electron 的 `titleBarOverlay` 画最小化/最大化/关闭三个按钮。\n * 它们不在 DOM 里 —— Chromium 把它们绘制在页面**之上**，占位约\n * `top: 0..40px`、`right: 0..138px`（高度来自 host preload 写入的\n * `--dsh-windows-titlebar-height: 40px`）。\n *\n * 而图片灯箱的关闭按钮是：\n *\n *   .close { position: fixed; top: 20px; right: 20px; width: 36px; height: 36px }\n *   （宿主 ui-primitives 的 ImageLightbox.module.css）\n *\n * 它整个落在那三个原生按钮的下半部分里。因为原生覆盖层在上，点击被它截走 ——\n * 用户点「图片的 ✕」，程序被关掉。这是可复现的误操作，不是观感问题。\n *\n * ## 修法\n * 把灯箱关闭按钮挪到标题栏覆盖层**下方**。位移量不写死，而是用宿主自己发布的\n * `--dsh-frame-overlay-top`：ui-layout 把它定义为\n * `calc(--dsh-frame-top-clearance + 20px)`，而全屏时宿主会把它降回 20px ——\n * 全屏下原生按钮本就不显示，关闭按钮自动回到原位，不需要插件再加一条全屏判断。\n *\n * ## 选择器\n * 用与哈希无关的后缀匹配：编译后的类名形如 `_backdrop_1hos8_1` / `_close_1hos8_29`。\n * 全应用只有一个 `_backdrop` 类（图片灯箱），因此\n * `[class*='_backdrop'] [class*='_close_']` 唯一且稳定。匹配不到时静默降级 ——\n * 宿主哪天自己修好了，这条规则自动失效，不会有副作用。\n *\n * `scripts/check.mjs` 会断言这条规则始终挂在 `[data-windows-titlebar]` 下并引用\n * 宿主变量；`scripts/audit-caption-collision.mjs` 可在宿主升级后重新全量排查。\n */\n\nhtml[data-windows-titlebar] body [class*='_backdrop'] [class*='_close_'] {\n  top: var(--dsh-frame-overlay-top, 60px);\n}\n"],
  ["panel", "/*\n * 界面美化 · Lumina —— 设置面板样式。\n *\n * 类名统一用 `dshb-` 前缀的普通全局类（不是 CSS Module）：面板组件由本插件\n * 拥有，前缀足以避免与宿主及其它插件冲突，同时也省掉一层构建期哈希。\n *\n * 全部颜色都读宿主令牌，因此面板会跟随浅色/深色与所选预设一起变。\n *\n * ## 正圆与胶囊必须写 corner-shape: round\n * 宿主的 corner-shape.css 通过 `*,:before,:after { corner-shape: superellipse(1.5) }`\n * 把**所有**圆角平滑成方圆形。这对卡片、输入框是想要的效果，但会把\n * `border-radius: 50%` 的圆和 `999px` 的胶囊压变形。宿主自己的约定是：\n * 正圆形状需在所属组件样式表里把 `corner-shape: round` 与半径声明配对。\n * 本文件里四处圆（色板、预设色点、开关轨道、开关滑块）都遵守这一约定。\n * 不支持 corner-shape 的引擎会忽略该声明，退化成普通圆弧 —— 正是想要的。\n */\n\n.dshb-root {\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--dsw-font-family);\n  font-size: var(--dsh-content-font-size-secondary, 13px);\n}\n\n/* ---------------------------------------------------------------- 头部 */\n\n.dshb-head {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 16px;\n}\n\n.dshb-title {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 600;\n  line-height: 24px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshb-subtitle {\n  margin: 4px 0 0;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-tertiary);\n  max-width: 46ch;\n}\n\n/* ------------------------------------------------------------ 主体容器 */\n\n.dshb-body {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  border: 1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4));\n  border-radius: var(--dsw-radius-md);\n  background-color: var(\n    --dsw-alias-settings-card-fill,\n    var(--dsw-alias-bg-layer-2)\n  );\n  padding: 4px 16px;\n}\n\n/* 总开关关闭时整块降饱和并禁用交互，明确表达「已停用」 */\n.dshb-body-off {\n  opacity: 0.45;\n  filter: saturate(0.4);\n  pointer-events: none;\n}\n\n/* ------------------------------------------------------------------ 行 */\n\n.dshb-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 14px 0;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.dshb-row:last-child {\n  border-bottom: 0;\n}\n\n.dshb-row-text {\n  min-width: 0;\n}\n\n.dshb-row-title {\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshb-row-hint {\n  margin-top: 2px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshb-row-control {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n/* ------------------------------------------------------------- 预设卡片 */\n\n.dshb-group {\n  padding: 14px 0;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.dshb-group-title {\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  margin-bottom: 10px;\n}\n\n.dshb-cards {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));\n  gap: 10px;\n}\n\n.dshb-card {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 6px;\n  padding: 12px;\n  cursor: pointer;\n  text-align: left;\n  font: inherit;\n  color: var(--dsw-alias-label-primary);\n  background-color: var(--dsw-alias-bg-layer-1);\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n}\n\n.dshb-card:hover:not(:disabled) {\n  background-color: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshb-card-active {\n  border-color: var(--dsw-alias-state-business-primary);\n  box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary) inset;\n  background-color: var(--dsw-alias-interactive-bg-hover-accent);\n}\n\n.dshb-card:disabled {\n  cursor: default;\n}\n\n.dshb-card-dots {\n  display: flex;\n  gap: 4px;\n}\n\n.dshb-card-dot {\n  width: 14px;\n  height: 14px;\n  border-radius: 50%;\n  /* 正圆：必须显式关掉宿主的 superellipse，否则会被压成方圆形 */\n  corner-shape: round;\n  box-shadow: 0 0 0 1px var(--dsw-alias-border-l4) inset;\n}\n\n.dshb-card-name {\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 18px;\n}\n\n.dshb-card-tagline {\n  font-size: 11px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* --------------------------------------------------------------- 色板 */\n\n.dshb-swatches {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  justify-content: flex-end;\n}\n\n.dshb-swatch {\n  width: 24px;\n  height: 24px;\n  padding: 0;\n  border-radius: 50%;\n  /* 正圆：同上，宿主会给所有元素套 superellipse */\n  corner-shape: round;\n  cursor: pointer;\n  border: 0;\n  /* 面板可能在深色下，样式表按当前主题挑选明/暗两支强调色 */\n  background-color: var(--dshb-swatch-light);\n  box-shadow: 0 0 0 1px var(--dsw-alias-border-l4) inset;\n}\n\nbody[data-ds-dark-theme] .dshb-swatch {\n  background-color: var(--dshb-swatch-dark);\n}\n\n.dshb-swatch-active {\n  /* 中间那圈「空隙」必须用面板**实际所在的表面色**，不能用画布色：\n     面板坐在设置卡片上（--dsw-alias-settings-card-fill = bg-layer-2），\n     而画布色是 bg-base —— 深色下两者相差明显（#0c1017 vs #1b2230），\n     用画布色会在选中色板周围留下一圈发暗的光晕。 */\n  box-shadow: 0 0 0 1px var(--dsw-alias-border-l4) inset,\n    0 0 0 3px var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-base)),\n    0 0 0 5px var(--dsw-alias-state-business-primary);\n}\n\n.dshb-swatch:disabled {\n  cursor: default;\n}\n\n/* ----------------------------------------------------------- 分段选择器 */\n\n.dshb-segmented {\n  display: inline-flex;\n  padding: 2px;\n  gap: 2px;\n  border-radius: var(--dsw-radius-sm);\n  background-color: var(--dsw-alias-bg-layer-3);\n  border: 1px solid var(--dsw-alias-border-l2);\n}\n\n.dshb-segment {\n  padding: 4px 12px;\n  font: inherit;\n  font-size: 12px;\n  line-height: 18px;\n  cursor: pointer;\n  border: 0;\n  border-radius: calc(var(--dsw-radius-sm) - 3px);\n  background-color: transparent;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshb-segment:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background-color: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshb-segment-active,\n.dshb-segment-active:hover:not(:disabled) {\n  background-color: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n  box-shadow: var(--dsw-elevation-stroke, 0 0 0 0.5px var(--dsw-alias-border-l4)),\n    0 1px 3px 0 rgb(0 0 0 / 8%);\n}\n\n/* --------------------------------------------------------------- 开关 */\n\n.dshb-switch {\n  position: relative;\n  width: 36px;\n  height: 20px;\n  padding: 0;\n  cursor: pointer;\n  border: 0;\n  border-radius: 999px;\n  /* 胶囊：superellipse 会让两端不再是半圆 */\n  corner-shape: round;\n  background-color: var(--dsw-alias-interactive-bg-active);\n  transition: background-color var(--ds-transition-duration-fast)\n    var(--ds-ease-in-out);\n}\n\n.dshb-switch[aria-checked='true'] {\n  background-color: var(--dsw-alias-state-business-primary);\n}\n\n.dshb-switch-thumb {\n  position: absolute;\n  top: 2px;\n  left: 2px;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  /* 正圆：同上 */\n  corner-shape: round;\n  background-color: var(--dsw-alias-switch-thumb);\n  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 24%);\n  transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);\n}\n\n.dshb-switch[aria-checked='true'] .dshb-switch-thumb {\n  transform: translateX(16px);\n}\n\n/* --------------------------------------------------------------- 可读性读数 */\n\n/* v1.2 新增：把「这套配色读不读得出来」从一句承诺变成面板上的数字。\n   样式刻意做成「徽标」而不是「控件」—— 它是只读状态，点不动，\n   因此不用按钮的语义，也不该有 hover 反馈。 */\n.dshb-metric {\n  display: inline-flex;\n  align-items: center;\n  gap: 8px;\n  padding: 3px 8px;\n  border-radius: var(--dsw-radius-sm);\n  corner-shape: round;\n  font-family: var(--ds-font-family-code);\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-secondary);\n  background-color: var(--dsw-alias-bg-layer-3);\n  border: 1px solid var(--dsw-alias-border-l2);\n}\n\n/* 数字用等宽字形并加粗：它是这一行里唯一需要被「读到」的内容 */\n.dshb-metric-value {\n  font-weight: 600;\n  color: var(--dsw-alias-label-primary);\n  font-variant-numeric: tabular-nums;\n}\n\n.dshb-metric-tag {\n  font-family: var(--dsw-font-family);\n  font-size: 11px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* 不达标时才变红。用错误色令牌而不是写死红色，跟随主题；\n   加粗边框让小尺寸下也能一眼看出状态差异（不是只靠颜色）。 */\n.dshb-metric-bad {\n  border-color: var(--dsw-alias-state-error-primary);\n  color: var(--dsw-alias-state-error-primary);\n}\n\n.dshb-metric-bad .dshb-metric-tag {\n  color: var(--dsw-alias-state-error-primary);\n}\n\n/* --------------------------------------------------------------- 页脚 */\n\n.dshb-foot {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshb-foot-note {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n/* 版本号：插件走热替换，没有可见版本号就只能靠猜「我到底装上了没有」 */\n.dshb-version {\n  flex: none;\n  padding: 1px 6px;\n  border-radius: 999px;\n  corner-shape: round;\n  font-family: var(--ds-font-family-code);\n  font-size: 11px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-secondary);\n  background-color: var(--dsw-alias-bg-layer-3);\n  border: 1px solid var(--dsw-alias-border-l2);\n}\n\n.dshb-reset {\n  flex: none;\n  padding: 5px 12px;\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n  background-color: transparent;\n  border: 1px solid var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-sm);\n}\n\n.dshb-reset:hover {\n  color: var(--dsw-alias-label-primary);\n  background-color: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* 尊重系统的减少动效偏好：本插件自己的过渡也一并停掉 */\n@media (prefers-reduced-motion: reduce) {\n  .dshb-switch,\n  .dshb-switch-thumb {\n    transition: none;\n  }\n}\n"]
]

// ---- src/client/controller.js ------------------------------------
/**
 * 界面美化 · Lumina —— 外观控制器。
 *
 * 控制器是状态的唯一宿主：面板只读它、只写它，宿主 DOM 只被它改。
 * 三个落点各司其职：
 *
 *   1. `ctx.theme.overrideTokens(source, tokens)` —— 颜色、圆角、阴影、排版、
 *      毛玻璃。走宿主主题管线，明暗自动重解析、卸载自动回滚。
 *   2. `<html data-dshb-*>` 属性 —— 给结构层样式表当开关。属性而非类名，
 *      因为宿主不管理它们，不会与框架的 class 协调产生冲突。
 *   3. 插件自有的 `<style>` 标签 —— 令牌表达不了的结构性修饰。总开关关闭时
 *      整套移除，界面回到官方原样，做到「零残留」。
 */





/** 主题覆盖层的身份。同一 source 重复调用会整体替换旧层，所以它必须稳定。 */
const SOURCE = 'dsh-ui-beautify'

/** 各枚举键的合法取值，用于把持久化数据里的陈旧 id 挡掉。 */
const KNOWN = {
  preset: PRESETS.map((p) => p.id),
  accent: ACCENTS.map((a) => a.id),
  radius: RADIUS_SCALES.map((r) => r.id),
  corner: CORNER_SHAPES.map((c) => c.id)
}

/**
 * 布尔开关 → <html> 属性名。属性存在且为 'on' 时结构层生效。
 *
 * 注意「毛玻璃」不在这里：它只影响令牌（菜单填充色与 backdrop-filter），
 * 没有结构性样式，因此走 overrideTokens 就够了 —— 不设一个没人读的属性。
 */
const FLAGS = {
  enabled: 'data-dshb-enabled',
  ambient: 'data-dshb-ambient',
  motion: 'data-dshb-motion',
  typography: 'data-dshb-typography',
  taskList: 'data-dshb-tasklist'
}

/**
 * 枚举值 → <html> 属性名，用于按档位挂样式（例如窗口内容圆角），
 * 同时作为插件的公开状态标记：`data-dshb-preset` 让用户或其它插件
 * 可以针对某个预设写补充样式。
 */
const SELECTORS = {
  preset: 'data-dshb-preset',
  radius: 'data-dshb-radius',
  corner: 'data-dshb-corner'
}

/**
 * 建立外观控制器。
 *
 * @param options.theme - 宿主的 ui-theme 服务（提供 overrideTokens）。
 * @param options.doc - 文档对象，默认取全局 document；测试可注入替身。
 * @returns 控制器 API。
 */
function createController(options) {
  const theme = options.theme
  const doc = options.doc ?? globalThis.document
  const listeners = new Set()

  let state = loadState(KNOWN)
  /** 已挂载的样式标签，便于总开关关闭时精确移除。 */
  let styleTags = []
  /**
   * 动效开关是否已就绪。
   *
   * 插件在首屏之后才拿到控制权：这时界面已经用官方令牌画过一遍，覆盖层落地会
   * 让主按钮、选中态等一次性改变颜色。如果此刻 `data-dshb-motion` 已经打开，
   * base.css 的过渡规则会把这次「换装」变成一段可见的淡入 —— 每次启动都闪一下。
   * 因此首次投射先不动效，等下一帧再把开关打开：换装本身瞬时完成，之后的
   * 用户交互照常有过渡。
   */
  let motionReady = false
  /**
   * 是否已经卸载。
   *
   * 卸载之后**一切投射都要停**，这不是防御性编程，而是一条真实存在的路径：
   * 首帧那次 `requestAnimationFrame` 排在队列里，HMR 在同一个 tick 内卸载并重载
   * （dsh-client-hmr 每 500ms 轮询一次），或者窗口不可见时 rAF 被无限期推迟 ——
   * 回调随后执行，会把 7 个 `data-dshb-*` 属性重新写到 `<html>` 上，
   * 而那些属性是插件对外的公开接口，**没有任何东西会再清掉它们**。
   */
  let disposed = false
  /** 首帧回调的句柄，卸载时用它取消排队中的那一帧。 */
  let rafHandle = null
  /**
   * 宿主令牌层的撤回函数。
   *
   * `theme.overrideTokens(source, tokens)` 的返回值是**唯一**的撤回入口：
   * 宿主只把层存进内部表，不会在插件卸载时替我们删。v1.2 丢弃了这个返回值，
   * 于是 README 承诺的「卸载零残留」只做到了样式标签与属性那一半 ——
   * 配色令牌会一直留在宿主的主题服务里，直到进程结束。
   */
  let tokenDisposer = null

  /** 通知所有订阅者。面板以整对象替换触发重渲染。 */
  function emit() {
    if (disposed) return
    const snapshot = { ...state }
    for (const listener of listeners) {
      try {
        listener(snapshot)
      } catch {
        /* 单个订阅者出错不应中断其余订阅者，也不应影响外观已生效的状态 */
      }
    }
  }

  /** 把状态投射到 <html> 属性上；总开关关闭时清空全部属性。 */
  function projectAttributes() {
    if (disposed) return
    if (!doc?.documentElement) return
    const root = doc.documentElement
    for (const [key, attribute] of Object.entries(FLAGS)) {
      // 动效开关要等首帧之后再打开，见 motionReady 的说明
      const active =
        state.enabled && state[key] && (key !== 'motion' || motionReady)
      if (active) root.setAttribute(attribute, 'on')
      else root.removeAttribute(attribute)
    }
    for (const [key, attribute] of Object.entries(SELECTORS)) {
      if (state.enabled) root.setAttribute(attribute, state[key])
      else root.removeAttribute(attribute)
    }
  }

  /** 挂载结构层样式表。总开关关闭时不挂，界面即回到官方原样。 */
  function mountStyles() {
    if (styleTags.length > 0 || !state.enabled) return
    if (!doc?.head) return
    for (const [name, css] of STYLES) {
      const tag = doc.createElement('style')
      tag.dataset.plugin = SOURCE
      tag.dataset.pluginCss = `${SOURCE}/${name}`
      tag.textContent = css
      doc.head.appendChild(tag)
      styleTags.push(tag)
    }
  }

  /** 移除结构层样式表。 */
  function unmountStyles() {
    for (const tag of styleTags) tag.remove()
    styleTags = []
  }

  /**
   * 把外观推给宿主。
   *
   * 令牌层在**开关关闭**时推空对象而不是撤回整层：这样「关闭 → 打开」不会在宿主侧
   * 留下需要跟踪的悬挂 disposer，界面照样回到官方原样。
   * 但**卸载**是另一回事 —— 那时必须真的把层删掉，见 mount() 的 disposer，
   * 因此这里要把宿主返回的撤回函数记下来。
   */
  function projectTokens() {
    if (disposed) return
    if (!theme || typeof theme.overrideTokens !== 'function') return
    const disposer = theme.overrideTokens(
      SOURCE,
      state.enabled ? buildTokens(state) : {}
    )
    if (typeof disposer === 'function') tokenDisposer = disposer
  }

  /** 全量投射一次。 */
  function project() {
    if (disposed) return
    projectAttributes()
    projectTokens()
    if (state.enabled) mountStyles()
    else unmountStyles()
  }

  return {
    /** 当前状态的浅拷贝。 */
    getState() {
      return { ...state }
    },

    /**
     * 合并式更新。非法值会被归一化丢弃，不会写入状态。
     * @param patch - 需要变更的字段子集。
     */
    setState(patch) {
      const merged = normalizeState({ ...state, ...patch }, KNOWN)
      const changed = Object.keys(merged).some((key) => merged[key] !== state[key])
      if (!changed) return
      state = merged
      saveState(state)
      project()
      emit()
    },

    /** 订阅状态变化，返回退订函数。 */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** 恢复出厂外观。 */
    reset() {
      state = { ...DEFAULT_STATE }
      saveState(state)
      project()
      emit()
    },

    /** 首次投射。由插件的 apply 调用一次。 */
    mount() {
      project()
      // 首帧之后才允许过渡生效，避免「换装」被渲染成一段可见的淡入。
      // 没有 requestAnimationFrame 的环境（例如无头测试替身）直接视为就绪。
      const raf = globalThis.requestAnimationFrame
      if (typeof raf === 'function') {
        rafHandle = raf(() => {
          rafHandle = null
          motionReady = true
          projectAttributes()
        })
      } else {
        motionReady = true
        projectAttributes()
      }
      return () => {
        // 顺序有意如此：先立起 disposed，让任何**已经排队**的回调变成空操作，
        // 再取消还没执行的那一帧，最后才回收三条落点。
        disposed = true
        if (rafHandle !== null && typeof globalThis.cancelAnimationFrame === 'function') {
          globalThis.cancelAnimationFrame(rafHandle)
        }
        rafHandle = null
        listeners.clear()
        unmountStyles()
        // 令牌层：优先用它自己的 disposer 撤回（宿主唯一的删除入口）；
        // 宿主若没返回函数（契约允许），退而推一个空层 —— 两条路都能让
        // 界面回到官方原样，而不是把配色留在宿主的主题服务里。
        if (typeof tokenDisposer === 'function') {
          try {
            tokenDisposer()
          } catch {
            /* 宿主可能已经先一步回收了这一层 */
          }
          tokenDisposer = null
        } else if (theme && typeof theme.overrideTokens === 'function') {
          try {
            theme.overrideTokens(SOURCE, {})
          } catch {
            /* 卸载路径上的异常不应中断属性清理 */
          }
        }
        if (doc?.documentElement) {
          for (const attribute of [
            ...Object.values(FLAGS),
            ...Object.values(SELECTORS)
          ]) {
            doc.documentElement.removeAttribute(attribute)
          }
        }
      }
    }
  }
}

// ---- src/client/version.generated.js -----------------------------
/**
 * 本文件由 scripts/build.mjs 生成，请勿手工编辑。
 * 版本号的事实来源是 package.json。
 */
const VERSION = "1.3.0"

// ---- src/client/panel.js -----------------------------------------
/**
 * 界面美化 · Lumina —— 设置面板。
 *
 * 面板本身也用宿主的 --dsw-* 令牌着色，因此它会跟随用户选中的主题一起变化，
 * 不会成为界面里唯一一块「不听话」的区域。
 *
 * 组件刻意不引入任何依赖：只用 `react` 的 createElement 与两个 hook，
 * 这样客户端 bundle 可以手写、无需构建工具链（宿主模块加载器只保证
 * react / react-dom / jsx-runtime 与 @deepseek-ai/* 这些 id 可 require）。
 */





const h = React.createElement

/** 一行设置：左侧标题与说明，右侧控件。 */
function Row(props) {
  return h(
    'div',
    { className: 'dshb-row' },
    h(
      'div',
      { className: 'dshb-row-text' },
      h('div', { className: 'dshb-row-title' }, props.title),
      props.hint ? h('div', { className: 'dshb-row-hint' }, props.hint) : null
    ),
    h('div', { className: 'dshb-row-control' }, props.children)
  )
}

/**
 * 可读性读数。
 *
 * 这是 v1.2 新增的一行：它把「这套配色读不读得出来」从一句承诺变成面板上的数字。
 *
 * 为什么值得放一行：插件改了 110 多个宿主令牌，用户无法逐个核对；而对比度不足
 * 恰恰是最不容易被察觉的那类问题 —— 界面上没有任何东西会报错，只是字发虚。
 * 把最低的那个比值摆出来，用户至少知道「现在这套是达标的」。
 *
 * 读数覆盖**明暗两套**：插件在暗色下也生效，只报当前明暗会漏掉一半。
 *
 * @param props.state - 当前外观状态（用于算出令牌层）。
 * @param props.t - 本地化函数。
 */
function Readability(props) {
  const report = evaluateBoth(buildTokens(props.state))
  const failing = report.failures.length
  // 用**正文级**最劣项：装饰性底板（键帽 1.3、滑块 3）与说明文字档（底线 3）
  // 本来就允许更低，拿它们当读数会显示成 1.8:1 / 3.5:1，看起来像出了问题。
  const worst = report.worstBody ?? report.worst
  const ratio = worst === null ? 0 : worst.ratio
  // 面板上只给一个数字，细节放 title —— 用户想追查时能看到是哪一对不达标。
  const detail = [
    `${props.t('readabilityWorst')}: ${ratio.toFixed(2)}:1（${worst === null ? '-' : worst.label}）`,
    `${props.t('readabilityChecks')}: ${report.total}`,
    failing > 0
      ? `${props.t('readabilityFailing')}: ${failing}`
      : props.t('readabilityPass')
  ].join(' · ')
  return h(
    Row,
    { title: props.t('readability'), hint: props.t('readabilityHint') },
    h(
      'span',
      {
        className: failing > 0 ? 'dshb-metric dshb-metric-bad' : 'dshb-metric',
        title: detail
      },
      h('span', { className: 'dshb-metric-value' }, `${ratio.toFixed(1)}:1`),
      h(
        'span',
        { className: 'dshb-metric-tag' },
        failing > 0 ? props.t('readabilityFailing') : props.t('readabilityPass')
      )
    )
  )
}

/** 与宿主开关同形的开关：role=switch + aria-checked，键盘可达。 */
function Switch(props) {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': props.checked,
      className: 'dshb-switch',
      disabled: props.disabled,
      onClick: () => props.onChange(!props.checked)
    },
    h('span', { className: 'dshb-switch-thumb' })
  )
}

/** 分段选择器。 */
function Segmented(props) {
  return h(
    'div',
    { className: 'dshb-segmented', role: 'radiogroup', 'aria-label': props.label },
    props.options.map((option) =>
      h(
        'button',
        {
          key: option.id,
          type: 'button',
          role: 'radio',
          'aria-checked': option.id === props.value,
          className:
            option.id === props.value
              ? 'dshb-segment dshb-segment-active'
              : 'dshb-segment',
          disabled: props.disabled,
          onClick: () => props.onChange(option.id)
        },
        option.name
      )
    )
  )
}

/** 预设卡片：三色样张 + 名称 + 一句话气质。 */
function PresetCard(props) {
  const { preset, active, disabled, onSelect } = props
  return h(
    'button',
    {
      type: 'button',
      role: 'radio',
      'aria-checked': active,
      className: active ? 'dshb-card dshb-card-active' : 'dshb-card',
      disabled,
      onClick: () => onSelect(preset.id)
    },
    h(
      'span',
      { className: 'dshb-card-dots' },
      preset.swatch.map((color, index) =>
        h('span', {
          key: index,
          className: 'dshb-card-dot',
          style: { backgroundColor: color }
        })
      )
    ),
    h('span', { className: 'dshb-card-name' }, preset.name),
    h('span', { className: 'dshb-card-tagline' }, preset.tagline)
  )
}

/**
 * 面板根组件。
 *
 * @param props.controller - 由 index.js 注入的外观控制器（唯一状态宿主）。
 * @param props.t - 本地化函数。
 */
function BeautifyPanel(props) {
  const controller = props.controller
  const t = props.t
  const [state, setState] = React.useState(() => controller.getState())

  React.useEffect(() => controller.subscribe(setState), [controller])

  const disabled = !state.enabled
  const update = (patch) => controller.setState(patch)
  // 求解依赖当前预设，因此换预设时色板跟着更新；求解结果有缓存，代价可忽略。
  const swatches = accentSwatches(state.preset)

  return h(
    'div',
    { className: 'dshb-root' },
    h(
      'header',
      { className: 'dshb-head' },
      h(
        'div',
        null,
        h('h2', { className: 'dshb-title' }, t('title')),
        h('p', { className: 'dshb-subtitle' }, t('subtitle'))
      ),
      h(Switch, {
        checked: state.enabled,
        onChange: (value) => update({ enabled: value })
      })
    ),

    h(
      'section',
      { className: disabled ? 'dshb-body dshb-body-off' : 'dshb-body' },

      h(
        'div',
        { className: 'dshb-group' },
        h('div', { className: 'dshb-group-title' }, t('preset')),
        h(
          'div',
          {
            className: 'dshb-cards',
            role: 'radiogroup',
            'aria-label': t('preset')
          },
          PRESETS.map((preset) =>
            h(PresetCard, {
              key: preset.id,
              preset,
              active: preset.id === state.preset,
              disabled,
              onSelect: (id) => update({ preset: id })
            })
          )
        )
      ),

      h(
        Row,
        { title: t('accent'), hint: t('accentHint') },
        h(
          'div',
          { className: 'dshb-swatches', role: 'radiogroup', 'aria-label': t('accent') },
          // 色板画的是**求解后**的值，不是配色表里的原始值 —— 见 accentSwatches 的说明。
          // 求解依赖预设（要对预设的表面色达标），因此换预设时色板也会跟着微调。
          ACCENTS.map((accent) =>
            h('button', {
              key: accent.id,
              type: 'button',
              role: 'radio',
              'aria-checked': accent.id === state.accent,
              'aria-label': accent.name,
              title: accent.name,
              disabled,
              className:
                accent.id === state.accent
                  ? 'dshb-swatch dshb-swatch-active'
                  : 'dshb-swatch',
              style: {
                '--dshb-swatch-light': swatches[accent.id].light,
                '--dshb-swatch-dark': swatches[accent.id].dark
              },
              onClick: () => update({ accent: accent.id })
            })
          )
        )
      ),

      h(
        Row,
        { title: t('radius'), hint: t('radiusHint') },
        h(Segmented, {
          label: t('radius'),
          value: state.radius,
          disabled,
          options: RADIUS_SCALES,
          onChange: (id) => update({ radius: id })
        })
      ),

      h(
        Row,
        { title: t('corner'), hint: t('cornerHint') },
        h(Segmented, {
          label: t('corner'),
          value: state.corner,
          disabled,
          options: CORNER_SHAPES,
          onChange: (id) => update({ corner: id })
        })
      ),

      h(Readability, { state, t }),

      h(
        Row,
        { title: t('ambient'), hint: t('ambientHint') },
        h(Switch, {
          checked: state.ambient,
          disabled,
          onChange: (value) => update({ ambient: value })
        })
      ),

      h(
        Row,
        { title: t('typography'), hint: t('typographyHint') },
        h(Switch, {
          checked: state.typography,
          disabled,
          onChange: (value) => update({ typography: value })
        })
      ),

      h(
        Row,
        { title: t('taskList'), hint: t('taskListHint') },
        h(Switch, {
          checked: state.taskList,
          disabled,
          onChange: (value) => update({ taskList: value })
        })
      ),

      h(
        Row,
        { title: t('glass'), hint: t('glassHint') },
        h(Switch, {
          checked: state.glass,
          disabled,
          onChange: (value) => update({ glass: value })
        })
      ),

      h(
        Row,
        { title: t('motion'), hint: t('motionHint') },
        h(Switch, {
          checked: state.motion,
          disabled,
          onChange: (value) => update({ motion: value })
        })
      )
    ),

    h(
      'footer',
      { className: 'dshb-foot' },
      h(
        'span',
        { className: 'dshb-foot-note' },
        t('footer'),
        h('span', { className: 'dshb-version' }, `v${VERSION}`)
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'dshb-reset',
          onClick: () => controller.reset()
        },
        t('reset')
      )
    )
  )
}

// ---- src/client/locales.js ---------------------------------------
/**
 * 界面美化 · Lumina —— 设置面板词典。
 *
 * 中英两份键集必须完全一致：宿主在开发期会校验字典完整性，缺键在切换语言时
 * 会露出 key 本身而不是文案。
 */

/** 简体中文（键集的事实来源）。 */
const zh = {
  nav: '界面美化',
  title: '界面美化',
  subtitle: '为 DSH 换一套视觉语言：配色、层次、圆角与排版。改动即时生效。',
  preset: '预设风格',
  accent: '强调色',
  accentHint: '用于主按钮、选中态与链接',
  radius: '圆角',
  radiusHint: '影响卡片、输入框与弹层',
  corner: '圆角形状',
  cornerHint: '圆角是正圆还是方圆形；圆形按钮与胶囊始终是正圆',
  readability: '可读性',
  readabilityHint: '全部文字与底色的对比度下限（WCAG AA）',
  readabilityWorst: '最低',
  readabilityChecks: '检查项',
  readabilityFailing: '未达标',
  readabilityPass: '全部达标',
  ambient: '氛围光',
  ambientHint: '在侧栏叠一层低透明度光斑',
  typography: '内容精修',
  typographyHint: '行高、字距、代码块与表格细节',
  taskList: '任务列表增强',
  taskListHint: '三态一眼可辨：已完成降权划线，进行中高亮',
  glass: '毛玻璃',
  glassHint: '关闭后菜单改为近乎不透明的实色',
  motion: '过渡动效',
  motionHint: '仅过渡颜色，不影响布局与拖拽',
  footer: '偏好保存在本机浏览器，不写入会话配置。',
  reset: '恢复默认'
}

/** English，键集与 zh 一一对应。 */
const en = {
  nav: 'UI Beautify',
  title: 'UI Beautify',
  subtitle:
    'Give DSH a new visual language: palette, depth, radii and typography. Changes apply instantly.',
  preset: 'Preset',
  accent: 'Accent',
  accentHint: 'Used for primary buttons, selection and links',
  radius: 'Corner radius',
  radiusHint: 'Affects cards, inputs and popovers',
  corner: 'Corner shape',
  cornerHint: 'Round or squircle corners; circles and pills stay round',
  readability: 'Legibility',
  readabilityHint: 'Lowest text-on-surface contrast across the palette (WCAG AA)',
  readabilityWorst: 'Lowest',
  readabilityChecks: 'Checks',
  readabilityFailing: 'below target',
  readabilityPass: 'all pass',
  ambient: 'Ambient light',
  ambientHint: 'Adds a low-opacity glow to the sidebar',
  typography: 'Content polish',
  typographyHint: 'Line height, letter spacing, code and tables',
  taskList: 'Task list clarity',
  taskListHint: 'Done fades out, in-progress stands out',
  glass: 'Translucent menus',
  glassHint: 'Turn off for near-opaque menu surfaces',
  motion: 'Transitions',
  motionHint: 'Colour only — layout and dragging are untouched',
  footer: 'Preferences stay in this browser, not in session config.',
  reset: 'Reset'
}

// ---- src/client/index.js -----------------------------------------
/**
 * 界面美化 · Lumina —— 客户端插件入口。
 *
 * 本文件是 bundle 的入口，构建脚本（scripts/build.mjs）会把它与同目录下的
 * 模块拼成一个 `window.__ModuleLoader__.load({ id, factory })` 的经典脚本。
 * 之所以手写而不是用 tsdown/rolldown：宿主模块加载器只保证 `react`、
 * `react-dom`、`react/jsx-runtime` 与 `@deepseek-ai/*` 可 require，插件自身的
 * 代码不依赖任何第三方包，因此一套零依赖的拼接式构建就够，且产物可逐行审阅。
 */





/** 插件 id，必须与 package.json 的 name 一致 —— 加载器用它做模块登记。 */
const NS = 'dsh-ui-beautify'

const name = NS

/**
 * 依赖的客户端服务。
 * - `theme`：唯一的外观写入通道（overrideTokens）。
 * - `slots`：把设置面板挂进「设置」分区。
 * - `locale`：中英文案。
 */
const inject = ['theme', 'slots', 'locale']

/**
 * 组装一个不会抛错的本地化函数。
 *
 * 面板的渲染不能被文案层拖垮：字典缺失、命名空间拼错、locale 服务尚未就绪，
 * 都应当退化成显示 key 而不是让整个设置页白屏。
 *
 * @param ctx - 客户端 cordis 上下文。
 * @returns (key: string) => string
 */
function localized(ctx) {
  let bound
  try {
    bound = ctx.locale.bind(NS)
  } catch {
    bound = undefined
  }
  return (key) => {
    if (typeof bound === 'function') {
      try {
        const value = bound(key)
        if (typeof value === 'string' && value.length > 0) return value
      } catch {
        /* 落到内置中文兜底 */
      }
    }
    return zh[key] ?? key
  }
}

/**
 * 客户端插件体。
 * @param ctx - 客户端 cordis 上下文。
 */
function apply(ctx) {
  const controller = createController({ theme: ctx.theme })
  const t = localized(ctx)

  // 外观层：首次投射 + 卸载时把令牌、属性、样式标签全部撤回。
  ctx.effect(() => controller.mount(), `${NS}: 外观层`)

  // 词典：两套语言键集一致。
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: 词典`)

  // 设置面板：挂进「设置」分区，排在社区插件市场之后。
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: NS,
        order: 70,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ controller })
      },
      () => React.createElement(BeautifyPanel, { controller, t })
    )
  )
}

		exports.apply = apply
		exports.inject = inject
		exports.name = name
		return module.exports
	}
})
