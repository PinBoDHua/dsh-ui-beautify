/**
 * 可视化验证台 —— 截图。
 *
 * 用本机真实 Chromium（Chrome/Edge 无头模式）加载 preview.html，为每组
 * 「状态 × 明暗 × 视图」拍一张图。无头模式不碰用户的浏览器配置（独立
 * --user-data-dir），也不需要任何鉴权。
 *
 * 用法：node verify/shoot.mjs
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const OUT = join(HERE, 'out')
const PROFILE = join(HERE, '.chrome-profile')

/** 候选浏览器，按优先级；都是标准 Chromium，支持 --headless=new --screenshot。 */
const BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
]

const browser = BROWSERS.find((candidate) => existsSync(candidate))
if (!browser) {
  console.error('未找到 Chrome/Edge，无法截图。')
  process.exit(2)
}

/** 截图任务清单。`size` 是 CSS 像素；渲染按 2x 缩放以便看清 0.5px 发丝线。 */
const SHOTS = [
  {
    view: 'shell',
    size: [1120, 880],
    states: ['official', 'aurora', 'midnight', 'graphite', 'paper', 'violet'],
    modes: ['light', 'dark']
  },
  {
    view: 'overlay',
    size: [1120, 880],
    states: ['official', 'aurora', 'paper'],
    modes: ['light', 'dark']
  },
  {
    view: 'panel',
    size: [820, 780],
    states: ['official', 'aurora', 'midnight', 'paper'],
    modes: ['light', 'dark']
  },
  {
    // 真实窗口框架 + Windows 标题栏模式：用来盯中心列左上角那个圆角。
    // 这一组不加任何复刻转述 —— 插件自己的 base.css 直接作用在宿主的
    // 真实哈希类名上，因此是所见即所得的问题复现。
    view: 'frame',
    size: [1000, 620],
    states: ['official', 'aurora', 'paper'],
    modes: ['light', 'dark']
  },
  {
    // 圆角画廊：三档并排，宿主真实组件，用来判断半径是否与控件尺寸匹配。
    view: 'radius',
    size: [1240, 1080],
    states: ['official'],
    modes: ['light', 'dark']
  },
  {
    // 回归夹具：把「氛围光挂在窗口框架上」这条已删除的规则重新套上，
    // 在同一轮渲染里产出与修复后完全同源的缺陷对照图。
    view: 'frame',
    bug: 'ambient-frame',
    size: [1000, 620],
    states: ['aurora'],
    modes: ['light']
  },
  {
    // 图片灯箱 × 原生标题栏覆盖层：验证「关闭按钮不再落在窗口按钮占位里」。
    view: 'lightbox',
    size: [900, 560],
    states: ['aurora'],
    modes: ['light']
  },
  {
    view: 'lightbox',
    bug: 'caption-overlap',
    size: [900, 560],
    states: ['aurora'],
    modes: ['light']
  }
]

mkdirSync(OUT, { recursive: true })

/** 单次截图。返回 PNG 字节数或抛错。 */
function shoot({ view, state, mode, size, file, bug }) {
  const [width, height] = size
  const query = new URLSearchParams({ view, state, mode })
  if (bug) query.set('bug', bug)
  const url = `${pathToFileURL(join(HERE, 'preview.html')).href}?${query}`
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=2',
    `--user-data-dir=${PROFILE}`,
    `--window-size=${width},${height}`,
    '--virtual-time-budget=2500',
    `--screenshot=${file}`,
    url
  ]
  const result = spawnSync(browser, args, { stdio: 'ignore', timeout: 90_000 })
  if (!existsSync(file)) {
    throw new Error(
      `截图失败 view=${view} state=${state} mode=${mode} bug=${bug ?? '-'}（退出码 ${result.status}）`
    )
  }
  return statSync(file).size
}

let count = 0
let bytes = 0
for (const shot of SHOTS) {
  for (const state of shot.states) {
    for (const mode of shot.modes) {
      const suffix = shot.bug ? `-${shot.bug}` : ''
      const name = `${shot.view}${suffix}-${state}-${mode}.png`
      const file = join(OUT, name)
      const size = shoot({
        view: shot.view,
        state,
        mode,
        bug: shot.bug,
        size: shot.size,
        file
      })
      count += 1
      bytes += size
      console.log(`  ${name.padEnd(38)} ${(size / 1024).toFixed(0)} KB`)
    }
  }
}

// 清掉无头浏览器的临时配置目录，避免在仓库里留下上百 MB 的缓存
rmSync(PROFILE, { recursive: true, force: true })

console.log(
  `\n共 ${count} 张截图，合计 ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${OUT.replace(ROOT, '.')}`
)
console.log(`浏览器：${browser}`)
console.log(`已生成：${readdirSync(OUT).length} 个文件`)
