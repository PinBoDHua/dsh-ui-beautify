/**
 * 审计：宿主的**固定定位控件**是否侵入了 Windows 原生标题栏覆盖层。
 *
 * ## 背景
 * 宿主在 Windows 上用 Electron 的 `titleBarOverlay` 画最小化/最大化/关闭三个按钮。
 * 它们不在 DOM 里、由 Chromium 绘制在页面**之上**，占位大致是
 * `top: 0..40px`、`right: 0..138px`（高度取自 --dsh-windows-titlebar-height）。
 *
 * 任何 `position: fixed` 且落在该矩形内的页面控件都会被原生按钮盖住 ——
 * 用户看到的是「自己的关闭按钮」，点到的是「关闭程序」。这个审计把这个交集找出来。
 *
 * ## 用法
 *   node scripts/audit-caption-collision.mjs <提取目录>
 * 提取目录里应有 `css/**\/*.css`（宿主原始组件样式）与 `src/*.client.js`（含内嵌 CSS）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('用法: node scripts/audit-caption-collision.mjs <提取目录>')
  process.exit(2)
}

/** Windows 标题栏覆盖层的占位。高度与宿主 preload 写入的 40px 一致。 */
const CAPTION = { top: 0, bottom: 40, right: 0, left: 138 }

/** 递归找出目录下所有文件。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** 从一段 CSS 文本里挑出「固定定位且靠近右上角」的规则。 */
function scan(css, source) {
  const hits = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().split('\n').pop().trim()
    const body = m[2]
    if (!/position\s*:\s*fixed/.test(body)) continue

    const num = (prop) => {
      const r = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`)
      const found = body.match(r)
      return found ? Number(found[1]) : undefined
    }
    const top = num('top')
    const right = num('right')
    // inset 简写也常见
    const inset = body.match(/(?:^|;)\s*inset\s*:\s*([^;}]+)/)?.[1]?.trim()

    let effectiveTop = top
    let effectiveRight = right
    if (inset && inset.split(/\s+/).length >= 2) {
      const parts = inset.split(/\s+/)
      const px = (v) => (v.endsWith('px') ? Number.parseFloat(v) : undefined)
      effectiveTop ??= px(parts[0])
      effectiveRight ??= px(parts[1])
    }
    if (effectiveTop === undefined || effectiveRight === undefined) continue
    if (effectiveTop > CAPTION.bottom || effectiveRight > CAPTION.left) continue

    hits.push({ source, selector, top: effectiveTop, right: effectiveRight })
  }
  return hits
}

const files = walk(root)
const all = []
for (const file of files) {
  if (!/\.(css|js|cjs|mjs)$/.test(file)) continue
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (!text.includes('position:fixed') && !text.includes('position: fixed')) continue
  all.push(...scan(text, file.slice(root.length + 1)))
}

console.log(`扫描 ${files.length} 个文件，命中 ${all.length} 条「固定定位 + 落在标题栏覆盖层内」的规则\n`)
const seen = new Set()
for (const hit of all) {
  const key = `${hit.selector}|${hit.top}|${hit.right}`
  if (seen.has(key)) continue
  seen.add(key)
  console.log(`  top:${String(hit.top).padStart(4)}px  right:${String(hit.right).padStart(4)}px   ${hit.selector}`)
  console.log(`        ${hit.source}`)
}
