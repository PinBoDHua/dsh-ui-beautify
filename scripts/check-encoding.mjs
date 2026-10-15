/**
 * 编码自检：找出被非 UTF-8 工具（例如 PowerShell 的 Get-Content/Set-Content）
 * 改写后产生乱码的源文件。
 *
 * 背景：本仓库的源码与文档都以 UTF-8 保存，中文注释占比很高。
 * 用 `Set-Content -Encoding utf8` 回写一个以 UTF-8 读入的字符串，在部分
 * PowerShell 环境下会先把内容按系统代码页（GBK）解码再写成 UTF-8，
 * 中文就整段变成生僻字 —— 而且文件仍然能通过语法检查，
 * 只有肉眼看 diff 才会发现。
 *
 * 本文档刻意**不写出乱码样例字面量**：一旦写出来，这个检测器就会把自己
 * 判成乱码文件，于是不得不为自己开一条豁免。特征集全用码点构造，
 * 检测器因此也能检查自己。
 *
 *   node scripts/check-encoding.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 只检查这些后缀；二进制与生成物跳过。 */
const EXTENSIONS = ['.js', '.mjs', '.cjs', '.css', '.html', '.md', '.json', '.py']
const SKIP_DIRS = new Set(['node_modules', '.git', '.chrome-profile', 'out', 'build'])

/**
 * 乱码特征字符集，**用码点构造**。
 *
 * 两点考虑：
 *
 * 1. 用码点而不是字面量，检测器自身的源码里就不会出现这些字符 ——
 *    于是它也能检查自己，不需要把自己排除在外。
 *
 * 2. 只收「GBK 误解码 UTF-8 中文」会产生、而简体技术写作里几乎不会出现的字。
 *    第一版图省事，把常用字「存」也写了进去，结果 README、build.mjs、check.mjs
 *    全被误报 —— 因为「保存 / 不存在」到处都是。**判定规则宁可漏报也不能误报**：
 *    误报会让这道自检很快被无视，漏报还有 U+FFFD 这条兜底。
 */
const MOJIBAKE_CODEPOINTS = [
  0x9423, 0x5c84, 0x6f70, 0x7f07, 0x5ea1, 0x5bf2, 0x951b, 0x9428, 0x7f04,
  0x9352, 0x6c2c, 0x30bd, 0x7487, 0x69d1, 0x9365, 0x708b, 0x57cc, 0x9388,
  0x94a3, 0x799e, 0x935a, 0x6c82, 0x7039, 0x7522, 0x9286, 0x9366, 0x9225
]
const MOJIBAKE = new RegExp(
  `[${MOJIBAKE_CODEPOINTS.map((code) => String.fromCodePoint(code)).join('')}]`,
  'g'
)

/** 出现这么多处特征字符就判定为乱码（真实损坏一次就是几十处）。 */
const HIT_THRESHOLD = 3

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out)
    } else if (EXTENSIONS.some((ext) => name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

const files = walk(ROOT)
const broken = []
const samples = []
for (const file of files) {
  const bytes = readFileSync(file)
  const text = bytes.toString('utf8')
  // 替换字符 U+FFFD 说明字节流本身不是合法 UTF-8 —— 这是确定性信号
  const hasReplacement = text.includes('\uFFFD')
  const hits = text.match(MOJIBAKE)?.length ?? 0
  if (hasReplacement || hits >= HIT_THRESHOLD) {
    broken.push({ file: relative(ROOT, file), hits, hasReplacement })
  } else if (hits > 0) {
    samples.push({ file: relative(ROOT, file), hits })
  }
}

console.log(`检查 ${files.length} 个文本文件，特征字符集 ${MOJIBAKE_CODEPOINTS.length} 个`)
if (samples.length > 0) {
  console.log('低于阈值的零星命中（多半是正常用字，列出供人工判断）：')
  for (const item of samples) console.log(`  ${item.file}  ${item.hits} 处`)
}
if (broken.length === 0) {
  console.log('\n编码自检通过：没有发现乱码文件。')
  process.exit(0)
}
console.error(`\n发现 ${broken.length} 个疑似乱码文件：`)
for (const item of broken) {
  console.error(
    `  ${item.file}  (特征字符 ${item.hits} 处${item.hasReplacement ? '，含替换字符 U+FFFD' : ''})`
  )
}
process.exit(1)
