/**
 * 一次性工具：把 app.asar 里的宿主样式资源抽出来，供消费点索引使用。
 *
 * ## 为什么要抽 JS
 * 宿主的 UI 是 51 个客户端 bundle，**每个 bundle 自带一段编译后的 CSS 字符串**
 * （`lib/client.js` 里的样式注入），并不都落在 `.css` 文件里。只扫 `.css` 会漏掉
 * 绝大多数真实消费点 —— 例如 `--dsw-alias-label-deep-diving` 与思考态的渐变，
 * 消费它们的是 feature bundle，而不是 `:root` 那张令牌表。
 *
 * asar 的布局是 `[u32 pickle 尺寸][u32 头部尺寸][u32 JSON 长度][JSON 头部][数据]`，
 * 因此不需要任何 npm 包就能只读头部、按偏移取单个文件。
 *
 * 用法：
 *   node scripts/extract-host-assets.mjs <app.asar> <输出目录> [路径子串] [扩展名...]
 *   例：node scripts/extract-host-assets.mjs app.asar out "dsh-client" .js .css
 */
import { mkdirSync, openSync, readSync, closeSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'

const [, , archivePath, outDir, filter, ...extensions] = process.argv
if (!archivePath || !outDir) {
  console.error(
    '用法: node scripts/extract-host-assets.mjs <app.asar> <输出目录> [路径子串] [扩展名...]'
  )
  process.exit(2)
}
const wantedExtensions =
  extensions.length > 0 ? extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)) : ['.css']

const fd = openSync(archivePath, 'r')
const sizeBuffer = Buffer.alloc(8)
readSync(fd, sizeBuffer, 0, 8, 0)
const headerPickleSize = sizeBuffer.readUInt32LE(4)
const headerBuffer = Buffer.alloc(headerPickleSize)
readSync(fd, headerBuffer, 0, headerPickleSize, 8)
const jsonSize = headerBuffer.readUInt32LE(4)
const header = JSON.parse(headerBuffer.toString('utf8', 8, 8 + jsonSize))
const dataStart = 8 + headerPickleSize

/** 深度优先遍历 asar 头部，收集 `{ 路径, 偏移, 大小 }`。 */
function collect(node, prefix = '', out = []) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const full = prefix ? `${prefix}/${name}` : name
    if (entry.files) collect(entry, full, out)
    else if (typeof entry.offset === 'string') {
      out.push({ path: full, offset: Number(entry.offset), size: entry.size })
    }
  }
  return out
}

const files = collect(header)
const wanted = files.filter(
  (file) =>
    wantedExtensions.includes(extname(file.path)) &&
    (filter === undefined || file.path.includes(filter))
)
let bytes = 0
for (const file of wanted) {
  const buffer = Buffer.alloc(file.size)
  readSync(fd, buffer, 0, file.size, dataStart + file.offset)
  const target = join(outDir, file.path.replaceAll('/', '__'))
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, buffer)
  bytes += file.size
}
closeSync(fd)
console.log(
  `asar 内共 ${files.length} 个文件；匹配 ${wanted.length} 个（${(bytes / 1024 / 1024).toFixed(1)} MB）-> ${outDir}`
)
