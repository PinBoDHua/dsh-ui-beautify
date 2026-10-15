/**
 * 界面美化 · Lumina —— 设置面板。
 *
 * 面板本身也用宿主的 --dsw-* 令牌着色，因此它会跟随用户选中的主题一起变化，
 * 不会成为界面里唯一一块「不听话」的区域。
 *
 * 组件刻意不引入任何依赖：只用 `react` 的 createElement 与两个 hook，
 * 这样客户端 bundle 可以手写、无需构建工具链（宿主模块加载器只保证
 * react / react-dom / jsx-runtime 与 @deepseek-ai/* 这些 id 可 require）。
 */

import {
  ACCENTS,
  PRESETS,
  RADIUS_SCALES,
  accentSwatches,
  buildTokens
} from './presets.js'
import { evaluateBoth } from './readability.js'
import { VERSION } from './version.generated.js'

const h = React.createElement

/** 一行设置：左侧标题与说明，右侧控件。 */
function Row(props) {
  return h(
    'div',
    { className: 'dshb-row' },
    h(
      'div',
      { className: 'dshb-row-text' },
      h('div', { className: 'dshb-row-title' }, props.title),
      props.hint ? h('div', { className: 'dshb-row-hint' }, props.hint) : null
    ),
    h('div', { className: 'dshb-row-control' }, props.children)
  )
}

/**
 * 可读性读数。
 *
 * 这是 v1.2 新增的一行：它把「这套配色读不读得出来」从一句承诺变成面板上的数字。
 *
 * 为什么值得放一行：插件改了 110 多个宿主令牌，用户无法逐个核对；而对比度不足
 * 恰恰是最不容易被察觉的那类问题 —— 界面上没有任何东西会报错，只是字发虚。
 * 把最低的那个比值摆出来，用户至少知道「现在这套是达标的」。
 *
 * 读数覆盖**明暗两套**：插件在暗色下也生效，只报当前明暗会漏掉一半。
 *
 * @param props.state - 当前外观状态（用于算出令牌层）。
 * @param props.t - 本地化函数。
 */
function Readability(props) {
  const report = evaluateBoth(buildTokens(props.state))
  const failing = report.failures.length
  // 用**正文级**最劣项：装饰性底板（键帽 1.3、滑块 3）与说明文字档（底线 3）
  // 本来就允许更低，拿它们当读数会显示成 1.8:1 / 3.5:1，看起来像出了问题。
  const worst = report.worstBody ?? report.worst
  const ratio = worst === null ? 0 : worst.ratio
  // 面板上只给一个数字，细节放 title —— 用户想追查时能看到是哪一对不达标。
  const detail = [
    `${props.t('readabilityWorst')}: ${ratio.toFixed(2)}:1（${worst === null ? '-' : worst.label}）`,
    `${props.t('readabilityChecks')}: ${report.total}`,
    failing > 0
      ? `${props.t('readabilityFailing')}: ${failing}`
      : props.t('readabilityPass')
  ].join(' · ')
  return h(
    Row,
    { title: props.t('readability'), hint: props.t('readabilityHint') },
    h(
      'span',
      {
        className: failing > 0 ? 'dshb-metric dshb-metric-bad' : 'dshb-metric',
        title: detail
      },
      h('span', { className: 'dshb-metric-value' }, `${ratio.toFixed(1)}:1`),
      h(
        'span',
        { className: 'dshb-metric-tag' },
        failing > 0 ? props.t('readabilityFailing') : props.t('readabilityPass')
      )
    )
  )
}

/** 与宿主开关同形的开关：role=switch + aria-checked，键盘可达。 */
function Switch(props) {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': props.checked,
      className: 'dshb-switch',
      disabled: props.disabled,
      onClick: () => props.onChange(!props.checked)
    },
    h('span', { className: 'dshb-switch-thumb' })
  )
}

/** 分段选择器。 */
function Segmented(props) {
  return h(
    'div',
    { className: 'dshb-segmented', role: 'radiogroup', 'aria-label': props.label },
    props.options.map((option) =>
      h(
        'button',
        {
          key: option.id,
          type: 'button',
          role: 'radio',
          'aria-checked': option.id === props.value,
          className:
            option.id === props.value
              ? 'dshb-segment dshb-segment-active'
              : 'dshb-segment',
          disabled: props.disabled,
          onClick: () => props.onChange(option.id)
        },
        option.name
      )
    )
  )
}

/** 预设卡片：三色样张 + 名称 + 一句话气质。 */
function PresetCard(props) {
  const { preset, active, disabled, onSelect } = props
  return h(
    'button',
    {
      type: 'button',
      role: 'radio',
      'aria-checked': active,
      className: active ? 'dshb-card dshb-card-active' : 'dshb-card',
      disabled,
      onClick: () => onSelect(preset.id)
    },
    h(
      'span',
      { className: 'dshb-card-dots' },
      preset.swatch.map((color, index) =>
        h('span', {
          key: index,
          className: 'dshb-card-dot',
          style: { backgroundColor: color }
        })
      )
    ),
    h('span', { className: 'dshb-card-name' }, preset.name),
    h('span', { className: 'dshb-card-tagline' }, preset.tagline)
  )
}

/**
 * 面板根组件。
 *
 * @param props.controller - 由 index.js 注入的外观控制器（唯一状态宿主）。
 * @param props.t - 本地化函数。
 */
export function BeautifyPanel(props) {
  const controller = props.controller
  const t = props.t
  const [state, setState] = React.useState(() => controller.getState())

  React.useEffect(() => controller.subscribe(setState), [controller])

  const disabled = !state.enabled
  const update = (patch) => controller.setState(patch)
  // 求解依赖当前预设，因此换预设时色板跟着更新；求解结果有缓存，代价可忽略。
  const swatches = accentSwatches(state.preset)

  return h(
    'div',
    { className: 'dshb-root' },
    h(
      'header',
      { className: 'dshb-head' },
      h(
        'div',
        null,
        h('h2', { className: 'dshb-title' }, t('title')),
        h('p', { className: 'dshb-subtitle' }, t('subtitle'))
      ),
      h(Switch, {
        checked: state.enabled,
        onChange: (value) => update({ enabled: value })
      })
    ),

    h(
      'section',
      { className: disabled ? 'dshb-body dshb-body-off' : 'dshb-body' },

      h(
        'div',
        { className: 'dshb-group' },
        h('div', { className: 'dshb-group-title' }, t('preset')),
        h(
          'div',
          {
            className: 'dshb-cards',
            role: 'radiogroup',
            'aria-label': t('preset')
          },
          PRESETS.map((preset) =>
            h(PresetCard, {
              key: preset.id,
              preset,
              active: preset.id === state.preset,
              disabled,
              onSelect: (id) => update({ preset: id })
            })
          )
        )
      ),

      h(
        Row,
        { title: t('accent'), hint: t('accentHint') },
        h(
          'div',
          { className: 'dshb-swatches', role: 'radiogroup', 'aria-label': t('accent') },
          // 色板画的是**求解后**的值，不是配色表里的原始值 —— 见 accentSwatches 的说明。
          // 求解依赖预设（要对预设的表面色达标），因此换预设时色板也会跟着微调。
          ACCENTS.map((accent) =>
            h('button', {
              key: accent.id,
              type: 'button',
              role: 'radio',
              'aria-checked': accent.id === state.accent,
              'aria-label': accent.name,
              title: accent.name,
              disabled,
              className:
                accent.id === state.accent
                  ? 'dshb-swatch dshb-swatch-active'
                  : 'dshb-swatch',
              style: {
                '--dshb-swatch-light': swatches[accent.id].light,
                '--dshb-swatch-dark': swatches[accent.id].dark
              },
              onClick: () => update({ accent: accent.id })
            })
          )
        )
      ),

      h(
        Row,
        { title: t('radius'), hint: t('radiusHint') },
        h(Segmented, {
          label: t('radius'),
          value: state.radius,
          disabled,
          options: RADIUS_SCALES,
          onChange: (id) => update({ radius: id })
        })
      ),

      h(Readability, { state, t }),

      h(
        Row,
        { title: t('ambient'), hint: t('ambientHint') },
        h(Switch, {
          checked: state.ambient,
          disabled,
          onChange: (value) => update({ ambient: value })
        })
      ),

      h(
        Row,
        { title: t('typography'), hint: t('typographyHint') },
        h(Switch, {
          checked: state.typography,
          disabled,
          onChange: (value) => update({ typography: value })
        })
      ),

      h(
        Row,
        { title: t('taskList'), hint: t('taskListHint') },
        h(Switch, {
          checked: state.taskList,
          disabled,
          onChange: (value) => update({ taskList: value })
        })
      ),

      h(
        Row,
        { title: t('glass'), hint: t('glassHint') },
        h(Switch, {
          checked: state.glass,
          disabled,
          onChange: (value) => update({ glass: value })
        })
      ),

      h(
        Row,
        { title: t('motion'), hint: t('motionHint') },
        h(Switch, {
          checked: state.motion,
          disabled,
          onChange: (value) => update({ motion: value })
        })
      )
    ),

    h(
      'footer',
      { className: 'dshb-foot' },
      h(
        'span',
        { className: 'dshb-foot-note' },
        t('footer'),
        h('span', { className: 'dshb-version' }, `v${VERSION}`)
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'dshb-reset',
          onClick: () => controller.reset()
        },
        t('reset')
      )
    )
  )
}
