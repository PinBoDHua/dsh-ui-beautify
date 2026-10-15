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
const readability = await import(
  new URL('../src/client/readability.js', import.meta.url).href
)
const colorMath = await import(new URL('../src/client/color.js', import.meta.url).href)

const { ACCENTS, CORNER_SHAPES, PRESETS, RADIUS_SCALES, buildTokens } = presets
const { DEFAULT_STATE, normalizeState } = state
const {
  AA,
  PAIRS,
  TEXT_TIERS,
  DELIBERATE,
  HOST_FALLBACK,
  HOST_GAPS,
  INFEASIBLE,
  UNCOVERED,
  evaluate,
  surfaceColors
} = readability
const { analyzeBackdrops, contrast, luminance, parseHex, tint, toHsl } = colorMath

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
  // 基准表是**维护者快照**（输入是宿主的样式资源，不进仓库也不进安装副本，
  // 见 install.mjs 的 COPY_EXCLUDE）。因此缺失时降级为提示，而不是失败 ——
  // 「装好的插件里 `npm run check` 报缺少 reference/…」是一句对用户毫无意义的错误，
  // 而它会连带报出一串假的「变量无法解析」。真正的护栏在维护者检出里跑。
  notes.push(
    '  · 缺少 reference/host-tokens.json —— 跳过了「覆盖的令牌名是否宿主真的声明过」这条校验。' +
      '在维护者检出里运行 `node scripts/host-tokens.mjs <提取目录> reference/host-tokens.json` 生成。'
  )
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
  // 基准表记的是「宿主**声明过**的令牌」。插件还有两类例外，都在
  // readability.js 里逐条写明了理由，并由下面的断言核对：
  //   · HOST_GAPS —— 宿主从未声明、却真的在被消费（补上它才是修缺陷）；
  //   · UNCOVERED / DELIBERATE —— 见 9.9 节。
  const declaredGaps = new Set(Object.keys(HOST_GAPS))
  const unknown = [...overriddenNames].filter(
    (name) =>
      !name.startsWith('--dshb-') && !hostTokens.has(name) && !declaredGaps.has(name)
  )
  if (unknown.length > 0) {
    bad(
      `以下令牌在宿主基准表里不存在，覆盖将静默无效（若确实是宿主缺口，请登记进 HOST_GAPS）：\n      ${unknown.join('\n      ')}`
    )
  } else {
    const hostOwned = [...overriddenNames].filter((n) => !n.startsWith('--dshb-'))
    const inBaseline = hostOwned.filter((name) => hostTokens.has(name)).length
    ok(
      `令牌名：覆盖的 ${hostOwned.length} 个宿主令牌中，${inBaseline} 个存在于基准表` +
        `（共 ${hostTokens.size} 个），另有 ${hostOwned.length - inBaseline} 个是已登记并逐个核对的宿主缺口`
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

// ------------------------------------------------- 9.5 可读性契约（v1.2 新增）

/**
 * v1.2 把「配色读得出来」写成了 `src/client/readability.js` 里的契约，色彩由
 * `buildTokens` 求解。这一节是它的**构建期护栏**：任何一次改色、加预设、加强调色
 * 导致某个组合掉到达标线以下，都在这里失败 —— 而不是等用户在某个预设的浅色
 * 模式下发现按钮上的字发虚。
 *
 * 覆盖范围包含 `glass` 开关：它会替换菜单材质的填充色，而菜单项文字压在它上面。
 * `typography` / `ambient` 只改字体与光斑，不改任何一个契约配对。
 */
const CONTRACT_STATES = []
for (const preset of PRESETS) {
  for (const accent of ACCENTS) {
    for (const glass of [true, false]) {
      CONTRACT_STATES.push({
        enabled: true,
        preset: preset.id,
        accent: accent.id,
        radius: 'standard',
        ambient: true,
        motion: true,
        typography: true,
        glass
      })
    }
  }
}

let contractChecks = 0
const contractFailures = []
const contractMissing = []
for (const combo of CONTRACT_STATES) {
  const tokens = buildTokens(combo)
  for (const mode of ['light', 'dark']) {
    const report = evaluate(tokens, mode)
    contractChecks += report.checks.filter((c) => c.ratio !== null).length
    for (const failure of report.failures) {
      contractFailures.push(
        `${combo.preset}/${combo.accent}/${mode} ${failure.id}（${failure.label}）` +
          ` ${failure.ratio.toFixed(2)} < ${failure.min}  ${failure.fgValue} on ${failure.bgValue}`
      )
    }
    for (const absent of report.missing) {
      contractMissing.push(
        `${combo.preset}/${combo.accent}/${mode} ${absent.id}：取值缺失（${absent.absent}）`
      )
    }
  }
}
if (contractFailures.length > 0) {
  bad(
    `可读性契约未达标 ${contractFailures.length} 处（共 ${contractChecks} 次断言）：\n      ` +
      contractFailures.slice(0, 12).join('\n      ') +
      (contractFailures.length > 12 ? `\n      … 另有 ${contractFailures.length - 12} 处` : '')
  )
} else {
  ok(
    `可读性契约：${CONTRACT_STATES.length} 种状态 × 2 明暗、${contractChecks} 次断言全部达标`
  )
}
if (contractMissing.length > 0) {
  bad(
    `可读性契约中有配对取不到值 ${contractMissing.length} 处：\n      ` +
      contractMissing.slice(0, 8).join('\n      ')
  )
} else {
  ok(`可读性契约：${PAIRS.length} 条配对全部能取到取值（无缺失）`)
}

// 契约里出现、但插件**有意不覆盖**的令牌，必须真的不在覆盖层里 ——
// 否则 fallback 是一段死代码，评估的也不是真正生效的值。
const overrideNames = new Set()
for (const combo of CONTRACT_STATES) {
  for (const name of Object.keys(buildTokens(combo))) overrideNames.add(name)
}
for (const name of Object.keys(HOST_FALLBACK)) {
  if (overrideNames.has(name)) {
    bad(
      `HOST_FALLBACK 里的 ${name} 其实已被插件覆盖 —— fallback 成了死代码，` +
        `契约评估的不是真实生效值。请把它从 HOST_FALLBACK 移除。`
    )
  }
  if (hostTokens && !hostTokens.has(name)) {
    bad(`HOST_FALLBACK 里的 ${name} 不在宿主令牌基准表里`)
  }
}

// fallback 是**声明**而不是猜测。v1.2 在这里只打印了一句「都声明了官方取值并经
// 基准表校验」—— 那是一条恒真的语句，而基准表当时也没有取值可比。真正的比对
// 搬到了 9.9 节的断言 C（拿 reference/host-consumers.json 里宿主**声明过的值**
// 逐条核对，含一层 var() 解析），因此这里不再重复一句不会失败的话。

// 背景组必须同侧：混侧时求解器的可行区间可能为空，那属于设计错误，
// 应当在构建期暴露，而不是让求解器给出一个奇怪的颜色。
//
// 「同侧」还不够。求解器对每个约束只做一次二分，这依赖「候选解始终待在表面的
// 另一侧」—— 一旦候选色的明度越过表面自身的明度，对比度会折返（先降到 1:1 再升
// 回去），单调性失效（实测对 #808080 这样的中间调背景，全程约 1840 档非单调）。
// 因此真正要守住的是**墨色种子与表面之间的明度间隔**：
// 有间隔 ⇒ 搜索区间落在表面另一侧 ⇒ 单调。
// 实测亮侧表面最低 0.818、亮侧墨最高 0.370（间隔 0.45）；暗侧表面最高 0.028、
// 暗侧墨最低 0.155（间隔 0.13）。这里要求至少 0.25 / 0.08，留出余量。
//
// 注意这条断言测的是**墨与表面的间隔**，不是「表面落在极亮/极暗两端」——
// v1.2 的注释把两者混为一谈，于是一份表面全在 0.52–0.62 中间带的合成预设
// 也能通过（间隔 0.31）。真正要守的那条由此处的 `SURFACE_BAND` 断言补上，
// 它直接检查契约用到的每一支底色：要么极亮、要么极暗，没有中间地带。
const INK_GAP = { light: 0.25, dark: 0.08 }
const INK_KEYS = ['ink', 'inkDimmed', 'inkSecondary', 'inkTertiary', 'inkCaption']
for (const preset of PRESETS) {
  for (const mode of ['light', 'dark']) {
    const neutral = preset.neutral[mode]
    const surfaces = surfaceColors(neutral)
    const side = analyzeBackdrops(surfaces)
    if (side === 'mixed') {
      bad(
        `预设 ${preset.id}.${mode} 的表面色跨了亮/暗两侧（${surfaces.join(', ')}）——` +
          `文字求解器的前提不成立`
      )
      continue
    }
    const inks = INK_KEYS.map((key) => luminance(neutral[key]))
    const ink = side === 'light' ? Math.max(...inks) : Math.min(...inks)
    const values = surfaces.map(luminance)
    const surface = side === 'light' ? Math.min(...values) : Math.max(...values)
    const gap = Math.abs(surface - ink)
    if (gap < INK_GAP[side]) {
      bad(
        `预设 ${preset.id}.${mode} 的墨色与表面只差 ${gap.toFixed(3)} 明度` +
          `（${side} 侧要求 ≥${INK_GAP[side]}）——求解器的单调性前提不成立，会给出劣解`
      )
    }
  }
}
ok(
  `求解前提：${PRESETS.length * 2} 组表面色同侧，且墨色与表面至少隔开 ` +
    `0.25（亮）/ 0.08（暗）明度 —— 二分搜索的单调性成立`
)

// 文字阶梯必须严格递减：primary > dimmed > secondary > tertiary > caption ≥ icon。
// 反了的话「层级」这个词就没有意义 —— 这正是最容易被一次「顺手调一下」破坏的约束。
const TIER_ORDER = ['primary', 'dimmed', 'secondary', 'tertiary', 'caption']
for (let i = 1; i < TIER_ORDER.length; i += 1) {
  const higher = TEXT_TIERS[TIER_ORDER[i - 1]]
  const lower = TEXT_TIERS[TIER_ORDER[i]]
  if (!(higher > lower)) {
    bad(
      `文字阶梯不是严格递减：${TIER_ORDER[i - 1]}=${higher} 未大于 ${TIER_ORDER[i]}=${lower}`
    )
  }
}
for (const [key, value] of Object.entries(TEXT_TIERS)) {
  if (!(value > 0)) bad(`文字阶梯 ${key} 的目标对比度非法：${value}`)
}
ok(`文字阶梯：${TIER_ORDER.length} 级严格递减（${TIER_ORDER.join(' > ')}），icon 取非文字档`)

// 求解必须**保持色相**：用户选的是「碧波青」，求解后它必须还是碧波青。
// 只允许沿明度轴移动，色相偏差超过 1° 就说明求解器动了别的东西。
const HUE_TOLERANCE = 1
for (const preset of PRESETS) {
  for (const accent of ACCENTS) {
    for (const mode of ['light', 'dark']) {
      const tokens = buildTokens({
        enabled: true,
        preset: preset.id,
        accent: accent.id,
        radius: 'standard',
        ambient: true,
        motion: true,
        typography: true,
        glass: true
      })
      const solved = tokens['--dsw-alias-brand-primary'][mode]
      const seed = accent[mode]
      const a = toHsl(seed).h
      const b = toHsl(solved).h
      const delta = Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
      if (delta > HUE_TOLERANCE) {
        bad(
          `强调色 ${accent.id}.${mode} 求解后色相偏移 ${delta.toFixed(1)}°` +
            `（${seed} → ${solved}）—— 求解器只应移动明度`
        )
      }
    }
  }
}
ok(`求解约束：${ACCENTS.length * PRESETS.length * 2} 组强调色求解后色相偏移均 ≤ ${HUE_TOLERANCE}°`)

// 强调色求解的**收益方向**：求解不得让任何一处已经达标的配色变差。
// 这条断言防的是「求解器参数被改坏，结果是所有颜色都变暗了但没人发现」。
for (const preset of PRESETS) {
  for (const accent of ACCENTS) {
    const tokens = buildTokens({
      enabled: true,
      preset: preset.id,
      accent: accent.id,
      radius: 'standard',
      ambient: true,
      motion: true,
      typography: true,
      glass: true
    })
    const surfaces = surfaceColors(preset.neutral.light)
    const raw = contrast(accent.light, preset.neutral.light.surface1)
    const solved = contrast(tokens['--dsw-alias-link'].light, surfaces[1] ?? preset.neutral.light.surface1)
    if (raw >= 4.5 && solved < raw - 0.01) {
      bad(
        `强调色 ${accent.id} 原本已达标（${raw.toFixed(2)}）却被求解得更差（${solved.toFixed(2)}）`
      )
    }
  }
}
ok('求解收益：原本达标的强调色不会被求解改差')

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

// ============================================================================
// 9.9 v1.3：覆盖面 —— 把「有没有漏掉」也变成一条会失败的断言
//
// v1.2 写下了自己最大的教训：「**写下一份 41 条的清单，不等于覆盖了 117 个令牌**」，
// 以及「一条永远不可能失败的断言，和没有断言是一回事」。这一节把两句话都变成代码：
// 用 `reference/host-consumers.json`（宿主样式与 51 个 bundle 的消费点索引）来回答
// 「插件覆盖的令牌里，有哪些被宿主当文字色用、却从没进过契约」——
// 那份清单要么被补进契约，要么在 `UNCOVERED` 里写明为什么不用。
// ============================================================================

const consumersPath = join(ROOT, 'reference', 'host-consumers.json')
const consumers = existsSync(consumersPath)
  ? JSON.parse(readFileSync(consumersPath, 'utf8'))
  : null

if (consumers === null) {
  // 索引是**维护者检查用**的快照（输入是宿主样式，不进仓库），
  // 因此缺失时降级为一条提示，而不是让整份审计失败 ——
  // 用户装好的插件里不该出现「缺少 reference/…」这种与它无关的报错。
  notes.push(
    '  · 缺少 reference/host-consumers.json —— 跳过了「覆盖率」这一组断言。' +
      '在维护者检出里运行 `node scripts/audit-consumers.mjs <宿主资源目录> reference/host-consumers.json` 生成。'
  )
}

if (consumers) {
  /** 契约引用到的全部令牌（`fg` / `bg` / `tintOf` / `over` 都算）。 */
  const contractTokens = new Set()
  for (const pair of PAIRS) {
    for (const key of ['fg', 'bg', 'tintOf', 'over']) {
      const ref = pair[key]
      if (typeof ref === 'string' && ref.startsWith('--')) contractTokens.add(ref)
    }
  }

  /** 插件真正覆盖的令牌（含未开启 typography / glass 的那些组合）。 */
  const allOverrides = new Set()
  for (const combo of combos) {
    for (const name of Object.keys(buildTokens(combo))) allOverrides.add(name)
  }

  // ---- 断言 A：被宿主当文字色消费、且插件覆盖了的令牌，必须有归属 ----
  const uncovered = []
  for (const [token, entry] of Object.entries(consumers.tokens)) {
    if (!allOverrides.has(token)) continue
    if (contractTokens.has(token)) continue
    if (Object.hasOwn(UNCOVERED, token)) continue
    if (Object.hasOwn(DELIBERATE, token)) continue
    if ((entry.textTotal ?? 0) === 0) continue
    const sample = entry.text[0]
    uncovered.push(
      `${token}（${entry.textTotal} 处，例如 ${sample.property}: ${sample.value}）`
    )
  }
  if (uncovered.length > 0) {
    bad(
      `以下令牌被宿主当文字色消费、插件也确实覆盖了它们，却既不在可读性契约里、\n` +
        `      也没在 UNCOVERED / DELIBERATE 里声明理由 —— 「漏掉」这件事必须被显式处理：\n      ${uncovered.join('\n      ')}`
    )
  } else {
    ok(`覆盖率：宿主对 ${contractTokens.size} 个契约令牌的消费点全部有归属，无「忘了被求解」的覆盖`)
  }

  // ---- 断言 B：UNCOVERED 不能是一份过期清单 ----
  for (const [token, entry] of Object.entries(UNCOVERED)) {
    if (!allOverrides.has(token)) {
      bad(`UNCOVERED 里的 ${token} 其实没有被插件覆盖 —— 它是一段死声明（不覆盖的理由请写进 DELIBERATE）`)
    }
    if (contractTokens.has(token)) {
      bad(`UNCOVERED 里的 ${token} 已经在契约里了 —— 两边只能留一边`)
    }
    if ((consumers.tokens[token]?.textTotal ?? 0) === 0) {
      bad(`UNCOVERED 里的 ${token} 并没有被宿主当文字色消费 —— 豁免的理由不成立`)
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      bad(`UNCOVERED 里的 ${token} 没有给出足够的理由`)
    }
  }
  if (Object.keys(UNCOVERED).length > 0) {
    ok(`豁免声明：${Object.keys(UNCOVERED).length} 条 UNCOVERED 全部被覆盖、未进契约、确有文字消费者，且写明了理由`)
  }

  // ---- 断言 B2：DELIBERATE 与 HOST_GAPS 同样不能过期 ----
  for (const [token, entry] of Object.entries(DELIBERATE)) {
    if (allOverrides.has(token)) {
      bad(`DELIBERATE 里的 ${token} 已经被插件覆盖了 —— 请把它从这张表里删掉`)
    }
    if ((consumers.tokens[token]?.textTotal ?? 0) === 0) {
      bad(`DELIBERATE 里的 ${token} 并没有被宿主当文字色消费 —— 这条边界说明已经过时`)
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      bad(`DELIBERATE 里的 ${token} 没有给出足够的理由`)
    }
  }
  if (Object.keys(DELIBERATE).length > 0) {
    ok(`边界声明：${Object.keys(DELIBERATE).length} 条 DELIBERATE 确实没被覆盖、确有文字消费者，且写明了理由`)
  }

  for (const [token, entry] of Object.entries(HOST_GAPS)) {
    if (!allOverrides.has(token)) {
      bad(`HOST_GAPS 里的 ${token} 并没有被插件补上 —— 声明了缺口却不修，等于没声明`)
    }
    const record = consumers.tokens[token]
    const consumed = (record?.textTotal ?? 0) + (record?.surfaceTotal ?? 0)
    if (consumed === 0) {
      bad(`HOST_GAPS 里的 ${token} 在宿主索引里没有任何消费者 —— 这条补丁是多余的`)
    }
    if ((record?.declaredTotal ?? 0) > 0) {
      bad(`HOST_GAPS 里的 ${token} 其实被宿主声明过（${record.declared[0].value}）—— 它不是一个缺口`)
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      bad(`HOST_GAPS 里的 ${token} 没有给出足够的理由`)
    }
  }
  if (Object.keys(HOST_GAPS).length > 0) {
    ok(`宿主缺口：${Object.keys(HOST_GAPS).length} 条 HOST_GAPS 都「有消费者、零声明」，且真的被插件补上`)
  }

  // ---- 断言 C：HOST_FALLBACK 的取值与宿主真实声明一致 ----
  //
  // v1.2 的注释声称「有一条断言把 fallback 与宿主基准表逐条比对」。事实是：
  // 当时的基准表只有名字、没有取值，断言只校验了名字 —— 于是
  // `--dsw-alias-button-contrast-fill` 抄成了另一个令牌的值（#54555780）
  // 也没人发现，而它的真实取值是 #61666b（浅色）/ #f9fafb（深色）。
  // 现在取值也在索引里，这条承诺才真的兑现。
  /** 把所有「字面量取值」的自定义属性收成表，用于解析一层 `var()`。 */
  const literal = new Map()
  for (const [token, entry] of Object.entries(consumers.tokens)) {
    for (const item of entry.declared ?? []) {
      if (parseHex(item.value) !== null) literal.set(token, item.value)
    }
  }
  const resolveLiteral = (value) => {
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(String(value).trim())
    if (ref === null) return value
    return literal.get(ref[1]) ?? null
  }
  /** 取宿主在某个明暗下声明过的取值：深色看带 data-ds-dark-theme 的规则。 */
  function hostDeclared(token, mode) {
    const entry = consumers.tokens[token]
    if (!entry?.declared) return null
    const wanted = mode === 'dark'
    for (const item of entry.declared) {
      const isDark = item.selector.includes('data-ds-dark-theme')
      if (isDark !== wanted) continue
      const value = resolveLiteral(item.value)
      if (value !== null && parseHex(value) !== null) return value
    }
    return null
  }
  /** 两个颜色字面量是否同一个颜色（`#fff` 与 `#ffffff` 是同一个）。 */
  const sameColor = (a, b) => {
    const left = parseHex(a)
    const right = parseHex(b)
    if (left === null || right === null) return String(a) === String(b)
    return left.r === right.r && left.g === right.g && left.b === right.b
  }
  for (const [token, expected] of Object.entries(HOST_FALLBACK)) {
    for (const mode of ['light', 'dark']) {
      const actual = hostDeclared(token, mode)
      if (actual === null) {
        bad(`HOST_FALLBACK 里的 ${token} 在宿主索引里找不到 ${mode} 的声明取值，无法核对`)
        continue
      }
      if (!sameColor(actual, expected[mode])) {
        bad(
          `HOST_FALLBACK 的 ${token}.${mode} 声明为 ${expected[mode]}，` +
            `而宿主真实声明是 ${actual} —— 契约算的是一个不存在的前景/背景`
        )
      }
    }
  }
  ok(`契约 fallback：${Object.keys(HOST_FALLBACK).length} 条未覆盖令牌的取值与宿主真实声明逐条一致`)

  // ---- 断言 D：宿主「被消费却从未声明」的缺口必须被处理 ----
  const gaps = []
  for (const [token, entry] of Object.entries(consumers.tokens)) {
    if ((entry.textTotal ?? 0) === 0 && (entry.surfaceTotal ?? 0) === 0) continue
    if ((entry.declaredTotal ?? 0) > 0) continue
    gaps.push(token)
  }
  const undeclared = gaps.filter((token) => !allOverrides.has(token))
  if (undeclared.length > 0) {
    notes.push(
      `  · 宿主「有消费者、却从未声明」的令牌 ${undeclared.length} 个（插件补了其中的 ${gaps.length - undeclared.length} 个）：` +
        undeclared.slice(0, 6).join(', ') +
        (undeclared.length > 6 ? ' …' : '')
    )
  }
}

// ---- 断言 E：INFEASIBLE 声明的「方向冲突」必须仍然成立 ----
//
// 一条被悄悄省掉的配对，和「这里没问题」是一回事。因此省掉的部分必须写下来，
// 而「为什么省掉」要能被机器复核：两个落点必须分处明暗两侧 —— 也就是
// 求解器无论如何都会返回 null。哪天有人把轻提示的底改成浅色，它会立刻失败。
for (const entry of INFEASIBLE) {
  const tokens = buildTokens({
    enabled: true,
    preset: PRESETS[0].id,
    accent: ACCENTS[0].id,
    radius: 'standard',
    corner: CORNER_SHAPES[1].id,
    ambient: true,
    motion: true,
    typography: true,
    glass: true
  })
  const sharpBackground = tokens[entry.sharp.against]?.[entry.mode]
  const softBackground = tokens[entry.soft.against]?.[entry.mode]
  if (sharpBackground === undefined || softBackground === undefined) {
    bad(`INFEASIBLE ${entry.id} 引用了取不到值的令牌`)
    continue
  }
  const sharpSide = luminance(sharpBackground)
  const softSide = luminance(softBackground)
  if (!(sharpSide > 0.4 && softSide <= 0.4)) {
    bad(
      `INFEASIBLE ${entry.id} 声称「两个角色方向相反」，但 ${entry.sharp.against}=${sharpBackground}` +
        `（亮度 ${sharpSide.toFixed(3)}）与 ${entry.soft.against}=${softBackground}（亮度 ${softSide.toFixed(3)}）` +
        ` 并不分处明暗两侧 —— 这个矛盾已经不成立了，请把配对写回契约。`
    )
  }
}
if (INFEASIBLE.length > 0) {
  ok(`可行域声明：${INFEASIBLE.length} 条 INFEASIBLE 的两个落点确实分处明暗两侧（方向冲突成立）`)
}

// ---- 断言 F：语义色只许动明度，色相必须留在约定的色域里 ----
//
// 强调色的色相由用户挑，语义色的色相是**约定**：绿=成功、琥珀=警告、红=危险。
// 求解器只沿明度轴移动，这条断言把这个「只」变成可失败的事实 ——
// 有人把 success 改成蓝的，构建期就会响。
const SEMANTIC_HUE = { success: [80, 180], warn: [20, 70], error: [330, 360], errorLow: [0, 25] }
const SEMANTIC_KEYS = ['success', 'warn', 'error']
let semanticHueChecks = 0
for (const preset of PRESETS) {
  for (const accent of ACCENTS) {
    const tokens = buildTokens({
      enabled: true,
      preset: preset.id,
      accent: accent.id,
      radius: 'standard',
      corner: CORNER_SHAPES[1].id,
      ambient: true,
      motion: true,
      typography: true,
      glass: true
    })
    for (const key of SEMANTIC_KEYS) {
      for (const mode of ['light', 'dark']) {
        const value = tokens[`--dsw-alias-state-${key}-primary`]?.[mode]
        if (value === undefined) {
          bad(`语义色 ${key} 没有被投射出去`)
          continue
        }
        const hue = toHsl(value).h
        const [low, high] = SEMANTIC_HUE[key]
        const inRange =
          key === 'error'
            ? (hue >= low && hue <= high) || (hue >= SEMANTIC_HUE.errorLow[0] && hue <= SEMANTIC_HUE.errorLow[1])
            : hue >= low && hue <= high
        if (!inRange) {
          bad(
            `语义色 ${key} 在 ${preset.id}/${accent.id}/${mode} 解出了 ${value}（色相 ${hue.toFixed(0)}°），` +
              `跑出了「${key}」的约定色域 —— 语义色只应移动明度`
          )
        }
        semanticHueChecks += 1
      }
    }
  }
}
ok(`语义色色相：${semanticHueChecks} 组取值全部落在成功/警告/危险各自的约定色域内`)

// ---- 断言 G：圆角形状的取值必须是合法语法，且默认档与官方一致 ----
const CORNER_SHAPE_SYNTAX = /^(round|square|bevel|scoop|notch|superellipse\(\s*\d+(\.\d+)?\s*\))$/
for (const shape of CORNER_SHAPES) {
  if (!CORNER_SHAPE_SYNTAX.test(shape.css)) {
    bad(`圆角形状 ${shape.id} 的取值 ${shape.css} 不是合法的 corner-shape 语法`)
  }
}
const cornerValues = CORNER_SHAPES.map((s) => s.css)
if (new Set(cornerValues).size !== cornerValues.length) {
  bad('圆角形状里有重复取值 —— 切换档位不会有任何变化')
}
// 宿主 corner_shape.css 写的是 `superellipse(1.5)`；默认档必须等于它，
// 否则「装上插件但什么都不改」就已经改变了观感。
const DEFAULT_CORNER = CORNER_SHAPES.find((s) => s.id === DEFAULT_STATE.corner)
if (DEFAULT_CORNER?.css !== 'superellipse(1.5)') {
  bad(
    `默认圆角形状是 ${DEFAULT_CORNER?.css}，而宿主 corner_shape.css 的取值是 superellipse(1.5) —— ` +
      `默认档必须与官方一致，否则「什么都不改」也会改变观感`
  )
}
ok(`圆角形状：${CORNER_SHAPES.length} 档语法合法、互不相同，默认档对齐宿主 superellipse(1.5)`)

// ---- 断言 H：内容区圆角的覆盖规则必须真的赢过宿主 ----
//
// 这是一个真实缺陷：v1.2 用的是 `html body [class*='_frame']`，座标 (0,1,2)；
// 宿主 `[data-windows-titlebar] .xxx_frame` 是 (0,2,0)。**属性选择器与类同级**，
// 1 < 2，宿主赢 —— 那条规则从未生效，圆角档位对内容区左上角完全无效。
// 躲过全部检查的原因是默认档（standard）恰好也是 16px。
// 因此这里断言：Windows 条件必须挂在 `html` 上，让座标变成 (0,2,2)。
const frameRules = leafBlocks(stripCssComments(css['base.css'] ?? '')).filter((block) =>
  block.selector.includes('_frame')
)
if (frameRules.length === 0) {
  bad('base.css 里找不到内容区圆角的覆盖规则')
}
for (const block of frameRules) {
  if (!block.selector.includes('html[data-windows-titlebar]')) {
    bad(
      `内容区圆角规则的选择器是 ${block.selector}，特异性低于宿主的 [data-windows-titlebar] .frame —— ` +
        `这条规则不会生效。必须写成 html[data-windows-titlebar] body […]`
    )
  }
}

// ---- 断言 I：求解的墨色种子必须待在表面的**另一侧** ----
//
// 这是求解器「一次二分就够」的前提：候选解只要始终待在底色的另一侧，对比度对明度
// 就是单调的。判据不是「种子算亮侧还是暗侧」（那是 0.4 阈值那套粗分类，
// 深色预设里的三级文字本身也在暗侧），而是更直接的一条：**种子必须比表面更远离背景**，
// 于是求解只会把它推得更远、不会越过表面。
let directionChecks = 0
for (const preset of PRESETS) {
  for (const mode of ['light', 'dark']) {
    const neutral = preset.neutral[mode]
    const surfaces = surfaceColors(neutral)
    const side = analyzeBackdrops(surfaces)
    const surfaceEdge =
      side === 'light'
        ? Math.min(...surfaces.map(luminance))
        : Math.max(...surfaces.map(luminance))
    for (const key of ['ink', 'inkDimmed', 'inkSecondary', 'inkTertiary', 'inkCaption', 'icon']) {
      const value = luminance(neutral[key])
      const onFarSide =
        side === 'light' ? value < surfaceEdge : value > surfaceEdge
      if (!onFarSide) {
        bad(
          `预设 ${preset.id}.${mode} 的墨色种子 ${key}（亮度 ${value.toFixed(3)}）没有落在` +
            `表面的另一侧（表面边缘 ${surfaceEdge.toFixed(3)}，${side} 侧）——` +
            `求解器的二分搜索会越过背景自身，单调性不成立`
        )
      }
      directionChecks += 1
    }
  }
}
ok(`求解前提：${directionChecks} 个墨色种子全部落在所属表面的另一侧，二分搜索的单调性成立`)

// ---- 断言 J：自指约束的实际余量 ----
//
// 强调色的自指淡染层（Tag 语气、侧边选中底、徽标底）由强调色自己派生，
// 求解迭代两轮收敛。契约只钉了其中两支；这里把**全部**派生命中率算一遍，
// 要求最低的一支也真的达标 ——「解过了」不等于「每一处都解到位了」。
// 比例必须与 presets.js 的 TINTS 一致，且**分明暗**：
// 浅色用 0.10/0.13/0.12，深色用 0.10/0.16/0.18。
// 把深色的 0.18 也套到浅色上会算出 4.28 这种不存在的失败 —— 这一版真的踩过。
const SELF_REF_WASHES = {
  light: [0.1, 0.13, 0.12],
  dark: [0.1, 0.16, 0.18]
}
let selfRefWorst = { ratio: Infinity, where: '' }
let selfRefChecks = 0
for (const preset of PRESETS) {
  for (const accent of ACCENTS) {
    const tokens = buildTokens({
      enabled: true,
      preset: preset.id,
      accent: accent.id,
      radius: 'standard',
      corner: CORNER_SHAPES[1].id,
      ambient: true,
      motion: true,
      typography: true,
      glass: true
    })
    for (const mode of ['light', 'dark']) {
      const accentColor = tokens['--dsw-alias-brand-primary'][mode]
      for (const surface of surfaceColors(preset.neutral[mode])) {
        for (const wash of SELF_REF_WASHES[mode]) {
          const layer = tint(surface, accentColor, wash)
          const ratio = contrast(accentColor, layer)
          selfRefChecks += 1
          if (ratio < selfRefWorst.ratio) {
            selfRefWorst = {
              ratio,
              where: `${preset.id}/${accent.id}/${mode} 淡染 ${wash} on ${surface}`
            }
          }
        }
      }
    }
  }
}
if (selfRefWorst.ratio < AA) {
  bad(
    `强调色压在自己的淡染层上只有 ${selfRefWorst.ratio.toFixed(3)}（目标 ${AA}）—— ${selfRefWorst.where}`
  )
} else {
  ok(
    `自指约束：全部 ${selfRefChecks} 条派生命中率最低 ${selfRefWorst.ratio.toFixed(2)}（≥AA），最紧的是 ${selfRefWorst.where}`
  )
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
