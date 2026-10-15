/**
 * 界面美化 · Lumina —— 宿主侧入口。
 *
 * 本插件的全部改造都发生在浏览器侧（`client/client.js`，由 package.json 的
 * `dsh.client` 声明加载）。宿主侧不需要服务、路由或配置面，因此这里只导出
 * cordis 插件名，让 bundle patch 能把条目挂进 profile 层栈即可。
 *
 * 之所以仍然提供宿主侧入口：`cordis.patch.yml` 插入的条目由宿主加载器解析，
 * 加载器要读这个模块的 `name` 做身份校验；缺失会让整个 profile 启动失败。
 */

/** cordis 插件名，必须与 package.json 的 name 及 bucket patch 的 id 目标一致。 */
export const name = 'dsh-ui-beautify'

/**
 * 无副作用的宿主侧 apply。
 *
 * 保留空实现而不是省略 apply：显式声明「此处有意不做任何事」，避免后续维护者
 * 误以为宿主侧接线被遗漏。
 */
export function apply() {}
