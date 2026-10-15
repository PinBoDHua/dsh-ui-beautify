/**
 * 界面美化 · Lumina —— 静态审计。
 *
 * 构建脚本只保证「产物是一个合法插件」，本脚本回答一个更难的问题：
 * 「插件声称要改的东西，宿主真的有吗？」覆盖四类静默失效：
 *
 *   1. 覆盖了宿主从未声明的令牌名 —— 不报错，只是什么都不发生；
 *   2. 令牌值不是 { light, dark } 对 —— 宿主运行时会抛错，界面上是白屏；
 *   3. CSS 里 var() 引用了不存在或拼错的变量 —— 属性静默失效；
 *   4. 样式表与控制器对 data-dshb-* 属性的约定不一致 —— 开关点了没反应。
 *
 * 另外做几项一致性校验：词典键集、面板类名、预设样张、默认状态引用。
 *
 *   node scripts/check.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'client')

const problems = []
const notes = []

/** 记录一个问题。 */
const bad = (message) => problems.push(message)
/** 记录一条通过项。 */
const ok = (message) => notes.push(message)

// ------------------------------------------------------------ 载入被测对象

const presets = await import(
  new URL('../src/client/presets.js', import.meta.url).href
)
const state = await import(new URL('../src/client/state.js', import.meta.url).href)
const locales = await import(new URL('../src/client/locales.js', import.meta.url).href)

const { ACCENTS, PRESETS, RADIUS_SCALES, buildTokens } = presets
const { DEFAULT_STATE, normalizeState } = state

const cssFiles = readdirSync(join(SRC, 'styles')).filter((f) => f.endsWith('.css'))
const css = Object.fromEntries(
  cssFiles.map((f) => [f, readFileSync(join(SRC, 'styles', f), 'utf8')])
)
const controllerSource = readFileSync(join(SRC, 'controller.js'), 'utf8')
const panelSource = readFileSync(join(SRC, 'panel.js'), 'utf8')
const panelCss = css['panel.css'] ?? ''
const bundle = readFileSync(join(ROOT, 'client', 'client.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

/** 去掉 CSS 注释，避免注释里的示例选择器/变量名干扰检查。 */
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

// ------------------------------------------------- 1. 令牌名是否宿主真的声明

const hostTokens = existsSync(join(ROOT, 'reference', 'host-tokens.json'))
  ? new Set(
      JSON.parse(readFileSync(join(ROOT, 'reference', 'host-tokens.json'), 'utf8'))
        .tokens
    )
  : null

if (hostTokens === null) {
  bad('缺少 reference/host-tokens.json —— 无法校验令牌名，请先运行 scripts/host-tokens.mjs')
}

// ------------------------------------------- 2. 全组合令牌值形状 + 名字有效性

const combos = []
for (const preset of PRESETS) {
  for (const accent of ACCENTS) {
    for (const radius of RADIUS_SCALES) {
      for (const ambient of [true, false]) {
        for (const motion of [true, false]) {
          for (const typography of [true, false]) {
            for (const glass of [true, false]) {
              combos.push({
                enabled: true,
                preset: preset.id,
                accent: accent.id,
                radius: radius.id,
                ambient,
                motion,
                typography,
                glass
              })
            }
          }
        }
      }
    }
  }
}

let tokenCount = 0
const overriddenNames = new Set()
for (const combo of combos) {
  const tokens = buildTokens(combo)
  const label = `${combo.preset}/${combo.accent}/${combo.radius}/t${combo.typography ? 1 : 0}`
  for (const [name, value] of Object.entries(tokens)) {
    overriddenNames.add(name)
    if (value === null || typeof value !== 'object') {
      bad(`${label}: 令牌 ${name} 不是对象（宿主 validateOverrides 会抛错）`)
      continue
    }
    if (typeof value.light !== 'string' || typeof value.dark !== 'string') {
      bad(`${label}: 令牌 ${name} 缺少 light/dark 字符串对`)
      continue
    }
    if (value.light.trim() === '' || value.dark.trim() === '') {
      bad(`${label}: 令牌 ${name} 的 light/dark 为空串`)
    }
    if (value.light === 'undefined' || value.dark === 'undefined') {
      bad(`${label}: 令牌 ${name} 取到了 undefined —— 预设表缺键`)
    }
  }
  tokenCount += Object.keys(tokens).length
}

ok(`令牌形状：${combos.length} 种状态组合、${tokenCount} 次取值全部为 { light, dark } 字符串对`)

if (hostTokens) {
  const unknown = [...overriddenNames].filter(
    (name) => !name.startsWith('--dshb-') && !hostTokens.has(name)
  )
  if (unknown.length > 0) {
    bad(
      `以下令牌在宿主基准表里不存在，覆盖将静默无效：\n      ${unknown.join('\n      ')}`
    )
  } else {
    const hostOwned = [...overriddenNames].filter((n) => !n.startsWith('--dshb-'))
    ok(
      `令牌名：覆盖的 ${hostOwned.length} 个宿主令牌全部存在于基准表（共 ${hostTokens.size} 个）`
    )
  }
}

// ------------------------------------------------ 3. CSS var() 引用是否可解析

/** 本插件自己声明过的变量：tokens 里的 --dshb-*、CSS 里的赋值、JS 行内样式对象的键。 */
const selfDeclared = new Set(
  [...overriddenNames].filter((name) => name.startsWith('--dshb-'))
)
for (const [file, text] of Object.entries(css)) {
  for (const match of stripCssComments(text).matchAll(/(--[a-z0-9-]+)\s*:/gi)) {
    selfDeclared.add(match[1])
  }
}
// React 行内样式对象：{ '--dshb-x': value } —— 变量在运行时才落到元素上，
// 静态检查必须把这类声明点也算进来，否则会误报「无法解析」。
for (const file of ['panel.js', 'index.js', 'controller.js']) {
  const text = readFileSync(join(SRC, file), 'utf8')
  for (const match of text.matchAll(/'(--dshb-[a-z0-9-]+)'\s*:/g)) {
    selfDeclared.add(match[1])
  }
}

const unresolved = new Map()
for (const [file, text] of Object.entries(css)) {
  const clean = stripCssComments(text)
  for (const match of clean.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    const name = match[1]
    if (selfDeclared.has(name)) continue
    if (hostTokens?.has(name)) continue
    if (!unresolved.has(name)) unresolved.set(name, new Set())
    unresolved.get(name).add(file)
  }
}
if (unresolved.size > 0) {
  for (const [name, files] of unresolved) {
    bad(`CSS 引用了无法解析的变量 ${name}（出现在 ${[...files].join(', ')}）`)
  }
} else {
  ok(`CSS 变量引用：${cssFiles.length} 张样式表里的 var() 全部可解析`)
}

// --------------------------------------- 4. data-dshb-* 属性约定是否两端一致

const ATTRIBUTE_RE = /data-dshb-[a-z-]+/g
const usedInCss = new Set(
  Object.values(css).flatMap((text) =>
    (stripCssComments(text).match(ATTRIBUTE_RE) ?? []).map((s) => s)
  )
)

/** 控制器里 FLAGS / SELECTORS 的值。 */
const declaredInController = new Set(
  [...controllerSource.matchAll(/'(data-dshb-[a-z-]+)'/g)].map((m) => m[1])
)

const orphan = [...usedInCss].filter((a) => !declaredInController.has(a))
if (orphan.length > 0) {
  bad(`样式表使用了控制器从不设置的属性：${orphan.join(', ')}（开关点了不会有反应）`)
} else {
  ok(`属性约定：样式表使用的 ${usedInCss.size} 个 data-dshb-* 属性全部由控制器设置`)
}

const unusedByCss = [...declaredInController].filter((a) => !usedInCss.has(a))
if (unusedByCss.length > 0) {
  notes.push(
    `  · 控制器设置的属性中，样式表未直接使用（作为公开状态标记发布，见 README）：${unusedByCss.join(', ')}`
  )
}

// ------------------------------------------- 4.5 正圆必须配对 corner-shape: round

/**
 * 遍历 CSS 的叶子声明块（块内不含花括号），产出 `{ selector, body }`。
 * 只看叶子块，避免 `@media` 外层块把内层规则的声明误算成自己的。
 */
function leafBlocks(text) {
  const blocks = []
  const stack = []
  let boundary = 0
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      stack.push({ selector: text.slice(boundary, i).trim(), bodyStart: i + 1 })
    } else if (text[i] === '}') {
      const open = stack.pop()
      if (open) {
        const body = text.slice(open.bodyStart, i)
        if (!body.includes('{')) blocks.push({ selector: open.selector, body })
      }
      boundary = i + 1
    }
  }
  return blocks
}

/**
 * 宿主 corner-shape.css 通过 `*,:before,:after { corner-shape: superellipse(1.5) }`
 * 把所有圆角平滑成方圆形。正圆与胶囊会被它压变形，宿主因此约定：这类形状必须
 * 在所属组件样式表里把 `corner-shape: round` 与半径声明配对。
 * 违反这条不会报错，只会让圆看起来「不太圆」—— 正是最需要机器来盯的那类问题。
 */
const PILL_RADIUS = /border-radius\s*:\s*(50%|999px|\d{3,}px)/
const unpairedCircles = []
for (const [file, text] of Object.entries(css)) {
  for (const block of leafBlocks(stripCssComments(text))) {
    if (!PILL_RADIUS.test(block.body)) continue
    if (!/corner-shape\s*:\s*round/.test(block.body)) {
      unpairedCircles.push(`${file} → ${block.selector}`)
    }
  }
}
if (unpairedCircles.length > 0) {
  bad(
    `以下规则用了正圆/胶囊半径但没有配对 corner-shape: round，\n` +
      `      会被宿主全局的 superellipse 压成方圆形：\n      ${unpairedCircles.join('\n      ')}`
  )
} else {
  ok('正圆约定：所有 50%/胶囊半径都配对了 corner-shape: round')
}

// -------------------------------------- 4.6 氛围光不得挂在窗口框架上

/**
 * 这条断言来自一个真实缺陷：氛围光最初同时挂在框架（`[class*='_frame']`）上。
 * 框架本被两列完全盖住，唯一露出的地方是 Windows 标题栏模式下中心列左上角
 * 那个 `border-radius: 16px` 的圆角 —— 而 background-image 的默认原点
 * （background-origin: padding-box）恰好就在内容区左上角。于是圆角里露出的
 * 是光斑最亮的那一点，被切成一块带硬边的蓝色楔形，在浅色下非常显眼。
 *
 * 框架不需要氛围光：它可见的部分只有标题栏拖拽带（被 `:before` 盖住）和
 * 上述圆角露出的区域，而那两处应当是与侧栏连续的纯色。
 */
const ambientRules = leafBlocks(stripCssComments(css['base.css'] ?? ''))
  .filter((block) => block.selector.includes('data-dshb-ambient'))
  .filter((block) => /background(-image)?\s*:/.test(block.body))
const ambientOnFrame = ambientRules.filter((block) =>
  /_frame/.test(block.selector)
)
if (ambientOnFrame.length > 0) {
  bad(
    `氛围光被挂到了窗口框架上，会在内容区左上角圆角处露出带硬边的色块：\n` +
      `      ${ambientOnFrame.map((b) => b.selector).join('\n      ')}`
  )
} else {
  ok(`氛围光作用域：${ambientRules.length} 条规则均未挂在窗口框架上`)
}

// ------------------------------------ 4.7 安全修正层必须只做它声明的事

/**
 * safety.css 里那条规则修的是「灯箱关闭按钮被原生窗口按钮盖住」。
 * 它必须满足两个条件，否则会变成纯粹的乱改：
 *   1. 只在 Windows 标题栏模式下生效（`[data-windows-titlebar]`）——
 *      其它平台没有原生覆盖层，动了就是纯粹的位移；
 *   2. 位移量引用宿主自己发布的 `--dsh-frame-overlay-top`，而不是写死像素 ——
 *      宿主在全屏时会把该变量降回 20px，写死就丢了这条自适应。
 */
const safetyCss = stripCssComments(css['safety.css'] ?? '')
const safetyRules = leafBlocks(safetyCss)
if (safetyRules.length === 0) {
  bad('safety.css 里没有任何规则 —— 安全修正层要么有内容，要么不该存在')
}
for (const block of safetyRules) {
  if (!block.body.includes('--dsh-frame-overlay-top')) {
    bad(`安全修正规则没有引用宿主变量 --dsh-frame-overlay-top：${block.selector}`)
  }
  if (!block.selector.includes('data-windows-titlebar')) {
    bad(`安全修正规则没有限定在 Windows 标题栏模式下：${block.selector}`)
  }
}
if (safetyRules.length > 0) {
  ok(`安全修正层：${safetyRules.length} 条规则，均限定 Windows 标题栏模式且引用宿主变量`)
}

// ------------------------------------ 4.8 任务列表增强层的选择器纪律

/**
 * 任务列表增强靠宿主的两个**有意暴露**的钩子定位：面板根的
 * `data-testid="todo-panel"` 与任务项的 `data-status`。两者都写死在宿主的 JSX 里
 * （`data-testid` 更是全应用唯一一处），因此跨构建稳定。
 *
 * 但宿主同时发布了 `aSus8q_item` 这类编译哈希类名 —— 它们能选中同样的元素，
 * 却会在宿主下次构建时静默失效。这条断言把「误用哈希类名」变成构建期失败。
 */
const taskListRules = leafBlocks(stripCssComments(css['task-list.css'] ?? ''))
if (taskListRules.length === 0) {
  bad('task-list.css 里没有任何规则 —— 任务列表增强层要么有内容，要么不该存在')
}
const HASHED_CLASS = /\.[a-z0-9]{5,6}_[A-Za-z]/i
for (const block of taskListRules) {
  if (!block.selector.includes('data-dshb-tasklist')) {
    bad(`任务列表规则没有限定在 data-dshb-tasklist 下：${block.selector}`)
  }
  // ::before 规则的选择器里天然不会重复面板锚点，由主体规则背书
  const anchored =
    block.selector.includes('data-testid') || block.selector.includes('::before')
  if (!anchored) {
    bad(`任务列表规则没有锚定 data-testid="todo-panel"：${block.selector}`)
  }
  if (HASHED_CLASS.test(block.selector)) {
    bad(`任务列表规则用了编译哈希类名，宿主再次构建即失效：${block.selector}`)
  }
}
if (taskListRules.length > 0) {
  ok(
    `任务列表增强层：${taskListRules.length} 条规则，全部锚定 data-testid/data-status，无哈希类名`
  )
}

// ------------------------------------ 4.9 不要再给 <pre> 加边框

/**
 * 这条断言来自一个真实缺陷：第一版给所有 `pre` 加了边框 + 圆角 + 内高光，
 * 理由是「大面积实色显得扁平」。但宿主的代码块把圆角与底色放在 `pre` 自己身上
 * （`.block :where(pre) { border-bottom-*-radius: var(--dsw-radius-lg) }`），
 * 那条规则于是在代码卡片内部套出了第二层细圆角边框。
 *
 * 官方基线是单层干净卡片。要动代码块外观，请改令牌
 * （`--dsw-alias-markdown-code-block` 等），不要在样式表里加框。
 */
const prePaintRules = Object.entries(css).flatMap(([file, text]) =>
  leafBlocks(stripCssComments(text))
    .filter((block) => /(^|[\s,>])pre\b/.test(block.selector))
    .filter((block) =>
      /(^|;|\s)border(-[a-z]+)?\s*:|box-shadow\s*:/.test(block.body)
    )
    .map((block) => `${file} → ${block.selector}`)
)
if (prePaintRules.length > 0) {
  bad(
    `以下规则给 <pre> 加了边框或外框阴影，会在宿主代码卡片里套出第二层框：\n      ${prePaintRules.join('\n      ')}`
  )
} else {
  ok('代码块约束：没有任何规则给 <pre> 加边框或外框阴影')
}

// ----------------------------------------------------------- 5. 面板类名闭环

const classesDefined = new Set(
  [...stripCssComments(panelCss).matchAll(/\.(dshb-[a-z0-9-]+)/g)].map((m) => m[1])
)
const classesUsed = new Set()
for (const match of panelSource.matchAll(/'([^']*)'/g)) {
  for (const token of match[1].split(/\s+/)) {
    if (token.startsWith('dshb-')) classesUsed.add(token)
  }
}
const missingClasses = [...classesUsed].filter((c) => !classesDefined.has(c))
if (missingClasses.length > 0) {
  bad(`面板使用了未定义的类名：${missingClasses.join(', ')}（会渲染成无样式元素）`)
} else {
  ok(`面板类名：使用的 ${classesUsed.size} 个 dshb-* 类名全部有样式定义`)
}

// ------------------------------------------------------------- 6. 词典一致性

const zhKeys = Object.keys(locales.zh).sort()
const enKeys = Object.keys(locales.en).sort()
if (zhKeys.join('|') !== enKeys.join('|')) {
  const onlyZh = zhKeys.filter((k) => !enKeys.includes(k))
  const onlyEn = enKeys.filter((k) => !zhKeys.includes(k))
  bad(`词典键集不一致：仅中文 [${onlyZh}]，仅英文 [${onlyEn}]`)
} else {
  ok(`词典：zh/en 各 ${zhKeys.length} 个键，键集完全一致`)
}
for (const [lang, dict] of Object.entries(locales)) {
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value !== 'string' || value.trim() === '') {
      bad(`词典 ${lang}.${key} 为空`)
    }
  }
}

// ------------------------------------- 7. 面板用到的键是否都在词典里声明

const usedKeys = new Set(
  [...panelSource.matchAll(/\bt\(\s*'([a-zA-Z]+)'\s*\)/g)].map((m) => m[1])
)
const missingKeys = [...usedKeys].filter((k) => !(k in locales.zh) || !(k in locales.en))
if (missingKeys.length > 0) {
  bad(`面板调用了词典里没有的键：${missingKeys.join(', ')}`)
} else {
  ok(`面板文案：调用的 ${usedKeys.size} 个键全部在词典中`)
}

// --------------------------------------------------------- 8. 预设表自洽性

for (const collection of [
  ['预设', PRESETS],
  ['强调色', ACCENTS],
  ['圆角', RADIUS_SCALES]
]) {
  const [label, list] = collection
  const ids = list.map((item) => item.id)
  const dupes = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (dupes.length > 0) bad(`${label} id 重复：${[...new Set(dupes)].join(', ')}`)
}
for (const preset of PRESETS) {
  if (!Array.isArray(preset.swatch) || preset.swatch.length !== 3) {
    bad(`预设 ${preset.id} 的 swatch 必须是 3 个颜色`)
    continue
  }
  for (const color of preset.swatch) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      bad(`预设 ${preset.id} 的 swatch 含非 6 位十六进制颜色：${color}`)
    }
  }
  for (const mode of ['light', 'dark']) {
    const neutral = preset.neutral[mode]
    const shadow = preset.shadow[mode]
    for (const key of [
      'canvas', 'surface1', 'sidebar', 'ink', 'inkSecondary', 'border2'
    ]) {
      if (typeof neutral[key] !== 'string') {
        bad(`预设 ${preset.id}.${mode} 缺少中性色键 ${key}`)
      }
    }
    for (const key of ['stroke', 'lv1', 'lv2', 'lv3', 'panel', 'prominent', 'soft']) {
      if (typeof shadow[key] !== 'string') {
        bad(`预设 ${preset.id}.${mode} 缺少阴影键 ${key}`)
      }
    }
  }
}
for (const accent of ACCENTS) {
  for (const mode of ['light', 'dark']) {
    if (!/^#[0-9a-f]{6}$/i.test(accent[mode])) {
      bad(`强调色 ${accent.id}.${mode} 不是 6 位十六进制颜色：${accent[mode]}`)
    }
  }
}
ok(`预设表：${PRESETS.length} 个预设 / ${ACCENTS.length} 个强调色 / ${RADIUS_SCALES.length} 个圆角档自洽`)

// --------------------------------------------- 8.5 圆角阶梯的设计约束

/**
 * 宿主的 `--dsw-radius-md` 同时用在 32px 高的输入框、34–36px 高的按钮/菜单行
 * 和卡片上。半径占控件高度一半（16px）时，输入框就塌成胶囊；第一版「圆润」档
 * 统一乘 1.4 得到 17px，正是这个后果。
 *
 * 因此把上限定在 14px（占 32px 的 44%），并把约束写成断言，
 * 避免下次「顺手把圆润档再调大一点」时又踩回去。
 * 另外要求阶梯单调不减：xs ≤ sm ≤ md ≤ lg ≤ xl ≤ panel，否则小控件的
 * 圆角会比大卡片还大，层次感直接反了。
 */
const RADIUS_MD_CEILING = 15
const RADIUS_MD_RATIONALE = '32px 高输入框的 44%（14px）'
const RADIUS_ORDER = ['xs', 'sm', 'md', 'lg', 'xl', 'panel']
for (const tier of RADIUS_SCALES) {
  for (const key of RADIUS_ORDER) {
    const value = tier.radii?.[key]
    if (!Number.isInteger(value) || value <= 0) {
      bad(`圆角档 ${tier.id} 缺少合法取值：${key} = ${value}`)
    }
  }
  const md = tier.radii?.md
  if (Number.isInteger(md) && md >= RADIUS_MD_CEILING) {
    bad(
      `圆角档 ${tier.id} 的 md = ${md}px 超过上限 ${RADIUS_MD_RATIONALE}，` +
        `32px 高的输入框会塌成胶囊`
    )
  }
  const values = RADIUS_ORDER.map((key) => tier.radii?.[key])
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] < values[i - 1]) {
      bad(
        `圆角档 ${tier.id} 的阶梯非单调：${RADIUS_ORDER[i - 1]}=${values[i - 1]} > ${RADIUS_ORDER[i]}=${values[i]}`
      )
    }
  }
  if (tier.contentRadius !== tier.radii?.lg) {
    bad(
      `圆角档 ${tier.id} 的 contentRadius (${tier.contentRadius}) 应等于 lg (${tier.radii?.lg})，` +
        `否则内容区左上角会与相邻表面脱节`
    )
  }
}
ok(
  `圆角阶梯：${RADIUS_SCALES.length} 档全部单调、md ≤ ${RADIUS_MD_CEILING - 1}px（${RADIUS_MD_RATIONALE}）、contentRadius 对齐 lg`
)

// ------------------------------------------------- 9. 默认状态必须指向合法 id

const normalized = normalizeState(DEFAULT_STATE, {
  preset: PRESETS.map((p) => p.id),
  accent: ACCENTS.map((a) => a.id),
  radius: RADIUS_SCALES.map((r) => r.id)
})
if (JSON.stringify(normalized) !== JSON.stringify({ ...DEFAULT_STATE })) {
  bad('DEFAULT_STATE 含非法取值，归一化后发生了变化')
} else {
  ok('默认状态：归一化后与 DEFAULT_STATE 完全一致（枚举引用有效）')
}

// 非法输入必须被挡住，不能把 undefined 传进预设表
const garbage = normalizeState(
  { preset: 'nonexistent', accent: 42, radius: null, ambient: 'yes', glass: 1 },
  {
    preset: PRESETS.map((p) => p.id),
    accent: ACCENTS.map((a) => a.id),
    radius: RADIUS_SCALES.map((r) => r.id)
  }
)
if (JSON.stringify(garbage) !== JSON.stringify({ ...DEFAULT_STATE })) {
  bad(`脏输入没有被正确归一化：${JSON.stringify(garbage)}`)
} else {
  ok('脏输入防护：非法枚举/类型全部回落到默认值')
}

// ------------------------------------------------- 10. 产物二次校验（按文件）

try {
  new vm.Script(bundle, { filename: 'client/client.js' })
  ok('产物语法：client/client.js 可被解析为经典脚本')
} catch (error) {
  bad(`产物无法解析：${error.message}`)
}
if (!bundle.includes(`id: ${JSON.stringify(manifest.name)}`)) {
  bad(`产物登记 id 与 package.json name (${manifest.name}) 不一致`)
} else {
  ok(`产物登记 id：${manifest.name}`)
}
if (!bundle.includes('window.__ModuleLoader__.load(')) {
  bad('产物未通过 window.__ModuleLoader__.load 登记 —— 宿主加载不到')
}
for (const key of ['name', 'inject', 'apply']) {
  if (!bundle.includes(`exports.${key} = ${key}`)) bad(`产物缺少 exports.${key}`)
}
for (const match of bundle.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
  if (match[1] !== 'react') bad(`产物 require 了非预期模块：${match[1]}`)
}

// 客户端清单与入口导出的 inject 必须能对上
const manifestInject = manifest.dsh?.client?.inject ?? []
if (!Array.isArray(manifestInject) || manifestInject.length === 0) {
  bad('package.json 的 dsh.client.inject 为空')
} else {
  ok(`客户端清单：dsh.client.inject 声明了 ${manifestInject.length} 个依赖`)
  for (const id of ['@deepseek-ai/dsh-client-ui-theme', '@deepseek-ai/dsh-client-ui-slots']) {
    if (!manifestInject.includes(id)) bad(`dsh.client.inject 缺少必需依赖 ${id}`)
  }
}

// -------------------------------------------------------------------- 结论

console.log('通过项：')
for (const note of notes) console.log(`  ✓ ${note}`)
if (problems.length > 0) {
  console.error(`\n发现 ${problems.length} 个问题：`)
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  process.exit(1)
}
console.log('\n静态审计全部通过。')
