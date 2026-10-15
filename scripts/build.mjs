/**
 * 界面美化 · Lumina —— 零依赖构建脚本。
 *
 * ## 产物形状
 * 宿主客户端的模块加载器不认识 ESM：每个客户端包都必须是一个经典脚本，调用
 * `window.__ModuleLoader__.load({ id, factory })` 登记自己，并在 factory 内部
 * 用注入的 `require` 取依赖。参见 node_modules 里 dsh-plugin / dsh-better-sidebar
 * 的 lib/client.js，二者都是这个形状。
 *
 * ## 为什么不用 rolldown/tsdown
 * 本插件的客户端代码不依赖任何第三方包，模块图是线性的、没有循环、没有动态
 * import。一套「按依赖序拼接 + 去 import/export」的构建足以胜任，而且产物可以
 * 逐行审阅、构建不引入 node_modules。作为交换，脚本会做几项硬校验，避免拼接式
 * 构建最典型的失效方式（重名覆盖、遗漏 export、残留 import 语句）。
 *
 * ## 用法
 *   node scripts/build.mjs
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'client')
const ENTRY = join(SRC, 'index.js')
const OUT = join(ROOT, 'client', 'client.js')
const GENERATED = join(SRC, 'styles.generated.js')

/** 插件 id：与 package.json 的 name 一致。 */
const PLUGIN_ID = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf8')
).name

/**
 * 样式表的挂载顺序。显式列出而不是按文件名排序 —— 顺序会影响同特异性规则的
 * 胜负，属于设计决定，不该由字母序决定。
 */
const STYLE_ORDER = [
  'base.css',
  'elevation.css',
  'typography.css',
  'safety.css',
  'panel.css'
]

/** factory 里允许出现的 require id。越界即构建失败。 */
const ALLOWED_REQUIRES = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime'
])

/** 构建期由脚本注入的绑定，参与重名校验。 */
const PRELUDE_NAMES = new Set(['React'])

const failures = []

/** 记录一条构建期错误。 */
function fail(message) {
  failures.push(message)
}

// ---------------------------------------------------------------- 样式表

/** 把 styles/*.css 合成 `export const STYLES` 模块，供 controller 引用。 */
function generateStyles() {
  const present = readdirSync(join(SRC, 'styles')).filter((f) => f.endsWith('.css'))
  const missing = STYLE_ORDER.filter((f) => !present.includes(f))
  const extra = present.filter((f) => !STYLE_ORDER.includes(f))
  if (missing.length > 0) fail(`styles/ 缺少声明的样式表：${missing.join(', ')}`)
  if (extra.length > 0) fail(`styles/ 存在未登记的样式表：${extra.join(', ')}`)

  const entries = STYLE_ORDER.filter((f) => present.includes(f)).map((file) => {
    // 与 loadModule 同理统一成 LF：样式表内容会被原样嵌进产物，
    // 不规范化的话同一份源码在 LF / CRLF 检出下会产出不同字节的 client.js。
    const css = readFileSync(join(SRC, 'styles', file), 'utf8').replace(/\r\n/g, '\n')
    assertBalancedBraces(file, css)
    return `  [${JSON.stringify(file.replace(/\.css$/, ''))}, ${JSON.stringify(css)}]`
  })

  const body = `/**
 * 本文件由 scripts/build.mjs 生成，请勿手工编辑。
 * 修改样式请编辑 src/client/styles/*.css，然后运行 \`node scripts/build.mjs\`。
 */
export const STYLES = [
${entries.join(',\n')}
]
`
  writeFileSync(GENERATED, body)
  return entries.length
}

/** CSS 花括号配平检查：拼接式构建不会解析 CSS，这是最廉价的结构校验。 */
function assertBalancedBraces(name, css) {
  let depth = 0
  let inComment = false
  for (let i = 0; i < css.length; i += 1) {
    const two = css.slice(i, i + 2)
    if (!inComment && two === '/*') {
      inComment = true
      i += 1
      continue
    }
    if (inComment && two === '*/') {
      inComment = false
      i += 1
      continue
    }
    if (inComment) continue
    if (css[i] === '{') depth += 1
    if (css[i] === '}') depth -= 1
    if (depth < 0) {
      fail(`${name}: 第 ${i} 字节出现多余的 '}'`)
      return
    }
  }
  if (depth !== 0) fail(`${name}: 花括号未配平（剩余深度 ${depth}）`)
}

// ---------------------------------------------------------------- 模块图

const IMPORT_RE = /^[ \t]*import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}\s*)?from\s*['"]([^'"]+)['"];?[ \t]*$/gm
const DECL_RE = /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm

/** 读取一个模块，拆出依赖与去 import/export 后的函数体。 */
function loadModule(file) {
  // 统一成 LF 再解析：下面的 import/export 正则都是行锚定的（`^...$`），
  // 行尾多一个 \r 就会让它们全部失配。.gitattributes 已声明 eol=lf，
  // 但贡献者本地检出、编辑器另存都可能引入 CRLF，这里兜住。
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const deps = []
  for (const match of text.matchAll(IMPORT_RE)) {
    const specifier = match[3]
    if (!specifier.startsWith('.')) {
      fail(`${rel(file)}: 只允许相对导入，发现 '${specifier}'`)
      continue
    }
    deps.push(resolve(dirname(file), specifier))
  }
  const body = text.replace(IMPORT_RE, '')
  const stripped = body.replace(/^(export\s+)/gm, '')
  if (/^[ \t]*export\s/m.test(stripped)) {
    const leftover = stripped.match(/^[ \t]*export\s.*$/m)?.[0]?.trim()
    fail(`${rel(file)}: 存在脚本无法处理的 export 形式：${leftover}`)
  }
  return { file, deps, body: stripped }
}

/** 相对仓库根的短路径，用于日志。 */
function rel(file) {
  return file.slice(ROOT.length + 1).replace(/\\/g, '/')
}

/** 后序 DFS：被依赖者先入列，保证拼接后 const 的求值顺序正确。 */
function orderModules(entry) {
  const ordered = []
  const state = new Map()
  const visit = (file, stack) => {
    const mark = state.get(file)
    if (mark === 'done') return
    if (mark === 'visiting') {
      fail(`模块图存在循环依赖：${[...stack, file].map(rel).join(' -> ')}`)
      return
    }
    state.set(file, 'visiting')
    const mod = loadModule(file)
    for (const dep of mod.deps) visit(dep, [...stack, file])
    state.set(file, 'done')
    ordered.push(mod)
  }
  visit(entry, [])
  return ordered
}

// ------------------------------------------------------------------ 拼接

/** 校验顶层声明不重名 —— 拼接式构建最典型的静默失效方式。 */
function collectDeclarations(modules) {
  const seen = new Map()
  for (const name of PRELUDE_NAMES) seen.set(name, '<prelude>')
  for (const mod of modules) {
    for (const match of mod.body.matchAll(DECL_RE)) {
      const name = match[1]
      const owner = seen.get(name)
      if (owner !== undefined) {
        fail(
          `顶层名冲突：'${name}' 同时定义于 ${owner} 与 ${rel(mod.file)}（拼接后后者会覆盖前者）`
        )
        continue
      }
      seen.set(name, rel(mod.file))
    }
  }
  return seen
}

/** 组装最终的经典脚本。 */
function assemble(modules) {
  const chunks = modules.map(
    (mod) => `\n// ---- ${rel(mod.file)} ${'-'.repeat(Math.max(0, 60 - rel(mod.file).length))}\n${mod.body.trim()}\n`
  )
  const body = `\t\tconst React = require("react")\n${chunks.join('')}
\t\texports.apply = apply
\t\texports.inject = inject
\t\texports.name = name
\t\treturn module.exports`

  return `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} }
\t\tvar exports = module.exports
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
${body}
\t}
})
`
}

// ---------------------------------------------------------------- 构建期校验

/** 产物必须能作为经典脚本解析，且只 require 允许的 id。 */
function verify(code) {
  try {
    new vm.Script(code, { filename: 'client.js' })
  } catch (error) {
    fail(`产物无法解析为经典脚本：${error.message}`)
    return
  }
  for (const match of code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!ALLOWED_REQUIRES.has(match[1])) {
      fail(`产物 require 了未授权的模块 id：'${match[1]}'`)
    }
  }
  for (const key of ['name', 'inject', 'apply']) {
    if (!code.includes(`exports.${key} = ${key}`)) {
      fail(`产物缺少 exports.${key} —— 加载器会认为它不是合法插件`)
    }
  }
  if (/^\s*(?:import|export)\s/m.test(code)) {
    fail('产物中残留 ESM 语句 —— 经典脚本会直接语法报错')
  }
}

// -------------------------------------------------------------------- 主流程

const styleCount = generateStyles()
const modules = orderModules(ENTRY)
collectDeclarations(modules)
const code = assemble(modules)
verify(code)

if (failures.length > 0) {
  console.error(`构建失败，共 ${failures.length} 项：`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, code)

console.log(`插件 id      : ${PLUGIN_ID}`)
console.log(`样式表       : ${styleCount} 张`)
console.log(`模块         : ${modules.length} 个`)
// 按 UTF-8 字节数报告：产物里中文注释占比不低，字符数会明显小于磁盘占用。
console.log(
  `产物         : ${rel(OUT)} (${(Buffer.byteLength(code, 'utf8') / 1024).toFixed(1)} KB)`
)
