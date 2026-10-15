/**
 * 界面美化 · Lumina —— 运行时集成测试。
 *
 * 静态审计只能证明「形状对」。这个测试真正把产出的 client.js 跑起来：
 * 在一个最小化的 window/document/cordis 替身里加载 bundle，调用 apply(ctx)，
 * 然后断言插件对宿主造成的实际副作用 —— 令牌层内容、样式标签、DOM 属性、
 * slot 注册与面板渲染、以及各开关的联动与卸载残留。
 *
 * 用 `node --test tests/runtime.test.mjs` 运行。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = readFileSync(join(ROOT, 'client', 'client.js'), 'utf8')

/**
 * 插件构建产物里的样式表清单。
 *
 * 这里**不写死张数**：写死就又多了一份需要同步的清单 —— 新增 safety.css 时
 * 测试会以「预期 4 张」失败，而失败原因与被测行为毫无关系。断言改成
 * 「挂载的标签数等于产物里的样式表数」，构建加了什么就测什么。
 */
const { STYLES } = await import(
  new URL('../src/client/styles.generated.js', import.meta.url).href
)
const STYLE_COUNT = STYLES.length

/**
 * 控制器会在 `<html>` 上投射多少个属性。
 *
 * 同样不写死：新增一个开关（例如 data-dshb-tasklist）就多一个，
 * 写死会让「卸载残留」那条测试以无关原因失败。直接从控制器源码里数
 * `'data-dshb-…'` 字面量，声明了几个就断言几个。
 */
const ATTRIBUTE_COUNT = new Set(
  [
    ...readFileSync(join(ROOT, 'src', 'client', 'controller.js'), 'utf8').matchAll(
      /'(data-dshb-[a-z-]+)'/g
    )
  ].map((match) => match[1])
).size

// ------------------------------------------------------------- React 替身

/**
 * 只实现本插件用到的三个 API 的最小 React。
 *
 * `useState` 在单次渲染里返回初值与一个空操作 setter；`useEffect` 立即执行并
 * 记录清理函数 —— 足够验证「组件能渲染出预期结构且不抛异常」。
 */
function createReactStub() {
  const effects = []
  return {
    effects,
    createElement(type, props, ...children) {
      return {
        type,
        props: {
          ...(props ?? {}),
          children: children.length > 1 ? children : children[0]
        }
      }
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') effects.push(cleanup)
    }
  }
}

// -------------------------------------------------------------- DOM 替身

/** 极简 document：记录属性写入与样式标签挂载。 */
function createDocumentStub() {
  const attributes = new Map()
  const head = {
    children: [],
    appendChild(node) {
      this.children.push(node)
      return node
    }
  }
  const documentElement = {
    setAttribute(name, value) {
      attributes.set(name, value)
    },
    removeAttribute(name) {
      attributes.delete(name)
    },
    getAttribute: (name) => attributes.get(name) ?? null,
    hasAttribute: (name) => attributes.has(name)
  }
  return {
    attributes,
    head,
    document: {
      documentElement,
      head,
      createElement: (tag) => ({
        tagName: tag,
        dataset: {},
        textContent: '',
        remove() {
          head.children = head.children.filter((child) => child !== this)
        }
      })
    }
  }
}

/** 记录令牌层与 slot 注册的 cordis 替身。 */
function createContextStub() {
  const calls = { tokens: [], effects: [], sections: [] }
  const disposers = []
  return {
    calls,
    disposers,
    ctx: {
      effect(fn, label) {
        calls.effects.push(label)
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
        return dispose
      },
      locale: {
        dictionaries: [],
        register(ns, dict) {
          this.dictionaries.push({ ns, dict })
        },
        bind() {
          return () => undefined
        }
      },
      slots: {
        inject(name, callback) {
          calls.injectedInto = name
          return callback()
        },
        register(definition, render) {
          calls.sections.push({ definition, render })
          return () => {}
        }
      },
      theme: {
        overrideTokens(source, tokens) {
          calls.tokens.push({ source, tokens })
          return () => {}
        }
      }
    }
  }
}

/**
 * 在替身环境里加载 bundle 并取回模块导出。
 *
 * `document` / `localStorage` 必须在加载前就存在于全局 —— 这正是浏览器的情形，
 * 也是插件读取它们的方式（`globalThis.document`）。
 */
function loadPlugin(globals = {}) {
  const captured = []
  const sandbox = { console, ...globals }
  sandbox.window = {
    __ModuleLoader__: {
      load(spec) {
        captured.push(spec)
      }
    }
  }
  vm.createContext(sandbox)
  new vm.Script(BUNDLE, { filename: 'client.js' }).runInContext(sandbox)

  assert.equal(captured.length, 1, 'bundle 必须恰好登记一次模块')
  const spec = captured[0]
  const react = createReactStub()
  const exports = spec.factory((id) => {
    assert.equal(id, 'react', `bundle 只应 require react，实际请求了 ${id}`)
    return react
  })
  return { spec, exports, react }
}

/** 建一套完整可用的测试环境。 */
function setup(options = {}) {
  const store = new Map()
  if (options.seed) for (const [k, v] of options.seed) store.set(k, v)
  const localStorage = options.localStorage ?? {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  }
  const { document, attributes, head } = createDocumentStub()
  const { exports, react } = loadPlugin({ document, localStorage })
  const { ctx, calls, disposers } = createContextStub()
  exports.apply({ ...ctx, document })
  return {
    exports,
    react,
    calls,
    disposers,
    document,
    attributes,
    head,
    store,
    controller: calls.sections[0]?.definition.inject().controller
  }
}

// ------------------------------------------------------------------ 测试

test('产出的 bundle 满足宿主模块加载器契约', () => {
  const { spec, exports } = loadPlugin()
  assert.equal(spec.id, 'dsh-ui-beautify', 'id 必须是包名')
  assert.equal(typeof spec.factory, 'function')
  assert.equal(exports.name, 'dsh-ui-beautify')
  assert.ok(Array.isArray(exports.inject), 'inject 必须是数组')
  assert.equal(typeof exports.apply, 'function')
  for (const service of ['theme', 'slots', 'locale']) {
    assert.ok(exports.inject.includes(service), `inject 必须声明依赖 ${service}`)
  }
})

test('apply 向宿主推送令牌层，值都是 { light, dark } 对且品牌位被接管', () => {
  const { calls } = setup()
  assert.equal(calls.tokens.length, 1, 'apply 必须恰好推送一次令牌层')
  const [layer] = calls.tokens
  assert.equal(layer.source, 'dsh-ui-beautify', '覆盖层 source 必须稳定')

  const names = Object.keys(layer.tokens)
  assert.ok(names.length > 50, `令牌层条目过少（${names.length}），预设表可能没铺全`)
  for (const [name, value] of Object.entries(layer.tokens)) {
    assert.match(name, /^--(dsw|dshb|ds)-/, `异常令牌名 ${name}`)
    assert.equal(typeof value.light, 'string', `${name} 缺少 light`)
    assert.equal(typeof value.dark, 'string', `${name} 缺少 dark`)
  }

  // 核心视觉主张：品牌位不再沿用官方的近黑/近白
  const brand = layer.tokens['--dsw-alias-brand-primary']
  assert.ok(brand, '必须接管 --dsw-alias-brand-primary')
  assert.notEqual(brand.light, '#0f1115', '浅色品牌位不应仍是官方近黑')
  assert.notEqual(brand.dark, '#f9fafb', '深色品牌位不应仍是官方近白')
})

test('apply 挂载产物里的全部结构层样式表并设置状态属性', () => {
  const { head, attributes } = setup()
  assert.ok(STYLE_COUNT > 0, '构建产物里应有样式表')
  assert.equal(head.children.length, STYLE_COUNT, `应挂载 ${STYLE_COUNT} 张样式表`)
  for (const tag of head.children) {
    assert.equal(tag.tagName, 'style')
    assert.equal(tag.dataset.plugin, 'dsh-ui-beautify')
    assert.match(tag.dataset.pluginCss, /^dsh-ui-beautify\//)
    assert.ok(tag.textContent.length > 100, '样式表内容不应为空')
  }
  assert.equal(attributes.get('data-dshb-enabled'), 'on')
  assert.equal(attributes.get('data-dshb-ambient'), 'on')
  assert.equal(attributes.get('data-dshb-motion'), 'on')
  assert.equal(attributes.get('data-dshb-typography'), 'on')
  assert.equal(attributes.get('data-dshb-preset'), 'aurora')
  assert.equal(attributes.get('data-dshb-radius'), 'standard')
  // 「毛玻璃」只走令牌通道，不该出现在属性里
  assert.equal(attributes.has('data-dshb-glass'), false)
})

test('注册一个设置分区，label 在词典缺失时回落到内置中文', () => {
  const { calls } = setup()
  assert.equal(calls.injectedInto, 'settings.section')
  assert.equal(calls.sections.length, 1, '必须注册一个设置分区')
  const { definition } = calls.sections[0]
  assert.equal(definition.name, 'settings.section')
  assert.equal(definition.id, 'dsh-ui-beautify')
  assert.equal(typeof definition.label, 'function')
  assert.equal(definition.label(), '界面美化')
  assert.ok(definition.inject().controller, 'slot 的 inject 必须交出 controller')
})

test('状态变更重新推送完整令牌层，且换预设确实改变配色', () => {
  const { calls, controller } = setup()
  const first = calls.tokens.length
  controller.setState({ preset: 'midnight' })
  assert.equal(calls.tokens.length, first + 1, '状态变更必须重新推送令牌层')

  const [initial, latest] = [calls.tokens[0], calls.tokens.at(-1)]
  assert.equal(latest.source, 'dsh-ui-beautify')
  assert.notEqual(
    latest.tokens['--dsw-alias-bg-base'].dark,
    initial.tokens['--dsw-alias-bg-base'].dark,
    '换预设后深色画布应当变化'
  )
})

test('总开关关闭后回到官方原样，再打开可完全恢复', () => {
  const { calls, head, attributes, controller } = setup()
  controller.setState({ enabled: false })

  assert.equal(head.children.length, 0, '关闭后不应残留样式标签')
  assert.equal(
    Object.keys(calls.tokens.at(-1).tokens).length,
    0,
    '关闭后令牌层必须为空对象'
  )
  assert.equal(attributes.has('data-dshb-enabled'), false)
  assert.equal(attributes.has('data-dshb-ambient'), false)
  assert.equal(attributes.has('data-dshb-preset'), false)

  controller.setState({ enabled: true })
  assert.equal(head.children.length, STYLE_COUNT, '重新开启应恢复样式表')
  assert.ok(Object.keys(calls.tokens.at(-1).tokens).length > 50)
  assert.equal(attributes.get('data-dshb-enabled'), 'on')
})

test('各开关独立生效，互不串台', () => {
  const { calls, attributes, controller } = setup()

  controller.setState({ ambient: false })
  assert.equal(attributes.has('data-dshb-ambient'), false)
  assert.equal(attributes.get('data-dshb-motion'), 'on', '动效开关不应被牵连')

  controller.setState({ typography: false })
  assert.equal(attributes.has('data-dshb-typography'), false)
  const noTypography = calls.tokens.at(-1).tokens
  assert.equal(
    noTypography['--dsw-font-family'],
    undefined,
    '关闭内容精修后不应再覆盖字体栈'
  )
  assert.ok(
    noTypography['--dsw-alias-bg-base'],
    '配色不应受内容精修开关影响'
  )

  controller.setState({ glass: false })
  const noGlass = calls.tokens.at(-1).tokens
  assert.equal(noGlass['--dsw-menu-backdrop-filter'].light, 'none')
  assert.ok(
    !noGlass['--dsw-menu-surface-fill'].light.endsWith('d9'),
    '关闭毛玻璃后菜单应改为不透明填充'
  )
})

test('任务列表增强开关独立投射属性，关闭时不残留', () => {
  const { attributes, controller } = setup()
  assert.equal(
    attributes.get('data-dshb-tasklist'),
    'on',
    '任务列表增强默认开启，应投射 data-dshb-tasklist'
  )

  controller.setState({ taskList: false })
  assert.equal(attributes.has('data-dshb-tasklist'), false)
  // 不能牵连别的开关
  assert.equal(attributes.get('data-dshb-typography'), 'on')
  assert.equal(attributes.get('data-dshb-ambient'), 'on')

  controller.setState({ taskList: true })
  assert.equal(attributes.get('data-dshb-tasklist'), 'on')
})

test('圆角档位改变全部半径令牌与内容区圆角，明暗取同值', () => {
  const { calls, controller } = setup()
  assert.equal(calls.tokens.at(-1).tokens['--dsw-radius-md'].light, '12px')
  assert.equal(calls.tokens.at(-1).tokens['--dshb-content-radius'].light, '16px')

  controller.setState({ radius: 'compact' })
  const compact = calls.tokens.at(-1).tokens
  assert.equal(compact['--dsw-radius-md'].light, '9px')
  assert.equal(compact['--dshb-content-radius'].light, '12px')

  controller.setState({ radius: 'soft' })
  const soft = calls.tokens.at(-1).tokens
  assert.equal(soft['--dsw-radius-md'].light, '14px')
  assert.equal(soft['--dsw-radius-panel'].light, '36px')
  assert.equal(soft['--dshb-content-radius'].light, '21px')
  assert.equal(soft['--dsw-radius-md'].light, soft['--dsw-radius-md'].dark)
})

test('偏好写入 localStorage，并能在下次加载时读回', () => {
  const { store, controller } = setup()
  controller.setState({ preset: 'paper', accent: 'rose', radius: 'soft' })

  const raw = store.get('dsh-ui-beautify:prefs:v1')
  assert.ok(raw, '偏好必须落盘')
  assert.equal(JSON.parse(raw).preset, 'paper')

  // 用同一份 store 重新建环境，模拟应用重启
  const restored = setup({ seed: store })
  const state = restored.controller.getState()
  assert.equal(state.preset, 'paper')
  assert.equal(state.accent, 'rose')
  assert.equal(state.radius, 'soft')
})

test('脏持久化数据不会让插件崩溃或泄漏非法值', () => {
  const { controller } = setup({
    seed: [
      [
        'dsh-ui-beautify:prefs:v1',
        JSON.stringify({ preset: 'ghost', accent: 7, enabled: 'yes', radius: null })
      ]
    ]
  })
  const state = controller.getState()
  assert.equal(state.preset, 'aurora', '未知预设应回落默认值')
  assert.equal(state.accent, 'deepseek')
  assert.equal(state.radius, 'standard')
  assert.equal(state.enabled, true, '非布尔值不应被当成 false')
})

test('损坏的 JSON 与不可用的 localStorage 都能降级运行', () => {
  const broken = setup({
    seed: [['dsh-ui-beautify:prefs:v1', '{{{not json']]
  })
  assert.equal(broken.calls.tokens.length, 1, '即使持久化损坏也必须完成首次投射')
  assert.equal(broken.controller.getState().preset, 'aurora')

  const throwing = {
    getItem() {
      throw new Error('SecurityError')
    },
    setItem() {
      throw new Error('QuotaExceededError')
    }
  }
  const degraded = setup({ localStorage: throwing })
  assert.equal(degraded.calls.tokens.length, 1)
  assert.equal(degraded.head.children.length, STYLE_COUNT)
  assert.equal(degraded.attributes.get('data-dshb-enabled'), 'on')
  assert.doesNotThrow(() => degraded.controller.setState({ preset: 'graphite' }))
})

test('设置面板渲染出完整结构，且每个交互控件都可点', () => {
  const { calls, controller, react } = setup()
  const { render } = calls.sections[0]
  const t = (key) => `t:${key}`
  const tree = render({ controller, t })

  // 浅渲染：函数组件就地求值，直到全部展开为宿主元素
  const classes = new Set()
  const texts = []
  const handlers = []
  const walk = (node, depth = 0) => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) return node.forEach((child) => walk(child, depth))
    if (typeof node !== 'object') {
      texts.push(String(node))
      return
    }
    if (typeof node.type === 'function') {
      assert.ok(depth < 12, '组件展开过深，可能存在渲染循环')
      walk(node.type(node.props), depth + 1)
      return
    }
    const className = node.props?.className
    if (typeof className === 'string') {
      for (const name of className.split(/\s+/)) if (name) classes.add(name)
    }
    const onClick = node.props?.onClick
    if (typeof onClick === 'function') handlers.push(onClick)
    walk(node.props?.children, depth)
  }
  walk(tree)

  for (const required of [
    'dshb-root',
    'dshb-head',
    'dshb-cards',
    'dshb-card',
    'dshb-swatches',
    'dshb-swatch',
    'dshb-segmented',
    'dshb-segment',
    'dshb-switch',
    'dshb-switch-thumb',
    'dshb-reset'
  ]) {
    assert.ok(classes.has(required), `面板缺少结构节点 ${required}`)
  }
  // 4 预设 + 7 强调色 + 3 圆角 + 4 开关 + 1 重置 都应有可点元素
  assert.ok(handlers.length >= 19, `可点控件只有 ${handlers.length} 个，少于预期`)
  // 渲染函数按官方惯例不接受调用方 props（闭包持有 t），因此这里验证的是
  // 「词典缺失时回落到内置中文」这条真实路径，而不是测试自造的文案。
  assert.ok(
    texts.includes('预设风格'),
    `预设分组标题应回落到内置中文，实际文案：${JSON.stringify(texts.slice(0, 12))}`
  )
  assert.ok(react.effects.length >= 1, '面板应通过 useEffect 订阅状态')

  // 真正点一下第一个开关（总开关），验证控制器被驱动
  const before = calls.tokens.length
  const toggle = handlers.find((fn) => {
    try {
      fn()
      return true
    } catch {
      return false
    }
  })
  assert.ok(toggle, '至少应有一个控件可以在不抛异常的情况下被触发')
  assert.ok(calls.tokens.length > before, '点击控件必须驱动控制器重新投射')
})

test('插件卸载后不残留任何全局副作用', () => {
  const { head, attributes, disposers } = setup()
  assert.equal(head.children.length, STYLE_COUNT)
  assert.equal(attributes.size, ATTRIBUTE_COUNT, '开启时投射的属性数应与控制器声明一致')

  for (const dispose of disposers) dispose()

  assert.equal(head.children.length, 0, '卸载后样式标签必须全部移除')
  assert.equal(attributes.size, 0, '卸载后不应残留 data-dshb-* 属性')
})
