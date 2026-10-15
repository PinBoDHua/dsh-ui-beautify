/**
 * 界面美化 · Lumina —— 客户端插件入口。
 *
 * 本文件是 bundle 的入口，构建脚本（scripts/build.mjs）会把它与同目录下的
 * 模块拼成一个 `window.__ModuleLoader__.load({ id, factory })` 的经典脚本。
 * 之所以手写而不是用 tsdown/rolldown：宿主模块加载器只保证 `react`、
 * `react-dom`、`react/jsx-runtime` 与 `@deepseek-ai/*` 可 require，插件自身的
 * 代码不依赖任何第三方包，因此一套零依赖的拼接式构建就够，且产物可逐行审阅。
 */

import { createController } from './controller.js'
import { BeautifyPanel } from './panel.js'
import { en, zh } from './locales.js'

/** 插件 id，必须与 package.json 的 name 一致 —— 加载器用它做模块登记。 */
const NS = 'dsh-ui-beautify'

export const name = NS

/**
 * 依赖的客户端服务。
 * - `theme`：唯一的外观写入通道（overrideTokens）。
 * - `slots`：把设置面板挂进「设置」分区。
 * - `locale`：中英文案。
 */
export const inject = ['theme', 'slots', 'locale']

/**
 * 组装一个不会抛错的本地化函数。
 *
 * 面板的渲染不能被文案层拖垮：字典缺失、命名空间拼错、locale 服务尚未就绪，
 * 都应当退化成显示 key 而不是让整个设置页白屏。
 *
 * @param ctx - 客户端 cordis 上下文。
 * @returns (key: string) => string
 */
function localized(ctx) {
  let bound
  try {
    bound = ctx.locale.bind(NS)
  } catch {
    bound = undefined
  }
  return (key) => {
    if (typeof bound === 'function') {
      try {
        const value = bound(key)
        if (typeof value === 'string' && value.length > 0) return value
      } catch {
        /* 落到内置中文兜底 */
      }
    }
    return zh[key] ?? key
  }
}

/**
 * 客户端插件体。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx) {
  const controller = createController({ theme: ctx.theme })
  const t = localized(ctx)

  // 外观层：首次投射 + 卸载时把令牌、属性、样式标签全部撤回。
  ctx.effect(() => controller.mount(), `${NS}: 外观层`)

  // 词典：两套语言键集一致。
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: 词典`)

  // 设置面板：挂进「设置」分区，排在社区插件市场之后。
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: NS,
        order: 70,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ controller })
      },
      () => React.createElement(BeautifyPanel, { controller, t })
    )
  )
}
