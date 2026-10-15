/**
 * 界面美化 · Lumina —— 安全安装 / 卸载。
 *
 * ## 为什么需要这个脚本而不是一行 `dsh plugin add`
 * `desktop` 是 Electron 独占的保留 profile：npm CLI 拒绝管理它，只有内置 CLI 能写，
 * 而内置 CLI 要求**完全退出桌面端**（profile 有写锁）。用户往往正开着应用，
 * 于是需要一条「不改动、先看清楚要改什么」的路径。
 *
 * 本脚本因此默认是 **dry-run**：只打印将要发生的改动，不动任何文件。
 * 加 `--apply` 才真正执行，且执行前一定先备份。
 *
 * ## 用法
 *   node scripts/install.mjs                  # 预览（默认，不写盘）
 *   node scripts/install.mjs --apply          # 安装
 *   node scripts/install.mjs --uninstall      # 预览卸载
 *   node scripts/install.mjs --apply --uninstall
 *
 * ## 它改什么
 *   1. <profile>/node_modules/dsh-ui-beautify  —— 拷贝插件目录（先移除旧副本）
 *   2. <profile>/package.json                  —— dependencies + dsh.profile.bundles
 *   3. <profile>/cordis.patch.yml              —— 不碰（插件自带 patch，由 bundles 触发）
 *
 * 备份写到 <DSH_HOME>/dsh-ui-beautify-backup-<时间戳>/，并留一份
 * restore.ps1 供一键回滚。
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_NAME = 'dsh-ui-beautify'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const uninstall = argv.includes('--uninstall')

/** 解析 profile 目录：优先环境变量，其次 DSH_HOME 下的 desktop profile。 */
function resolveProfileDir() {
  if (process.env.DSH_PROFILE_DIR && existsSync(process.env.DSH_PROFILE_DIR)) {
    return process.env.DSH_PROFILE_DIR
  }
  const home = process.env.DSH_HOME
  if (home && existsSync(join(home, 'profiles', 'desktop'))) {
    return join(home, 'profiles', 'desktop')
  }
  throw new Error(
    '找不到 DSH profile 目录。请设置 DSH_PROFILE_DIR，或在 DSH 桌面端中运行本脚本。'
  )
}

const profileDir = resolveProfileDir()
const manifestPath = join(profileDir, 'package.json')
const targetDir = join(profileDir, 'node_modules', PLUGIN_NAME)
const dshHome = process.env.DSH_HOME ?? dirname(dirname(profileDir))
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backupDir = join(dshHome, `${PLUGIN_NAME}-backup-${stamp}`)

const original = readFileSync(manifestPath, 'utf8')
const manifest = JSON.parse(original)

/**
 * 插件目录里不该被复制进 profile 的东西。
 *
 * profile 的 node_modules 不是发布产物，没必要带上验证台截图（约 8 MB）、
 * 宿主样式副本与测试。插件运行时真正需要的只有 lib/、client/、
 * cordis.patch.yml 与 package.json；src/ 与 scripts/ 一并保留是为了让
 * profile 里那份副本仍可读、可重新构建。
 */
const COPY_EXCLUDE = new Set([
  'node_modules',
  '.git',
  '.chrome-profile',
  'verify',
  'tests',
  'reference'
])

const log = (message) => console.log(message)
const change = (message) => console.log(`  · ${message}`)

// ------------------------------------------------------------ 计算目标状态

const next = JSON.parse(original)
next.dependencies ??= {}
const bundles = next.dsh?.profile?.bundles

if (!Array.isArray(bundles)) {
  console.error(
    `${manifestPath} 里没有 dsh.profile.bundles 数组 —— 该 profile 结构不符合预期，已中止。`
  )
  process.exit(2)
}

if (uninstall) {
  delete next.dependencies[PLUGIN_NAME]
  next.dsh.profile.bundles = bundles.filter((name) => name !== PLUGIN_NAME)
} else {
  next.dependencies[PLUGIN_NAME] = `file:${ROOT.replace(/\\/g, '/')}`
  if (!bundles.includes(PLUGIN_NAME)) next.dsh.profile.bundles = [...bundles, PLUGIN_NAME]
}

const nextText = `${JSON.stringify(next, null, 2)}\n`
const willWriteManifest = nextText !== original
const willCopy = !uninstall
const willRemoveCopy = uninstall && existsSync(targetDir)

// ---------------------------------------------------------------- 展示计划

log(`${uninstall ? '卸载' : '安装'}计划（${apply ? '执行' : '预览，不写盘'}）`)
log(`  profile      ${profileDir}`)
log(`  插件源       ${ROOT}`)
log('')

if (willCopy) {
  change(`复制插件目录 -> ${targetDir}`)
  change('  （复制前会先移除该目录下的旧副本）')
}
if (willRemoveCopy) change(`删除 ${targetDir}`)
if (willWriteManifest) {
  change(`改写 ${manifestPath}`)
  if (!uninstall) {
    change(`  dependencies["${PLUGIN_NAME}"] = "file:${ROOT.replace(/\\/g, '/')}"`)
  } else {
    change(`  dependencies 移除 "${PLUGIN_NAME}"`)
  }
  change(
    `  dsh.profile.bundles = [${next.dsh.profile.bundles.map((n) => JSON.stringify(n)).join(', ')}]`
  )
} else {
  change('package.json 无需改动（已是目标状态）')
}
change(`备份 -> ${backupDir}`)
log('')

if (!apply) {
  log('这是预览。确认无误后加 --apply 执行：')
  log(`  node scripts/install.mjs --apply${uninstall ? ' --uninstall' : ''}`)
  log('')
  log('提示：桌面端正在运行时，profile 清单的改动会触发 dsh-hmr 重新组合层栈。')
  log('      若想完全可控，请先退出 DeepSeek Harness 再用内置 CLI 安装：')
  log(
    '      & "D:\\deepseekharness\\resources\\runtime\\cli\\bin\\dsh.cmd" plugin --profile desktop add "file:' +
      ROOT.replace(/\\/g, '/') +
      '"'
  )
  process.exit(0)
}

// ------------------------------------------------------------------ 执行

mkdirSync(backupDir, { recursive: true })

/** 备份一个文件（若存在）。 */
function backup(relative) {
  const from = join(profileDir, relative)
  if (!existsSync(from)) return false
  const to = join(backupDir, relative.replace(/[\\/]/g, '__'))
  cpSync(from, to)
  return true
}

const backedUp = [
  'package.json',
  'cordis.patch.yml',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml'
].filter(backup)

writeFileSync(
  join(backupDir, 'restore.ps1'),
  `# 界面美化 · Lumina —— 一键回滚到安装前的 profile 状态。
# 用法：先在 DeepSeek Harness 里完全退出，然后：
#   pwsh -File "${join(backupDir, 'restore.ps1')}"
$ErrorActionPreference = 'Stop'
$profile = '${profileDir.replace(/'/g, "''")}'
foreach ($pair in @(
${backedUp.map((f) => `  @('${f}', '${f.replace(/[\\/]/g, '__')}')`).join(',\n')}
)) {
  $src = Join-Path '${backupDir.replace(/'/g, "''")}' $pair[1]
  if (Test-Path $src) { Copy-Item $src (Join-Path $profile $pair[0]) -Force; Write-Host "restored $($pair[0])" }
}
$plugin = Join-Path $profile 'node_modules\\${PLUGIN_NAME}'
if (Test-Path $plugin) { Remove-Item $plugin -Recurse -Force; Write-Host 'removed plugin copy' }
Write-Host '回滚完成。请重新打开 DeepSeek Harness。'
`
)

if (uninstall) {
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true })
    log(`已删除 ${targetDir}`)
  }
} else {
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(dirname(targetDir), { recursive: true })
  cpSync(ROOT, targetDir, {
    recursive: true,
    filter: (source) => !COPY_EXCLUDE.has(source.split(/[\\/]/).pop())
  })
  log(`已复制插件 -> ${targetDir}`)
}

if (willWriteManifest) {
  writeFileSync(manifestPath, nextText)
  log(`已改写 ${manifestPath}`)
}

log('')
log(`备份：${backupDir}`)
log(`回滚：pwsh -File "${join(backupDir, 'restore.ps1')}"`)
log('')
log('下一步：')
log('  1. 如果 DeepSeek Harness 正开着，profile 清单变更会被 dsh-hmr 察觉并重新组合层栈；')
log('     若界面没有出现「界面美化」设置分区，请完全退出后重新打开。')
log('  2. 客户端 bundle 的改动由 dsh-client-hmr 每 500ms 轮询，改完源码跑一次')
log('     npm run build 即可热替换，无需刷新页面。')
log(`  3. 卸载：node scripts/install.mjs --apply --uninstall`)

// 复制后做一次最小可用性检查：入口与客户端 bundle 都在
const checks = [
  [join(targetDir, 'lib', 'index.js'), '宿主侧入口'],
  [join(targetDir, 'client', 'client.js'), '客户端 bundle'],
  [join(targetDir, 'cordis.patch.yml'), 'bundle patch'],
  [join(targetDir, 'package.json'), '包清单']
]
log('')
for (const [path, label] of checks) {
  log(`  ${existsSync(path) ? '✓' : '✗'} ${label}  ${path.replace(profileDir, '<profile>')}`)
}
const installed = readdirSync(targetDir).length
log(`  插件目录条目数：${installed}`)
