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
 * 可读性契约与颜色数学。
 *
 * 测试直接引用源码模块（而不是 bundle），因为要断言的是**求解与评估**这两件
 * 纯计算的行为；bundle 只负责把它们送进宿主。下面另有一条测试把这套契约
 * 跑在「控制器真正投射出去的那一层」上，覆盖集成路径。
 */
const { evaluate, evaluateBoth, TEXT_TIERS } = await import(
  new URL('../src/client/readability.js', import.meta.url).href
)
const { ACCENTS, PRESETS, buildTokens } = await import(
  new URL('../src/client/presets.js', import.meta.url).href
)
const {
  contrast,
  ensureContrast,
  solveColor,
  solveTone,
  tint,
  toHsl
} = await import(new URL('../src/client/color.js', import.meta.url).href)

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
          // 宿主真实契约：返回值是**唯一**的删层入口。替身照此实现，
          // 否则「卸载有没有把层交还回去」这件事根本观察不到。
          const entry = { source, tokens, retracted: false }
          calls.tokens.push(entry)
          return () => {
            entry.retracted = true
          }
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
  // `globals` 用来把宿主环境里才有的东西（例如 requestAnimationFrame）注入 bundle
  // 所在的 vm 沙箱 —— 沙箱里的 globalThis 与测试进程的不是同一个，
  // 直接改外层的 globalThis 是看不见的（这一条踩过）。
  const { exports, react } = loadPlugin({
    document,
    localStorage,
    ...(options.globals ?? {})
  })
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
    // 允许的命名空间：宿主别名/静态令牌（dsw）、插件自有原语（dshb）、
    // 宿主排版量（ds）、以及代码着色（shiki）。
    assert.match(name, /^--(dsw|dshb|ds|shiki)-/, `异常令牌名 ${name}`)
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
  // 4 预设 + 7 强调色 + 3 圆角 + 3 圆角形状 + 6 开关 + 1 重置 都应有可点元素。
  // 这个数字是**精确**的：v1.2 写的是 `>= 19` 而当时实际已有 21 个，
  // 于是新增控件永远不会让它失败 —— 一条只贡献数字的断言。
  // 现在按控件清单算：4 + 7 + 3 + 3 + 6 + 1 = 24，少一个就说明某个分组没渲染出来。
  assert.equal(
    handlers.length,
    24,
    `可点控件应有 24 个（4 预设 + 7 强调色 + 3 圆角 + 3 圆角形状 + 6 开关 + 1 重置），实际 ${handlers.length}`
  )
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

// ------------------------------------------------- v1.2 求解器与可读性契约

test('颜色求解器：已达标原样返回，不达标才移动明度', () => {
  // 「不达标才动」是求解器的核心承诺：达标的颜色不该被无谓改写，
  // 否则每次改预设都会连带改动一大批本来就合格的取值。
  assert.equal(ensureContrast('#000000', '#ffffff', 4.5), '#000000')
  assert.equal(ensureContrast('#3f6fe0', '#ffffff', 4.0), '#3f6fe0')

  // 不达标时必须真的被调整，并且达标 —— 不是「差一点」的近似值
  const raised = ensureContrast('#0d8f85', '#ffffff', 4.5)
  assert.notEqual(raised, '#0d8f85')
  assert.ok(
    contrast(raised, '#ffffff') >= 4.5,
    `求解后仍不达标：${raised} → ${contrast(raised, '#ffffff').toFixed(2)}`
  )

  // 色相必须保持：用户选的是碧波青，求解后还得是碧波青
  const delta = Math.abs(toHsl('#0d8f85').h - toHsl(raised).h)
  assert.ok(Math.min(delta, 360 - delta) <= 1, '求解不应改变色相')
})

test('颜色求解器：方向冲突时返回 null，而不是一个不达标的颜色', () => {
  // 同时要求「压住纯白」与「压住纯黑」是矛盾的：任何颜色都不可能对两端都达到 4.5。
  // 这种时候返回 null，让调用方（与构建期断言）去处理，比悄悄给个差一点的值安全。
  assert.equal(
    solveColor('#808080', [
      { against: '#ffffff', target: 4.5 },
      { against: '#000000', target: 4.5 }
    ]),
    null
  )
  // 同向的多约束应当有解
  const solved = solveColor('#808080', [
    { against: '#ffffff', target: 4.5 },
    { against: '#f6f8fc', target: 4.5 }
  ])
  assert.ok(solved !== null && contrast(solved, '#ffffff') >= 4.5)
})

test('输入框占位文字是正文而不是描边（v1.2 复核补上的缺口）', () => {
  // 宿主唯一的消费者是 `.input::placeholder { color: var(--dsw-alias-label-dimmed) }`，
  // 字号 14px。v1.1 把这个令牌绑在描边色上，实测只有 1.48–2.00:1 —— 每种组合里
  // 占位文字都近乎看不见，而当时的契约完全没有覆盖它（41 条配对里没有这一条）。
  for (const preset of PRESETS) {
    for (const accent of ACCENTS) {
      const tokens = buildTokens({
        enabled: true,
        preset: preset.id,
        accent: accent.id,
        radius: 'standard',
        ambient: true,
        motion: true,
        typography: true,
        glass: true
      })
      for (const mode of ['light', 'dark']) {
        const ratio = contrast(
          tokens['--dsw-alias-label-dimmed'][mode],
          tokens['--dsw-specific-input-major'][mode]
        )
        assert.ok(
          ratio >= 4.5,
          `${preset.id}/${accent.id}/${mode} 占位文字只有 ${ratio.toFixed(2)}`
        )
      }
      // 它不该再与描边同值 —— 那正是缺陷的形态
      for (const mode of ['light', 'dark']) {
        for (const border of ['--dsw-alias-border-l3', '--dsw-alias-border-l4']) {
          assert.notEqual(
            tokens['--dsw-alias-label-dimmed'][mode],
            tokens[border][mode],
            `${preset.id}/${mode} 占位文字又和 ${border} 变成同一个值了`
          )
        }
      }
    }
  }
})

test('快捷键键帽与气泡底可分辨（阈值不是形同虚设）', () => {
  // 阈值原本写 1.3，实测从未低于 1.7 —— 不可能独立失败，等于没有约束。
  // 收紧到官方水平 2.0 之后才暴露出：v1.1 的固定 18% 白混只有 1.75，比官方还难分辨。
  for (const preset of PRESETS) {
    const tokens = buildTokens({
      enabled: true,
      preset: preset.id,
      accent: 'deepseek',
      radius: 'standard',
      ambient: true,
      motion: true,
      typography: true,
      glass: true
    })
    for (const mode of ['light', 'dark']) {
      const key = tokens['--dsw-alias-tooltip-key-bg'][mode]
      const bubble = tokens['--dsw-alias-tooltip-bg'][mode]
      const legibility = contrast(key, bubble)
      assert.ok(
        legibility >= 2,
        `${preset.id}/${mode} 键帽与气泡底只差 ${legibility.toFixed(3)}（要求 ≥2）`
      )
      // 键帽上的白字仍然要达标 —— 抬高底板不能把文字赔进去
      assert.ok(
        contrast('#ffffff', key) >= 4.5,
        `${preset.id}/${mode} 键帽上的白字只有 ${contrast('#ffffff', key).toFixed(2)}`
      )
    }
  }
})

test('无法解析的颜色会让对比度变成 0，而不是伪装成满分', () => {
  // luminance 对垃圾输入的兜底是 0（按最暗处理），若 contrast 直接用这个兜底，
  // `contrast('oops', '#ffffff')` 会得到 21:1 —— 一个拼错的令牌名拿到「满分」。
  // 这正是本模块最该避免的静默失效，因此 contrast 必须显式返回 0。
  assert.equal(contrast('oops', '#ffffff'), 0)
  assert.equal(contrast('#ffffff', 'oops'), 0)
  assert.equal(contrast('', '#ffffff'), 0)
  assert.equal(contrast(undefined, '#ffffff'), 0)
  // 正常输入不受影响
  assert.ok(contrast('#000000', '#ffffff') > 20)
})

test('多约束求解：解出的颜色对**每一个**背景都达标', () => {
  const backgrounds = ['#ffffff', '#f6f8fc', '#eef2f9', '#f3f6fb']
  const solved = solveTone('#3f6fe0', backgrounds, 4.5)
  for (const background of backgrounds) {
    assert.ok(
      contrast(solved, background) >= 4.5,
      `${solved} 对 ${background} 只有 ${contrast(solved, background).toFixed(2)}`
    )
  }
})

test('每个预设 × 强调色 × 明暗都满足可读性契约', () => {
  // 这条测试与 check.mjs 的构建期断言**同源但不同层**：check 跑在
  // buildTokens() 的返回值上，这里跑在同一份契约上确认结果稳定可达。
  // 两者都保留，是因为 check 只在开发时跑，而 user 装的是 bundle。
  let checks = 0
  for (const preset of PRESETS) {
    for (const accent of ACCENTS) {
      const tokens = buildTokens({
        enabled: true,
        preset: preset.id,
        accent: accent.id,
        radius: 'standard',
        ambient: true,
        motion: true,
        typography: true,
        glass: true
      })
      const report = evaluateBoth(tokens)
      checks += report.total
      const detail = report.failures
        .map((f) => `${f.id} ${f.ratio.toFixed(2)}<${f.min}`)
        .join(', ')
      assert.equal(
        report.failures.length,
        0,
        `${preset.id}/${accent.id} 有未达标项：${detail}`
      )
      assert.equal(
        report.missing.length,
        0,
        `${preset.id}/${accent.id} 有取不到值的配对`
      )
      // 这里原本是 `report.worst.ratio >= 1.3` —— 一条**永远不可能失败**的断言：
      // 契约里最松的阈值是 2（`tooltip-key-legibility`），任何低于 1.3 的值
      // 必然先让上面的 `failures.length === 0` 炸掉。它只贡献了一个数字。
      // 换成一条真的可能失败的：读数必须是**真的最小值** ——
      // 面板上那句「最低 x:1」就是照它显示的，取错一项就会骗人。
      const scored = [...report.light.checks, ...report.dark.checks].filter(
        (entry) => entry.ratio !== null
      )
      const trueWorst = scored.reduce(
        (low, entry) => (entry.ratio < low.ratio ? entry : low)
      )
      assert.equal(
        report.worst.id,
        trueWorst.id,
        `worst 读数取错了项：报的是 ${report.worst.id}，真正最低的是 ${trueWorst.id}`
      )
      const bodyWorst = scored
        .filter((entry) => entry.kind === 'text' && entry.min >= 4.5)
        .reduce((low, entry) => (entry.ratio < low.ratio ? entry : low))
      assert.equal(
        report.worstBody.id,
        bodyWorst.id,
        `正文级 worstBody 取错了项：报的是 ${report.worstBody.id}，真正最低的是 ${bodyWorst.id}`
      )
    }
  }
  assert.ok(checks > 2000, `契约断言次数过少（${checks}），检查项可能没跑全`)
})

test('契约跑在控制器真正投射的那一层上', () => {
  // 前面的测试跑在 buildTokens() 上；这一条跑在**实际推给宿主的那一份**上，
  // 覆盖「预设表算对了，但投射时被改名/丢失」这类集成缺陷。
  const { calls, controller } = setup()
  const latest = calls.tokens.at(-1).tokens
  const report = evaluateBoth(latest)
  assert.equal(report.failures.length, 0, '投射出去的令牌层必须满足可读性契约')
  assert.equal(report.missing.length, 0)

  // 换一个强调色（原本不达标的那一个）后依然成立
  controller.setState({ accent: 'teal' })
  const afterSwitch = evaluateBoth(calls.tokens.at(-1).tokens)
  assert.equal(afterSwitch.failures.length, 0, '切换强调色后契约仍须成立')

  // 再换预设
  controller.setState({ preset: 'paper' })
  assert.equal(evaluateBoth(calls.tokens.at(-1).tokens).failures.length, 0)
})

test('徽标底不再是强调色本体（v1.2 修掉的「同色压同色」）', () => {
  // 宿主把 `--dsw-specific-sidebar-nav-item-active-accent` 当徽标底色，
  // 而徽标文字是 `--dsw-alias-button-info-fill`。v1.1 把两者都设成完整强调色，
  // 对比度 1.00 —— 字完全消失。这里把那条回归钉住。
  for (const preset of PRESETS) {
    for (const accent of ACCENTS) {
      const tokens = buildTokens({
        enabled: true,
        preset: preset.id,
        accent: accent.id,
        radius: 'standard',
        ambient: true,
        motion: true,
        typography: true,
        glass: true
      })
      for (const mode of ['light', 'dark']) {
        const badgeBackground = tokens['--dsw-specific-sidebar-nav-item-active-accent'][mode]
        const badgeText = tokens['--dsw-alias-button-info-fill'][mode]
        assert.notEqual(
          badgeBackground,
          badgeText,
          `${preset.id}/${accent.id}/${mode} 徽标底与文字又变成同色了`
        )
      }
    }
  }
})

test('文字阶梯严格递减，且各级都不低于自己的目标', () => {
  const order = ['primary', 'dimmed', 'secondary', 'tertiary', 'caption']
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(
      TEXT_TIERS[order[i - 1]] > TEXT_TIERS[order[i]],
      `阶梯 ${order[i - 1]} 应严格高于 ${order[i]}`
    )
  }
  const tokens = buildTokens({
    enabled: true,
    preset: 'graphite',
    accent: 'deepseek',
    radius: 'standard',
    ambient: true,
    motion: true,
    typography: true,
    glass: true
  })
  // 石墨预设是 v1.1 里三级/说明文字最差的一档（3.65 / 2.50），专门盯它。
  const surface = tokens['--dsw-alias-bg-layer-1'].light
  const tertiary = contrast(tokens['--dsw-alias-label-tertiary'].light, surface)
  const caption = contrast(tokens['--dsw-alias-label-caption'].light, surface)
  assert.ok(tertiary >= TEXT_TIERS.tertiary, `三级文字 ${tertiary.toFixed(2)} 未达标`)
  assert.ok(caption >= TEXT_TIERS.caption, `说明文字 ${caption.toFixed(2)} 未达标`)
  assert.ok(tertiary > caption, '三级文字必须比说明文字更清楚')
})

test('语法着色接管了宿主的九个 token，并且每个都在代码底上达标', () => {
  const names = ['constant', 'string', 'comment', 'keyword', 'parameter', 'function', 'string-expression', 'punctuation', 'link']
  for (const preset of PRESETS) {
    const tokens = buildTokens({
      enabled: true,
      preset: preset.id,
      accent: 'deepseek',
      radius: 'standard',
      ambient: true,
      motion: true,
      typography: true,
      glass: true
    })
    for (const mode of ['light', 'dark']) {
      const background = tokens['--dsw-alias-markdown-code-block'][mode]
      for (const name of names) {
        const value = tokens[`--shiki-token-${name}`]
        assert.ok(value, `${preset.id} 缺少 --shiki-token-${name}`)
        const ratio = contrast(value[mode], background)
        assert.ok(
          ratio >= 4.5,
          `${preset.id}/${mode} 语法色 ${name} 只有 ${ratio.toFixed(2)}（${value[mode]} on ${background}）`
        )
      }
    }
  }
})

test('语法色保持色相：只在明度轴上移动', () => {
  const seeds = { comment: '#868e96', keyword: '#d6336c', string: '#2f9e44' }
  const tokens = buildTokens({
    enabled: true,
    preset: 'paper',
    accent: 'deepseek',
    radius: 'standard',
    ambient: true,
    motion: true,
    typography: true,
    glass: true
  })
  for (const [name, seed] of Object.entries(seeds)) {
    const solved = tokens[`--shiki-token-${name}`].light
    const source = toHsl(seed)
    const result = toHsl(solved)
    if (source.s < 0.15) {
      // 近灰色的色相在数值上不稳定（几个色阶的差就能让 h 转一大圈），
      // 对它们要断言的是「仍然是一支灰」而不是「色相没变」。
      // 注释色 #868e96 正是这种情况（饱和度约 0.04）。
      assert.ok(
        result.s < 0.2,
        `${name} 本是一支近灰色（s=${source.s.toFixed(3)}），求解后却有了色相（s=${result.s.toFixed(3)}）`
      )
      continue
    }
    const delta = Math.abs(source.h - result.h)
    assert.ok(
      Math.min(delta, 360 - delta) <= 1,
      `${name} 求解后色相偏移过大：${seed} → ${solved}`
    )
  }
})

test('面板渲染出可读性读数，且读数与契约一致', () => {
  const { calls, controller } = setup()
  const { render } = calls.sections[0]
  const tree = render({ controller, t: (key) => `t:${key}` })

  const texts = []
  const classes = new Set()
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node !== 'object') {
      texts.push(String(node))
      return
    }
    if (typeof node.type === 'function') return walk(node.type(node.props))
    const className = node.props?.className
    if (typeof className === 'string') {
      for (const name of className.split(/\s+/)) if (name) classes.add(name)
    }
    walk(node.props?.children)
  }
  walk(tree)

  assert.ok(classes.has('dshb-metric'), '面板应渲染可读性读数（dshb-metric）')
  assert.ok(classes.has('dshb-metric-value'), '读数应包含数值节点')
  assert.ok(
    texts.some((text) => /^\d+\.\d+:1$/.test(text)),
    `读数应显示形如 4.5:1 的比值，实际：${JSON.stringify(texts.filter((t) => t.includes(':1')))}`
  )
  // 默认预设组合必须达标，因此不应出现「未达标」状态
  assert.ok(!classes.has('dshb-metric-bad'), '默认组合不应处于未达标状态')
})

// ============================================================ v1.3 新增

test('圆角形状独立投射，并与宿主默认档对齐', async () => {
  const presets = await import(
    new URL('../src/client/presets.js', import.meta.url).href
  )
  const { CORNER_SHAPES } = presets
  const { calls, controller } = setup()

  // 跨 realm 比较：bundle 跑在 vm 沙箱里，它产出的对象原型与测试进程的不是同一个，
  // `deepStrictEqual` 会因此失败（值明明一样）。逐字段比较才是这里该做的事。
  const cornerOf = () => calls.tokens.at(-1).tokens['--dsw-corner-shape']
  const initial = cornerOf()
  assert.equal(initial.light, 'superellipse(1.5)')
  assert.equal(initial.dark, 'superellipse(1.5)')
  // 明暗取同值：形状不是颜色，不该随主题变
  for (const shape of CORNER_SHAPES) {
    controller.setState({ corner: shape.id })
    const value = cornerOf()
    assert.equal(value.light, shape.css, `${shape.id} 未投射到 light`)
    assert.equal(value.dark, shape.css, `${shape.id} 未投射到 dark`)
  }
  // 非法档位被归一化挡掉，不会写进令牌层
  controller.setState({ corner: 'not-a-shape' })
  assert.equal(cornerOf().light, 'superellipse(1.5)', '非法圆角形状必须回落到默认档')

  // 形状只动这一个令牌：切档不得顺手改掉半径
  const before = calls.tokens.at(-1).tokens
  controller.setState({ corner: 'round' })
  const after = calls.tokens.at(-1).tokens
  const changed = Object.keys(after).filter(
    (name) => JSON.stringify(after[name]) !== JSON.stringify(before[name])
  )
  assert.deepEqual(changed, ['--dsw-corner-shape'], `切圆角形状只应改一个令牌，实际改了 ${changed}`)
})

test('卸载会把令牌层交还宿主，而不只是清掉样式与属性', () => {
  // v1.2 丢弃了 `theme.overrideTokens()` 的返回值，而宿主**只**通过那个函数删层。
  // 结果是卸载之后样式标签与属性都没了，配色却还留在宿主的主题服务里 ——
  // README 里「卸载零残留」这半句话不成立。
  const { calls, disposers, attributes } = setup()
  const layer = calls.tokens.at(-1)
  assert.equal(layer.retracted, false, '挂载期间令牌层应当是生效的')

  for (const dispose of disposers) dispose()

  assert.equal(layer.retracted, true, '卸载必须调用宿主返回的撤回函数，把令牌层删掉')
  assert.equal(attributes.size, 0, '卸载后不应残留 data-dshb-* 属性')

  // 卸载之后再改状态：既不该再投射令牌，也不该再写属性
  const projections = calls.tokens.length
  const controller = calls.sections[0]?.definition.inject().controller
  controller.setState({ accent: 'teal' })
  assert.equal(calls.tokens.length, projections, '卸载后不得再向宿主投射令牌')
  assert.equal(attributes.size, 0, '卸载后不得再写回属性')
})

test('卸载之后，排队中的首帧回调不会把属性写回去', () => {
  // 首帧回调排在 rAF 队列里，HMR 在同一个 tick 内卸载并重载 —— 或者窗口不可见时
  // rAF 被无限期推迟。v1.2 没有取消它，也没有 disposed 标志，于是回调执行时
  // 把 7 个 data-dshb-* 属性重新写到 <html> 上，而那些属性是插件的公开接口，
  // 没有任何东西会再清掉它们。测试替身此前**没有** requestAnimationFrame，
  // 因此永远走同步分支，这条路径从未被测到。
  const queued = []
  const cancelled = []
  const { attributes, disposers } = setup({
    globals: {
      requestAnimationFrame: (fn) => {
        queued.push(fn)
        return queued.length
      },
      cancelAnimationFrame: (id) => cancelled.push(id)
    }
  })
  assert.equal(queued.length, 1, '首帧回调应恰好排队一次')
  assert.equal(
    attributes.has('data-dshb-motion'),
    false,
    '首帧之前不应投射动效属性（否则「换装」会被渲染成一段可见的淡入）'
  )
  for (const dispose of disposers) dispose()
  assert.equal(attributes.size, 0, '卸载时应清空全部属性')
  assert.equal(cancelled.length, 1, '卸载时应取消排队中的那一帧')
  // 即使那一帧还是跑了（取消没生效、或回调正在执行中），它也必须什么都不做
  for (const fn of queued) fn()
  assert.equal(
    attributes.size,
    0,
    `卸载后执行排队中的回调不得写回属性，实际残留：${[...attributes.keys()].join(', ')}`
  )
})

test('求解器对中间调背景不再走进方向死区', () => {
  // v1.2 用 `luminance(against) > 0.4` 决定压暗还是提亮。背景亮度落在
  // (0.183, 0.4] 之间时它会选「提亮」，而提亮最多到 1.05/(L+0.05) ——
  // 对 #a8a8a8 只有 2.42，永远够不到 4.5；同一时刻压暗能到 8.83。
  // 于是求解器对一个**有解**的约束返回 null。
  const solved = solveColor('#808080', [{ against: '#a8a8a8', target: 4.5 }])
  assert.notEqual(solved, null, '中间调背景有解，不该返回 null')
  assert.ok(
    contrast(solved, '#a8a8a8') >= 4.5,
    `解出的 ${solved} 对 #a8a8a8 只有 ${contrast(solved, '#a8a8a8').toFixed(2)}`
  )
  // 真正无解的仍然必须是 null：两端都够不着目标
  assert.equal(solveColor('#808080', [{ against: '#a8a8a8', target: 9 }]), null)
  // 方向冲突仍然必须是 null
  assert.equal(
    solveColor('#808080', [
      { against: '#ffffff', target: 4.5 },
      { against: '#000000', target: 4.5 }
    ]),
    null
  )
})

test('语义色取代了宿主那三个「读不清的语气」，且色相没被换掉', async () => {
  const { calls, controller } = setup()
  // 宿主 Tag 的成功 / 警告 / 危险语气：底是自身 10%（警告 12%）的淡染层。
  const hostSeeds = { success: '#22c55e', warn: '#f59e0b', error: '#ec1313' }
  for (const mode of ['light', 'dark']) {
    for (const [key, seed] of Object.entries(hostSeeds)) {
      const tokens = calls.tokens.at(-1).tokens
      const value = tokens[`--dsw-alias-state-${key}-primary`][mode]
      const layer = tint(tokens['--dsw-alias-bg-layer-1'][mode], value, key === 'warn' ? 0.12 : 0.1)
      const ratio = contrast(value, layer)
      assert.ok(
        ratio >= 4.5,
        `${key}(${mode}) 压在自己的淡染层上只有 ${ratio.toFixed(2)}：${value} on ${layer}`
      )
      // 色相必须留在约定色域里：绿还是绿、琥珀还是琥珀、红还是红
      const hue = toHsl(value).h
      const ok =
        key === 'success'
          ? hue >= 80 && hue <= 180
          : key === 'warn'
            ? hue >= 20 && hue <= 70
            : hue >= 330 || hue <= 25
      assert.ok(ok, `${key} 解出了 ${value}（色相 ${hue.toFixed(0)}°），跑出了约定色域`)
      // 必须真的与宿主种子不同 —— 否则说明求解器什么都没做（宿主那支是不达标的）
      if (mode === 'light') {
        assert.notEqual(value, seed, `浅色下 ${key} 应与宿主种子不同（宿主的取值不达标）`)
      }
    }
  }
  // 危险色当底色时（.brokenBadge）要扛得住一支表面色作为文字
  const tokens = calls.tokens.at(-1).tokens
  for (const mode of ['light', 'dark']) {
    const ratio = contrast(
      tokens['--dsw-alias-bg-layer-3'][mode],
      tokens['--dsw-alias-state-error-primary'][mode]
    )
    assert.ok(ratio >= 4.5, `危险徽标文字(${mode}) 只有 ${ratio.toFixed(2)}`)
  }
  void controller
})

test('宿主缺失的两个令牌被补上（错误提示与第四级表面）', () => {
  // 这两个令牌宿主从未声明，却有组件在消费：
  //   · --dsw-alias-label-error → `color: var(…)` 变成 guaranteed-invalid，
  //     color 按 unset 处理（继承），「保存失败」看起来和普通文字一样；
  //   · --dsw-alias-bg-layer-4  → 悬停底色落到 initial（transparent）。
  const { calls } = setup()
  const tokens = calls.tokens.at(-1).tokens
  for (const token of ['--dsw-alias-label-error', '--dsw-alias-bg-layer-4']) {
    assert.ok(tokens[token], `${token} 必须被补上`)
    assert.equal(typeof tokens[token].light, 'string')
    assert.equal(typeof tokens[token].dark, 'string')
  }
  // 补的值必须真的可用：错误文字要压在设置卡片（bg-layer-2）上达 AA
  for (const mode of ['light', 'dark']) {
    const ratio = contrast(tokens['--dsw-alias-label-error'][mode], tokens['--dsw-alias-bg-layer-2'][mode])
    assert.ok(ratio >= 4.5, `错误提示文字(${mode}) 只有 ${ratio.toFixed(2)}`)
    // 第四级表面必须与第二级可分辨 —— 它就是「悬停时那一点可见的差」
    const wash = contrast(tokens['--dsw-alias-bg-layer-4'][mode], tokens['--dsw-alias-bg-layer-2'][mode])
    assert.ok(wash > 1.02, `bg-layer-4 与 bg-layer-2 只差 ${wash.toFixed(3)}，悬停看不出来`)
  }
})

test('悬停淡染层之上的文字也不掉出档位', async () => {
  // 宿主动辄把 `--dsw-alias-interactive-bg-hover` 铺在文字底下（Menu 的 .item:hover，
  // 同一行里还有 11px 的快捷键文字）。深色模式下强调色是亮色，12% 罩层把深底提亮，
  // 于是同一段灰字的有效底变亮 —— v1.2 的契约只认平面表面，这类底从未被算过。
  const presets = await import(
    new URL('../src/client/presets.js', import.meta.url).href
  )
  const washes = { light: [0.08, 0.14], dark: [0.12, 0.2] }
  const tiers = [
    ['--dsw-alias-label-secondary', TEXT_TIERS.secondary],
    ['--dsw-alias-label-tertiary', TEXT_TIERS.tertiary],
    ['--dsw-alias-label-caption', TEXT_TIERS.caption]
  ]
  let worst = { ratio: Infinity, where: '' }
  for (const preset of PRESETS) {
    for (const accent of presets.ACCENTS) {
      const tokens = buildTokens({
        preset: preset.id,
        accent: accent.id,
        radius: 'standard',
        corner: 'squircle',
        ambient: true,
        motion: true,
        typography: true,
        taskList: true,
        glass: true
      })
      for (const mode of ['light', 'dark']) {
        for (const surface of ['--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2']) {
          for (const amount of washes[mode]) {
            const hovered = tint(tokens[surface][mode], tokens['--dsw-alias-brand-primary'][mode], amount)
            for (const [token, target] of tiers) {
              const ratio = contrast(tokens[token][mode], hovered)
              if (ratio < worst.ratio) {
                worst = { ratio, where: `${preset.id}/${accent.id}/${mode} ${token} on ${hovered}` }
              }
              assert.ok(
                ratio >= target,
                `${worst.where}：${ratio.toFixed(2)} < ${target}`
              )
            }
          }
        }
      }
    }
  }
  assert.ok(worst.ratio >= 3, `悬停底上的文字最低 ${worst.ratio.toFixed(2)}`)
})
