/**
 * 可视化验证台 —— 资源准备。
 *
 * ## 这个验证台证明什么、不证明什么
 * 它用**宿主自己的样式表**在真实 Chromium 里渲染一个 DSH 外观的复刻页面：
 *   · `build/tokens.css`   = 宿主 ui-theme 的七张令牌样式表，逐字节原样；
 *   · `build/components.css` = 宿主 ui-primitives 的真实组件样式（源级 .module.css，
 *     已做类名命名空间化以免相互串扰）；
 *   · `build/tokens.js`    = 插件 `buildTokens()` 的真实输出。
 *
 * 因此它能证明：插件的令牌覆盖会让宿主的真实组件样式呈现出预期的观感差异，
 * 并且覆盖不会破坏对比度/可读性。它**不能**证明真机 DOM 结构下的像素级结果 ——
 * 复刻页面的结构是照着宿主组件样式反推的，不是从运行中的应用里抓的。
 *
 * 用法：node verify/prepare.mjs
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const HOST = join(HERE, 'host-src')
const BUILD = join(HERE, 'build')

/** 令牌样式表要按宿主 ui-theme 的导入顺序拼接：后者可能覆盖前者的同特异性规则。 */
const THEME_ORDER = [
  'base.css',
  'design_platform.css',
  'gradient_shadow_text.css',
  'focus.css',
  'corner_shape.css',
  'scrollbar.css',
  'shiki.css',
  // 宿主 ui-layout 的真实窗口框架样式（哈希类名原样）。放在最后，因为它
  // 定义了 Windows 标题栏模式下中心列圆角与框架底色 —— 复现圆角问题必需。
  'layout-frame.css',
  // 图片灯箱的**编译后**样式（类名形如 _close_1hos8_29）。安全修正层那条规则
  // 针对的正是这套命名约定，因此这一张不能用源码级类名替代。
  'image-lightbox.css',
  // TodoPanel 与 StateDot 的编译样式。任务面板增强要同时改「行」与「状态点」，
  // 而这两者分属两个包、两套哈希类名，验证台必须照编译结果渲染才作数。
  'todo-panel.css',
  'state-dot.css'
]

mkdirSync(BUILD, { recursive: true })

/**
 * 从控制器源码里读出它会在 `<html>` 上投射哪些属性。
 *
 * 验证台必须复现「宿主 apply() 之后页面处于什么状态」，而这件事的真相来源是
 * `src/client/controller.js` 的 FLAGS / SELECTORS 两个对象。之前验证台手抄了一份
 * 属性清单，结果 v1.1 新增 `data-dshb-tasklist` 时漏抄 —— 任务列表增强在验证台里
 * 完全不生效，而截图看起来「和官方一样」，差点被当成功能没做出来。
 *
 * 抄一份清单就是多一个必然漂移的地方；直接从源码推导，加了什么就投射什么。
 */
function readControllerAttributes() {
  const source = readFileSync(join(ROOT, 'src', 'client', 'controller.js'), 'utf8')
  const readObject = (name) => {
    const body = source.match(new RegExp(`const ${name} = \\{([^}]*)\\}`))?.[1]
    if (body === undefined) throw new Error(`controller.js 里找不到 ${name} 对象`)
    return Object.fromEntries(
      [...body.matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((m) => [m[1], m[2]])
    )
  }
  return { flags: Object.values(readObject('FLAGS')), selectors: readObject('SELECTORS') }
}

// ------------------------------------------------------------ 令牌样式表

const themeParts = THEME_ORDER.map((file) => {
  const css = readFileSync(join(HOST, 'theme', file), 'utf8')
  return `/* ===== 宿主 ui-theme/lib/styles/${file} ===== */\n${css}`
})
writeFileSync(join(BUILD, 'tokens.css'), themeParts.join('\n\n'))

// ---------------------------------------------------------- 组件样式表

/**
 * 把 CSS Module 的局部类名加上按文件区分的命名空间前缀。
 *
 * 宿主发布的是编译产物（类名形如 `BynINW_centerCol`），这里拿到的是源级文件，
 * 同名局部类（`.wrap`、`.row`）在多个文件里都会出现。直接拼接会让它们互相
 * 命中；加前缀是保持「每个文件的规则只作用于自己的标记」的最小改动。
 * 同时把 `:global(...)` 的 CSS-Modules 语法还原成普通选择器。
 */
function namespaceize(prefix, css) {
  return css
    .replace(/:global\(([^)]*)\)/g, '$1')
    .replace(/\.([A-Za-z_][\w-]*)/g, `.${prefix}-$1`)
}

const primitiveFiles = readdirSync(join(HOST, 'primitives'))
  .filter((f) => f.endsWith('.module.css'))
  .sort()

const componentParts = primitiveFiles.map((file) => {
  const prefix = 'c' + file.replace(/\.module\.css$/, '').replace(/[^A-Za-z0-9]/g, '')
  const css = namespaceize(prefix, readFileSync(join(HOST, 'primitives', file), 'utf8'))
  return `/* ===== 宿主 ui-primitives/src/${file}（类名已加前缀 .${prefix}-） ===== */\n${css}`
})
writeFileSync(join(BUILD, 'components.css'), componentParts.join('\n\n'))

// -------------------------------------------------------------- 令牌快照

const presets = await import(new URL('../src/client/presets.js', import.meta.url).href)
const readability = await import(
  new URL('../src/client/readability.js', import.meta.url).href
)

/** 验证台要渲染的状态：官方基准 + 每个预设各一组。 */
const STATES = [
  { id: 'official', label: '官方原版' },
  { id: 'aurora', label: '极光', preset: 'aurora', accent: 'deepseek' },
  { id: 'midnight', label: '午夜', preset: 'midnight', accent: 'deepseek' },
  { id: 'graphite', label: '石墨', preset: 'graphite', accent: 'graphite' },
  { id: 'paper', label: '纸感', preset: 'paper', accent: 'amber' },
  { id: 'violet', label: '极光 · 星云紫', preset: 'aurora', accent: 'violet' }
]

const snapshot = {}
for (const state of STATES) {
  if (!state.preset) {
    snapshot[state.id] = null
    continue
  }
  snapshot[state.id] = presets.buildTokens({
    enabled: true,
    preset: state.preset,
    accent: state.accent,
    radius: 'standard',
    ambient: true,
    motion: true,
    typography: true,
    glass: true
  })
}

/**
 * 可读性读数 —— 用**真实契约**算出，而不是在页面里另写一份对比度公式。
 *
 * 页面里出现「第二份实现」是漂移的来源：验证台显示的比值必须与构建期断言、
 * 面板读数出自同一份代码，否则测试台会用它自己的算法证明自己是达标的。
 * 官方基准那一档没有令牌层，因此不评估（显示为 null）。
 */
const readabilityReport = {}
/** 语法着色画廊：每个预设一套真实 token 色，用于逐色对照。 */
const syntaxGallery = []
for (const state of STATES) {
  const tokens = snapshot[state.id]
  if (!tokens) {
    readabilityReport[state.id] = null
    continue
  }
  const report = readability.evaluateBoth(tokens)
  readabilityReport[state.id] = {
    worst: report.worstBody === null ? null : Number(report.worstBody.ratio.toFixed(2)),
    worstId: report.worstBody === null ? null : report.worstBody.id,
    worstLabel: report.worstBody === null ? null : report.worstBody.label,
    floor: report.worst === null ? null : Number(report.worst.ratio.toFixed(2)),
    total: report.total,
    failing: report.failures.length
  }
  syntaxGallery.push({
    id: state.id,
    label: state.label,
    tokens: Object.fromEntries(
      readability.SYNTAX_TOKENS.map((name) => [
        name,
        { light: tokens[`--shiki-token-${name}`].light, dark: tokens[`--shiki-token-${name}`].dark }
      ])
    ),
    code: { light: tokens['--dsw-alias-markdown-code-block'].light, dark: tokens['--dsw-alias-markdown-code-block'].dark },
    plain: { light: tokens['--dsw-alias-label-primary'].light, dark: tokens['--dsw-alias-label-primary'].dark }
  })
}

writeFileSync(
  join(BUILD, 'tokens.js'),
  `// 由 verify/prepare.mjs 生成：插件 buildTokens() 的真实输出快照，
// 以及控制器在 <html> 上投射的属性清单（从 controller.js 源码推导）。
window.DSHB_STATES = ${JSON.stringify(STATES)}
window.DSHB_TOKENS = ${JSON.stringify(snapshot)}
window.DSHB_RADIUS_TIERS = ${JSON.stringify(presets.RADIUS_SCALES)}
window.DSHB_ATTRS = ${JSON.stringify(readControllerAttributes())}
window.DSHB_VERSION = ${JSON.stringify(
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  )}
window.DSHB_READABILITY = ${JSON.stringify(readabilityReport)}
window.DSHB_SYNTAX = ${JSON.stringify(syntaxGallery)}
`
)

// ------------------------------------------------------- 插件自身的样式表

/**
 * 插件运行时注入的样式表，原样带进验证台。
 *
 * 清单**不在这里重复维护** —— 直接从构建产物 `src/client/styles.generated.js`
 * 读。之前这里有一份手写的四张表清单，结果新增 safety.css 时漏加，
 * 验证台静默地少渲染了一张表，对照图两边一模一样却没报错。
 * 单一来源之后，构建加了什么，验证台就渲染什么。
 */
const { STYLES } = await import(
  new URL('../src/client/styles.generated.js', import.meta.url).href
)
const pluginStyles = STYLES.map(([name, css]) => ({ name, css }))
writeFileSync(
  join(BUILD, 'plugin-styles.js'),
  `// 由 verify/prepare.mjs 生成：插件构建产物里的样式表，原样内容。\nwindow.DSHB_STYLES = ${JSON.stringify(
    pluginStyles
  )}\n`
)

console.log(`令牌样式表 : ${THEME_ORDER.length} 张 -> build/tokens.css`)
console.log(`组件样式表 : ${primitiveFiles.length} 个 -> build/components.css`)
console.log(`令牌快照   : ${STATES.length} 个状态 -> build/tokens.js`)
console.log(`插件样式表 : ${pluginStyles.length} 张 -> build/plugin-styles.js`)
