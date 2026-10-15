/**
 * 界面美化 · Lumina —— 宿主消费点索引生成器。
 *
 * ## 为什么需要它
 * v1.2 的教训写在自己的文档里：**「写下一份 41 条的清单，不等于覆盖了 117 个令牌」**。
 * 那一版漏掉了 `--dsw-alias-label-dimmed`（宿主的 14px 输入框占位文字），
 * 原因是「根本没有被算」，而不是「算错了」。把清单写长一点解决不了这个问题 ——
 * 因为漏哪一条，取决于宿主**在哪里**用了这个令牌，而那是插件之外的事实。
 *
 * 于是这一步把那个事实变成数据：扫描宿主的全部样式表，记录
 * 「哪个令牌出现在哪条规则的哪个属性上、这条规则的字号是多少」。
 * `check.mjs` 再用它断言：**凡被宿主当文字色消费、且插件覆盖了的令牌，
 * 必须在可读性契约里出现，或在 `EXEMPT` 里显式声明并给出理由。**
 * 这样「令牌忘了被求解」就不再依赖某个人的记性。
 *
 * ## 为什么不做成构建的一部分
 * 输入是宿主的样式表（第三方、不进仓库，见 .gitignore 的 `verify/host-src/`）。
 * 与 `reference/host-tokens.json` 一样：快照进仓库，重新生成是手工动作。
 * 宿主升级后重跑，diff 会告诉你「插件覆盖的令牌，宿主换了个地方用」。
 *
 * 用法：
 *   node scripts/audit-consumers.mjs <宿主 CSS 目录或文件...> <输出 JSON>
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'

/** 会被判定为「承载文字」的属性：这些位置上的颜色读不出来就是缺陷。 */
const TEXT_PROPERTIES = new Set([
  'color',
  '-webkit-text-fill-color',
  'text-decoration-color',
  'caret-color'
])

/** 会被判定为「表面 / 装饰」的属性：对比度要求不同（WCAG 1.4.11 的非文字档）。 */
const SURFACE_PROPERTIES = new Set([
  'background',
  'background-color',
  'background-image',
  'border',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-inline-start-color',
  'box-shadow',
  'outline',
  'outline-color',
  'accent-color',
  'scrollbar-color',
  'text-decoration'
])

/** 收集目录下的样式资源：宿主的令牌表是 `.css`，feature bundle 是含 CSS 的 `.js`。 */
function collectFiles(target, out = []) {
  const info = statSync(target)
  if (info.isFile()) {
    if (extname(target) === '.css' || extname(target) === '.js') out.push(target)
    return out
  }
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    collectFiles(join(target, entry.name), out)
  }
  return out
}

/** 去掉注释：宿主产物是压缩过的，但源码抽取的副本里有块注释。 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * 把一张样式表切成 `{ selector, declarations }` 列表。
 *
 * 只需要「够用」的解析：宿主产物是压缩过的合法 CSS，没有 `@media` 之外的嵌套花括号
 * （`@supports` 也有，同样处理）。因此按字符扫描、维护花括号深度即可，
 * 遇到 at-rule 时把它的前导条件拼进选择器，便于人工审阅时知道规则在什么条件下生效。
 */
function parseRules(css) {
  const rules = []
  const stack = []
  /** 分层保存「外层块已经攒下的声明」，从嵌套块返回时恢复。 */
  const savedDeclarations = []
  let declarations = []
  /** 当前累积的片段：进块之前是选择器/at-rule 前导，进块之后是一条声明。 */
  let buffer = ''
  const pushDeclaration = () => {
    const colon = buffer.indexOf(':')
    if (colon > 0) {
      const property = buffer.slice(0, colon).trim().toLowerCase()
      const value = buffer.slice(colon + 1).trim()
      if (property !== '' && value !== '') declarations.push([property, value])
    }
    buffer = ''
  }
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    if (char === '{') {
      stack.push(buffer.trim())
      buffer = ''
      savedDeclarations.push(declarations)
      declarations = []
      continue
    }
    if (char === '}') {
      // 块内最后一条声明没有分号收尾
      pushDeclaration()
      const conditions = stack.filter((entry) => entry.startsWith('@'))
      const selector = stack.filter((entry) => !entry.startsWith('@')).join(', ')
      if (selector !== '' && declarations.length > 0) {
        rules.push({ selector, conditions, declarations })
      }
      stack.pop()
      declarations = savedDeclarations.pop() ?? []
      continue
    }
    if (char === ';') {
      // 顺序很重要：pushDeclaration 自己会清空 buffer，先清空就等于把这条声明丢掉
      if (stack.length > 0) pushDeclaration()
      else buffer = ''
      continue
    }
    buffer += char
  }
  return rules
}

/** 从声明体里取字号（px），用于区分正文与 WCAG 的「大字号」档。 */
function fontSizeOf(declarations) {
  for (const [property, value] of declarations) {
    if (property !== 'font-size') continue
    const px = /([\d.]+)px/.exec(value)
    if (px !== null) return Number(px[1])
    return value
  }
  return null
}

/** 从声明体里取字重，配合字号判断粗体大字号档。 */
function fontWeightOf(declarations) {
  for (const [property, value] of declarations) {
    if (property !== 'font-weight') continue
    if (value === 'bold' || value === 'bolder') return 700
    const weight = Number.parseInt(value, 10)
    if (Number.isFinite(weight)) return weight
  }
  return null
}

const [sourceArg, target] = process.argv.slice(2)
if (!sourceArg || !target) {
  console.error(
    '用法: node scripts/audit-consumers.mjs <宿主资源目录/文件...> <输出 JSON>\n' +
      '  例: node scripts/audit-consumers.mjs verify/host-src,<抽出的客户端 bundle> reference/host-consumers.json'
  )
  process.exit(2)
}

const sources = sourceArg.split(',').flatMap((entry) => collectFiles(entry.trim()))
if (sources.length === 0) {
  console.error('没有找到任何 .css / .js 输入')
  process.exit(2)
}

/**
 * 从客户端 bundle 里扫出「声明 → 令牌」的关系。
 *
 * 宿主的 feature bundle 把编译后的 CSS 作为字符串内嵌在 JS 里，无法按规则解析
 * （字符串边界、转义、拼接都会让花括号计数失效）。但**声明本身是完整的**：
 * `color:var(--dsw-alias-x)` 这段文本在两种文件里长得一模一样。
 * 因此退一步，只抓「属性名 : 值里含 var(--token)」，属性名足够判断
 * 它承载文字还是当底色 —— 而选择器与字号本来就是加分项，不是判据。
 */
function scanEmbeddedDeclarations(text) {
  const found = []
  // 值里不允许出现 ; { } —— 正好把「一条声明的取值范围」框出来
  const pattern = /([-a-zA-Z]+)\s*:\s*([^;{}]*?)var\(\s*(--[a-z0-9-]+)/gi
  for (const match of text.matchAll(pattern)) {
    const property = match[1].toLowerCase()
    // 排除 `var(--a, var(--b))` 这种把上一个变量名当成属性名的情况
    if (property.startsWith('--')) continue
    found.push([property, `var(${match[3]})`])
  }
  return found
}

/** token → { text: [...], surface: [...] }，每条消费记录都保留出处。 */
const consumers = new Map()
/**
 * token → 宿主**声明过的取值**（`{ selector, value, file }`）。
 *
 * v1.2 的 `HOST_FALLBACK` 注释里写着「check.mjs 有一条断言把 fallback 与宿主基准表
 * 逐条比对」—— 那句话是假的，因为当时的基准表只有名字、没有取值，于是
 * `--dsw-alias-button-contrast-fill` 抄成了另一个令牌的值也没人发现。
 * 这里把取值一并收进来，那条承诺才有着落。
 */
const declarations = new Map()
let ruleCount = 0

for (const file of sources) {
  const isCss = extname(file) === '.css'
  const text = stripComments(readFileSync(file, 'utf8'))
  /** 统一的形状：`{ selector, conditions, declarations }`。 */
  const units = isCss
    ? parseRules(text)
    : [{ selector: '(JS 内联样式)', conditions: [], declarations: scanEmbeddedDeclarations(text) }]

  for (const rule of units) {
    const declarations_ = rule.declarations
    if (declarations_.length === 0) continue
    ruleCount += 1
    const fontSize = fontSizeOf(declarations_)
    const fontWeight = fontWeightOf(declarations_)
    for (const [property, value] of declarations_) {
      // 自定义属性的**声明**（`--x: value`）单独收一份
      if (property.startsWith('--')) {
        const list = declarations.get(property) ?? []
        list.push({ file, selector: rule.selector, value })
        declarations.set(property, list)
      }
      const kind = TEXT_PROPERTIES.has(property)
        ? 'text'
        : SURFACE_PROPERTIES.has(property)
          ? 'surface'
          : null
      if (kind === null) continue
      for (const match of value.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        const token = match[1]
        const list = consumers.get(token) ?? { text: [], surface: [] }
        list[kind].push({
          file,
          selector: rule.selector,
          conditions: rule.conditions,
          property,
          value: value.length > 120 ? `${value.slice(0, 117)}…` : value,
          fontSize,
          fontWeight
        })
        consumers.set(token, list)
      }
    }
  }
}

/**
 * 每类记录最多留多少条。
 *
 * 索引要进仓库，而有些令牌（`--dsw-alias-label-primary`）在几百条规则里出现 ——
 * 全量存下来是 900KB 的噪声。断言只关心「有没有被当文字用」与「宿主声明了什么」，
 * 因此每类留前若干条样本、另存一个总数：既能读懂「它被用在哪里」，
 * 又不会让 diff 变成一整片。
 */
const SAMPLE_LIMIT = 12

/**
 * 文件路径单独存一张表，记录里只留下标。
 *
 * 该索引要进仓库，而路径形如
 * `dsh__node_modules__@deepseek-ai__dsh-client-ui-conversation__lib__client.js`
 * —— 一个令牌的出现次数是几十上百，逐条重复写路径会把文件撑到好几倍。
 * 内联之后 657KB → 约 320KB，而 check.mjs 根本不需要路径本身。
 */
const fileIndex = new Map()
const fileRef = (file) => {
  const normalized = file.replaceAll('\\', '/')
  if (!fileIndex.has(normalized)) fileIndex.set(normalized, fileIndex.size)
  return fileIndex.get(normalized)
}

/** 输出按令牌名排序，消费记录去重（同一规则可能在产物里出现多次）。 */
const tokens = {}
for (const token of [...new Set([...consumers.keys(), ...declarations.keys()])].sort()) {
  const entry = consumers.get(token) ?? { text: [], surface: [] }
  const dedupe = (list) => {
    const seen = new Set()
    return list.filter((item) => {
      const key = `${item.file}|${item.selector}|${item.property}|${item.value}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  const text = dedupe(entry.text)
  const surface = dedupe(entry.surface)
  const declared = []
  const declaredSeen = new Set()
  for (const item of declarations.get(token) ?? []) {
    const key = `${item.file}|${item.selector}|${item.value}`
    if (declaredSeen.has(key)) continue
    declaredSeen.add(key)
    declared.push(item)
  }
  const trim = (item) => ({ ...item, file: fileRef(item.file) })
  tokens[token] = {
    text: text.slice(0, SAMPLE_LIMIT).map(trim),
    textTotal: text.length,
    surface: surface.slice(0, SAMPLE_LIMIT).map(trim),
    surfaceTotal: surface.length,
    declared: declared.length > 0 ? declared.slice(0, SAMPLE_LIMIT).map(trim) : undefined,
    declaredTotal: declared.length
  }
}

const textTokens = Object.entries(tokens).filter(([, v]) => v.text.length > 0)
writeFileSync(
  target,
  `${JSON.stringify(
    {
      $comment:
        'DSH 宿主样式与客户端 bundle 的「消费点 + 声明取值」索引。由 scripts/audit-consumers.mjs 生成；check.mjs 用它断言三件事：①被插件覆盖、又被宿主当文字色消费的令牌必须进入可读性契约（或在 UNCOVERED 里显式豁免）；②HOST_FALLBACK 里声明的官方取值与宿主真实声明一致；③被消费却从未声明的令牌（宿主缺口）会被列出来。宿主升级后重新生成。',
      $sources: sources.map((file) => file.replaceAll('\\', '/')),
      $files: [...fileIndex.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([file]) => file),
      $stats: {
        files: sources.length,
        rules: ruleCount,
        tokens: Object.keys(tokens).length,
        declaredTokens: [...declarations.keys()].length,
        textTokens: textTokens.length
      },
      tokens
    },
    null,
    2
  )}\n`
)

console.log(
  `扫描 ${sources.length} 个样式资源 / ${ruleCount} 条规则：${Object.keys(tokens).length} 个令牌有记录，` +
    `其中 ${declarations.size} 个被宿主声明过、${textTokens.length} 个被当文字色用`
)
console.log(`-> ${target}`)
