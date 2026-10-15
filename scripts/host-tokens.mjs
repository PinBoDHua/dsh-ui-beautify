/**
 * 一次性工具：从已提取的宿主资源里汇总「宿主真正声明过的 CSS 自定义属性」，
 * 生成 reference/host-tokens.json。
 *
 * 它不是构建的一部分，只在宿主升级、需要刷新基准表时手工运行：
 *   node scripts/host-tokens.mjs <提取目录> <输出文件>
 *
 * 之所以需要这张表：插件覆盖一个宿主从未声明的令牌名不会报错，只会静默无效。
 * check.mjs 用这张表把「写错名字」变成构建期失败。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const source = process.argv[2]
const target = process.argv[3]
if (!source || !target) {
  console.error('用法: node scripts/host-tokens.mjs <提取目录> <输出文件>')
  process.exit(2)
}

/** 从任意文本里收集 `--name:` 形式（即真正被赋值）的自定义属性名。 */
function declared(text, into) {
  for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) into.add(match[1])
}

const names = new Set()
const evidence = {}
const record = (file, text) => {
  const before = names.size
  declared(text, names)
  evidence[file] = names.size - before
}

// 1) ui-theme 的八张令牌样式表（颜色、阴影阶、排版阶梯、滚动条、圆角基数的权威来源）
const cssDir = join(source, 'css')
for (const file of readdirSync(cssDir).filter((f) => f.endsWith('.css'))) {
  record(`ui-theme/lib/styles/${file}`, readFileSync(join(cssDir, file), 'utf8'))
}

// 2) ui-layout / ui-theme 的客户端 bundle：包含窗口内容圆角、菜单材质等
//    只在组件样式表里声明的令牌。
for (const file of ['layout-client.js', 'theme-client.js']) {
  record(`bundles/${file}`, readFileSync(join(source, file), 'utf8'))
}

const sorted = [...names].sort()
writeFileSync(
  target,
  `${JSON.stringify(
    {
      $comment:
        'DSH 宿主真正声明过的 CSS 自定义属性基准表。由 scripts/host-tokens.mjs 从宿主资源生成；check.mjs 用它校验插件覆盖的令牌名存在。宿主升级后应重新生成。',
      count: sorted.length,
      tokens: sorted
    },
    null,
    2
  )}\n`
)
console.log(`已写出 ${sorted.length} 个宿主令牌 -> ${target}`)
