/**
 * 界面美化 · Lumina —— 外观状态的读写与归一化。
 *
 * 状态只描述「用户选了什么」，不含任何颜色值 —— 颜色由 presets.js 从
 * 预设 + 强调色推导。这样新增一个预设只需改 presets.js，持久化格式不变。
 *
 * 持久化用 localStorage 而不是宿主 settings 命名空间，原因有两条：
 *   1. 宿主的 settings schema 由各 feature 包自己拥有，第三方插件无法向其中
 *      增加字段（ui-theme 的 README 明确写了「第三方主题 id 仍是进程内扩展，
 *      不会跨越内置 settings schema」）；
 *   2. 这些偏好是纯展示层的，丢失只需重选，不值得占用宿主配置面的迁移成本。
 */

const STORAGE_KEY = 'dsh-ui-beautify:prefs:v1'

/** 外观状态默认值。也是任何非法输入的兜底。 */
export const DEFAULT_STATE = Object.freeze({
  enabled: true,
  preset: 'aurora',
  accent: 'deepseek',
  radius: 'standard',
  corner: 'squircle',
  ambient: true,
  motion: true,
  typography: true,
  taskList: true,
  glass: true
})

const BOOLEAN_KEYS = [
  'enabled',
  'ambient',
  'motion',
  'typography',
  'taskList',
  'glass'
]
const STRING_KEYS = ['preset', 'accent', 'radius', 'corner']

/**
 * 把任意输入归一化成合法状态：未知键丢弃、非法值回落默认值。
 *
 * 读取持久化数据必须走这里 —— 用户可能降级插件版本，旧状态里会有已删除的
 * 预设 id；直接信任会让 `PRESETS.find(...)` 拿到 undefined。
 *
 * @param raw - 来自 localStorage 或面板的任意值。
 * @param options - `known` 提供各枚举键的合法取值集合。
 * @returns 全新的合法状态对象。
 */
export function normalizeState(raw, options) {
  const known = options ?? {}
  const source = raw && typeof raw === 'object' ? raw : {}
  const next = { ...DEFAULT_STATE }
  for (const key of BOOLEAN_KEYS) {
    if (typeof source[key] === 'boolean') next[key] = source[key]
  }
  for (const key of STRING_KEYS) {
    const allowed = known[key]
    const value = source[key]
    if (typeof value !== 'string') continue
    // 只有在 `known` **完全没有**提供这个键时才放行任意字符串（无选项的调用路径）。
    // 提供了一张空表意味着「这个键目前没有合法取值」，那就应当回落默认值 ——
    // 旧写法把空表当成「没有约束」，于是一张空表会把拼错的值原样放进去。
    if (Array.isArray(allowed)) {
      if (allowed.includes(value)) next[key] = value
    } else {
      next[key] = value
    }
  }
  return next
}

/** 读持久化状态；任何异常（隐私模式、配额、JSON 损坏）都回落到默认值。 */
export function loadState(options) {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    return normalizeState(JSON.parse(raw), options)
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/** 写持久化状态；写失败不影响本次会话内的生效（状态已在内存里）。 */
export function saveState(state) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 持久化失败是可接受的降级：本次会话仍然按所选外观渲染 */
  }
}
