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
export function parseHex(value) {
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
export function toHex(color) {
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
export function luminance(color) {
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
export function composite(foreground, background) {
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
export function contrast(foreground, background) {
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
export function tint(base, color, amount) {
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
export function alpha(hex, amount) {
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
export function fadeOut(color) {
  const parsed = parseHex(color)
  return parsed === null ? color : `${toHex(parsed)}00`
}

// ------------------------------------------------------------------ HSL

/** 十六进制 → `{ h: 0–360, s: 0–1, l: 0–1 }`。 */
export function toHsl(color) {
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
export function fromHsl(h, s, l) {
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
export function analyzeBackdrops(backgrounds) {
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
export function solveTone(color, backgrounds, target) {
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
export function solveColor(color, requirements) {
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
export function ensureContrast(color, against, target) {
  return solveTone(color, [against], target)
}
