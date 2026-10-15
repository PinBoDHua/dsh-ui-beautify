/**
 * 从宿主编译产物 `web-index.css` 里抽出指定 hash 分组（默认 1hos8 = ImageLightbox）
 * 的全部规则，写成一张真实编译样式表供验证台使用。
 *
 * ## 为什么必须用编译后的类名
 * 验证台其余组件用的是 asar 内的**源码级** .module.css，再自己加前缀命名空间。
 * 这对绝大多数规则都成立 —— 声明一样，只是类名不同。
 *
 * 但安全修正层那条规则的目标恰恰是**编译后的命名约定**：
 * 宿主把 `.close` 编译成 `_close_1hos8_29`（下划线分隔 + hash），
 * 插件用 `[class*='_backdrop'] [class*='_close_']` 命中它。
 * 拿源码级类名去渲染，规则根本不会匹配，验证台就会「两边一模一样」而看不出问题。
 *
 * 用法：node scripts/extract-compiled-css.mjs <web-index.css> <hashGroup> <out.css>
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [source, group, target] = process.argv.slice(2)
if (!source || !group || !target) {
  console.error('用法: node scripts/extract-compiled-css.mjs <web-index.css> <hashGroup> <out.css>')
  process.exit(2)
}

const css = readFileSync(source, 'utf8')

/** 顶层规则切分（含 @media 内层，验证台不需要那种复杂度，先按扁平切）。 */
const rules = []
let depth = 0
let start = 0
for (let i = 0; i < css.length; i += 1) {
  if (css[i] === '{') depth += 1
  else if (css[i] === '}') {
    depth -= 1
    if (depth === 0) {
      rules.push(css.slice(start, i + 1).trim())
      start = i + 1
    }
  }
}

const picked = rules.filter((rule) => rule.includes(`_${group}_`))
if (picked.length === 0) {
  console.error(`没有找到 hash 分组 ${group} 的规则`)
  process.exit(1)
}

const header = `/* 从宿主编译产物 web-index.css 抽出的 hash 分组 ${group} 的真实规则。\n   类名是宿主实际发布到浏览器的那一套，不是源码级名字。 */\n`
writeFileSync(target, header + picked.join('\n') + '\n')
console.log(`抽出 ${picked.length} 条规则 -> ${target}`)
for (const rule of picked) {
  console.log('  ' + rule.replace(/\s+/g, ' ').slice(0, 150))
}
