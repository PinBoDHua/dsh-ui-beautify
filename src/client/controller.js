/**
 * 界面美化 · Lumina —— 外观控制器。
 *
 * 控制器是状态的唯一宿主：面板只读它、只写它，宿主 DOM 只被它改。
 * 三个落点各司其职：
 *
 *   1. `ctx.theme.overrideTokens(source, tokens)` —— 颜色、圆角、阴影、排版、
 *      毛玻璃。走宿主主题管线，明暗自动重解析、卸载自动回滚。
 *   2. `<html data-dshb-*>` 属性 —— 给结构层样式表当开关。属性而非类名，
 *      因为宿主不管理它们，不会与框架的 class 协调产生冲突。
 *   3. 插件自有的 `<style>` 标签 —— 令牌表达不了的结构性修饰。总开关关闭时
 *      整套移除，界面回到官方原样，做到「零残留」。
 */

import { ACCENTS, CORNER_SHAPES, PRESETS, RADIUS_SCALES, TYPE_SCALES, buildTokens } from './presets.js'
import { DEFAULT_STATE, loadState, normalizeState, saveState } from './state.js'
import { STYLES } from './styles.generated.js'

/** 主题覆盖层的身份。同一 source 重复调用会整体替换旧层，所以它必须稳定。 */
const SOURCE = 'dsh-ui-beautify'

/** 各枚举键的合法取值，用于把持久化数据里的陈旧 id 挡掉。 */
const KNOWN = {
  preset: PRESETS.map((p) => p.id),
  accent: ACCENTS.map((a) => a.id),
  radius: RADIUS_SCALES.map((r) => r.id),
  corner: CORNER_SHAPES.map((c) => c.id),
  typeScale: TYPE_SCALES.map((scale) => scale.id)
}

/**
 * 布尔开关 → <html> 属性名。属性存在且为 'on' 时结构层生效。
 *
 * 注意「毛玻璃」不在这里：它只影响令牌（菜单填充色与 backdrop-filter），
 * 没有结构性样式，因此走 overrideTokens 就够了 —— 不设一个没人读的属性。
 */
const FLAGS = {
  enabled: 'data-dshb-enabled',
  ambient: 'data-dshb-ambient',
  motion: 'data-dshb-motion',
  typography: 'data-dshb-typography',
  taskList: 'data-dshb-tasklist'
}

/**
 * 枚举值 → <html> 属性名，用于按档位挂样式（例如窗口内容圆角），
 * 同时作为插件的公开状态标记：`data-dshb-preset` 让用户或其它插件
 * 可以针对某个预设写补充样式。
 */
const SELECTORS = {
  preset: 'data-dshb-preset',
  radius: 'data-dshb-radius',
  corner: 'data-dshb-corner'
}

/**
 * 建立外观控制器。
 *
 * @param options.theme - 宿主的 ui-theme 服务（提供 overrideTokens）。
 * @param options.doc - 文档对象，默认取全局 document；测试可注入替身。
 * @returns 控制器 API。
 */
export function createController(options) {
  const theme = options.theme
  const doc = options.doc ?? globalThis.document
  const listeners = new Set()

  let state = loadState(KNOWN)
  /** 已挂载的样式标签，便于总开关关闭时精确移除。 */
  let styleTags = []
  /**
   * 动效开关是否已就绪。
   *
   * 插件在首屏之后才拿到控制权：这时界面已经用官方令牌画过一遍，覆盖层落地会
   * 让主按钮、选中态等一次性改变颜色。如果此刻 `data-dshb-motion` 已经打开，
   * base.css 的过渡规则会把这次「换装」变成一段可见的淡入 —— 每次启动都闪一下。
   * 因此首次投射先不动效，等下一帧再把开关打开：换装本身瞬时完成，之后的
   * 用户交互照常有过渡。
   */
  let motionReady = false
  /**
   * 是否已经卸载。
   *
   * 卸载之后**一切投射都要停**，这不是防御性编程，而是一条真实存在的路径：
   * 首帧那次 `requestAnimationFrame` 排在队列里，HMR 在同一个 tick 内卸载并重载
   * （dsh-client-hmr 每 500ms 轮询一次），或者窗口不可见时 rAF 被无限期推迟 ——
   * 回调随后执行，会把 7 个 `data-dshb-*` 属性重新写到 `<html>` 上，
   * 而那些属性是插件对外的公开接口，**没有任何东西会再清掉它们**。
   */
  let disposed = false
  /** 首帧回调的句柄，卸载时用它取消排队中的那一帧。 */
  let rafHandle = null
  /**
   * 宿主令牌层的撤回函数。
   *
   * `theme.overrideTokens(source, tokens)` 的返回值是**唯一**的撤回入口：
   * 宿主只把层存进内部表，不会在插件卸载时替我们删。v1.2 丢弃了这个返回值，
   * 于是 README 承诺的「卸载零残留」只做到了样式标签与属性那一半 ——
   * 配色令牌会一直留在宿主的主题服务里，直到进程结束。
   */
  let tokenDisposer = null

  /** 通知所有订阅者。面板以整对象替换触发重渲染。 */
  function emit() {
    if (disposed) return
    const snapshot = { ...state }
    for (const listener of listeners) {
      try {
        listener(snapshot)
      } catch {
        /* 单个订阅者出错不应中断其余订阅者，也不应影响外观已生效的状态 */
      }
    }
  }

  /** 把状态投射到 <html> 属性上；总开关关闭时清空全部属性。 */
  function projectAttributes() {
    if (disposed) return
    if (!doc?.documentElement) return
    const root = doc.documentElement
    for (const [key, attribute] of Object.entries(FLAGS)) {
      // 动效开关要等首帧之后再打开，见 motionReady 的说明
      const active =
        state.enabled && state[key] && (key !== 'motion' || motionReady)
      if (active) root.setAttribute(attribute, 'on')
      else root.removeAttribute(attribute)
    }
    for (const [key, attribute] of Object.entries(SELECTORS)) {
      if (state.enabled) root.setAttribute(attribute, state[key])
      else root.removeAttribute(attribute)
    }
  }

  /** 挂载结构层样式表。总开关关闭时不挂，界面即回到官方原样。 */
  function mountStyles() {
    if (styleTags.length > 0 || !state.enabled) return
    if (!doc?.head) return
    for (const [name, css] of STYLES) {
      const tag = doc.createElement('style')
      tag.dataset.plugin = SOURCE
      tag.dataset.pluginCss = `${SOURCE}/${name}`
      tag.textContent = css
      doc.head.appendChild(tag)
      styleTags.push(tag)
    }
  }

  /** 移除结构层样式表。 */
  function unmountStyles() {
    for (const tag of styleTags) tag.remove()
    styleTags = []
  }

  /**
   * 把外观推给宿主。
   *
   * 令牌层在**开关关闭**时推空对象而不是撤回整层：这样「关闭 → 打开」不会在宿主侧
   * 留下需要跟踪的悬挂 disposer，界面照样回到官方原样。
   * 但**卸载**是另一回事 —— 那时必须真的把层删掉，见 mount() 的 disposer，
   * 因此这里要把宿主返回的撤回函数记下来。
   */
  function projectTokens() {
    if (disposed) return
    if (!theme || typeof theme.overrideTokens !== 'function') return
    const disposer = theme.overrideTokens(
      SOURCE,
      state.enabled ? buildTokens(state) : {}
    )
    if (typeof disposer === 'function') tokenDisposer = disposer
  }

  /** 全量投射一次。 */
  function project() {
    if (disposed) return
    projectAttributes()
    projectTokens()
    if (state.enabled) mountStyles()
    else unmountStyles()
  }

  return {
    /** 当前状态的浅拷贝。 */
    getState() {
      return { ...state }
    },

    /**
     * 合并式更新。非法值会被归一化丢弃，不会写入状态。
     * @param patch - 需要变更的字段子集。
     */
    setState(patch) {
      const merged = normalizeState({ ...state, ...patch }, KNOWN)
      const changed = Object.keys(merged).some((key) => merged[key] !== state[key])
      if (!changed) return
      state = merged
      saveState(state)
      project()
      emit()
    },

    /** 订阅状态变化，返回退订函数。 */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** 恢复出厂外观。 */
    reset() {
      state = { ...DEFAULT_STATE }
      saveState(state)
      project()
      emit()
    },

    /** 首次投射。由插件的 apply 调用一次。 */
    mount() {
      project()
      // 首帧之后才允许过渡生效，避免「换装」被渲染成一段可见的淡入。
      // 没有 requestAnimationFrame 的环境（例如无头测试替身）直接视为就绪。
      const raf = globalThis.requestAnimationFrame
      if (typeof raf === 'function') {
        rafHandle = raf(() => {
          rafHandle = null
          motionReady = true
          projectAttributes()
        })
      } else {
        motionReady = true
        projectAttributes()
      }
      return () => {
        // 顺序有意如此：先立起 disposed，让任何**已经排队**的回调变成空操作，
        // 再取消还没执行的那一帧，最后才回收三条落点。
        disposed = true
        if (rafHandle !== null && typeof globalThis.cancelAnimationFrame === 'function') {
          globalThis.cancelAnimationFrame(rafHandle)
        }
        rafHandle = null
        listeners.clear()
        unmountStyles()
        // 令牌层：优先用它自己的 disposer 撤回（宿主唯一的删除入口）；
        // 宿主若没返回函数（契约允许），退而推一个空层 —— 两条路都能让
        // 界面回到官方原样，而不是把配色留在宿主的主题服务里。
        if (typeof tokenDisposer === 'function') {
          try {
            tokenDisposer()
          } catch {
            /* 宿主可能已经先一步回收了这一层 */
          }
          tokenDisposer = null
        } else if (theme && typeof theme.overrideTokens === 'function') {
          try {
            theme.overrideTokens(SOURCE, {})
          } catch {
            /* 卸载路径上的异常不应中断属性清理 */
          }
        }
        if (doc?.documentElement) {
          for (const attribute of [
            ...Object.values(FLAGS),
            ...Object.values(SELECTORS)
          ]) {
            doc.documentElement.removeAttribute(attribute)
          }
        }
      }
    }
  }
}
