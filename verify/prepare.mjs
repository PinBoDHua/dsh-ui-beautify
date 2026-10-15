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
  'image-lightbox.css'
]

mkdirSync(BUILD, { recursive: true })

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

writeFileSync(
  join(BUILD, 'tokens.js'),
  `// 由 verify/prepare.mjs 生成：插件 buildTokens() 的真实输出快照。\nwindow.DSHB_STATES = ${JSON.stringify(
    STATES
  )}\nwindow.DSHB_TOKENS = ${JSON.stringify(snapshot)}\nwindow.DSHB_RADIUS_TIERS = ${JSON.stringify(
    presets.RADIUS_SCALES
  )}\n`
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
