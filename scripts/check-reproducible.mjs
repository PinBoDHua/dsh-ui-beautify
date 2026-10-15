/**
 * 可复现性自检：同一份源码在 LF 与 CRLF 检出下必须产出**逐字节相同**的 client.js。
 *
 * ## 为什么值得单独测
 * Windows 上 Git 默认 `core.autocrlf=true`，工作区会被检出成 CRLF；
 * `.gitattributes` 声明了 `eol=lf`，但贡献者的编辑器、解压工具、CI 缓存都可能
 * 引入 CRLF。构建脚本里有行锚定正则（`^import ... $`）与被原样嵌入产物的 CSS，
 * 两边任何一处漏了规范化，都会让「同一份源码产出不同产物」——
 * 而 client.js 是直接交给宿主加载的文件，字节不同意味着「我这儿好的」不再成立。
 *
 * 做法：把 src/ 复制一份改成 CRLF，分别构建，比对 SHA-256，然后还原。
 *
 *   node scripts/check-reproducible.mjs
 */
import { createHash } from 'node:crypto'
import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const BACKUP = join(ROOT, '.src-lf-backup')
const OUT = join(ROOT, 'client', 'client.js')

/** 递归列出文件。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** 把目录下所有文本文件改成 CRLF。 */
function toCrlf(dir) {
  for (const file of walk(dir)) {
    if (!/\.(js|mjs|css)$/.test(file)) continue
    const text = readFileSync(file, 'utf8')
    writeFileSync(file, text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'))
  }
}

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

/** 跑一次构建，返回产物哈希。 */
function buildAndHash(label) {
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], {
    cwd: ROOT,
    stdio: 'ignore'
  })
  if (result.status !== 0) {
    console.error(`  ${label} 构建失败（退出码 ${result.status}）`)
    process.exit(1)
  }
  return sha(OUT)
}

try {
  rmSync(BACKUP, { recursive: true, force: true })
  cpSync(SRC, BACKUP, { recursive: true })

  const lfHash = buildAndHash('LF')
  console.log(`  LF   检出  client.js sha256 ${lfHash.slice(0, 16)}…`)

  toCrlf(SRC)
  const crlfHash = buildAndHash('CRLF')
  console.log(`  CRLF 检出  client.js sha256 ${crlfHash.slice(0, 16)}…`)

  if (lfHash !== crlfHash) {
    console.error(
      '\n可复现性自检失败：LF 与 CRLF 检出的产物不一致 ——\n' +
        '  说明构建里还有某处读取没有把 \\r\\n 规范化成 \\n。\n' +
        '  检查 scripts/build.mjs 里所有 readFileSync 的调用点。'
    )
    process.exitCode = 1
  } else {
    console.log('\n可复现性自检通过：产物与检出换行无关。')
  }
} finally {
  // 无论成败都把源目录还原成备份（备份本身是 LF）
  rmSync(SRC, { recursive: true, force: true })
  cpSync(BACKUP, SRC, { recursive: true })
  rmSync(BACKUP, { recursive: true, force: true })
  buildAndHash('还原')
  console.log(`  已还原源目录并重建（${relative(ROOT, SRC)}）`)
}
