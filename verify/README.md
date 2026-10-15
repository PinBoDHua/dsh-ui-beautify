# 渲染验证台

这个目录是插件的**离线渲染验证台**：用宿主自己的样式表在真实 Chromium 里渲染一个
DSH 外观的复刻页面，把「官方原版」与「插件令牌」并排拍下来对比。

它是维护工具，不是插件的一部分 —— `package.json` 的 `files` 不包含 `verify/`。

---

## 它证明什么、不证明什么

**能证明**：令牌覆盖让宿主的真实组件样式呈现出预期差异，且没有破坏对比度与可读性；
圆角阶梯与控件尺寸匹配；安全修正层把灯箱关闭按钮移出了原生窗口按钮的占位。

**不能证明**：真机 DOM 下的像素级结果。复刻页面的结构是照着宿主组件样式**反推**的，
不是从运行中的应用抓的实时 DOM。真机验收要靠装进 profile 后目视，或用离屏 Electron
加载本机 Web GUI 截图（见下）。

---

## 一次性准备：填充 `host-src/`

`host-src/` 里是宿主的样式表，**不随仓库分发**（属于第三方资源）。
它需要从本机的 DeepSeek Harness 安装里抽出来：

| 目录 | 内容 | 来源 |
| --- | --- | --- |
| `host-src/theme/*.css` | ui-theme 的令牌样式表（8 张） | `@deepseek-ai/dsh-client-ui-theme` 的客户端 bundle 里内嵌的 CSS 字符串 |
| `host-src/theme/layout-frame.css` | ui-layout 的窗口框架样式 | `@deepseek-ai/dsh-client-ui-layout/lib/client.js` |
| `host-src/theme/image-lightbox.css` | 图片灯箱的**编译后**样式 | `@deepseek-ai/dsh-web-frontend/dist/assets/index-*.css` |
| `host-src/primitives/*.module.css` | ui-primitives 的源码级组件样式 | `@deepseek-ai/dsh-client-ui-primitives` 包内的 `src/**/*.module.css` |

DSH 的桌面版把这些都打包在单个 asar 里（`<安装目录>\resources\app.asar`）。
需要一个小工具按 asar 头部读出目录树与文件，`asar` 格式是
`[u32 前缀][u32 头部长度][u32 JSON 长度][JSON][文件数据]`。

抽的时候注意一件事：**有些规则必须用编译后的类名**。灯箱那条安全修正依据的是
`_backdrop_1hos8_1` / `_close_1hos8_29` 这套「下划线 + hash」命名，用源码级的
`.backdrop` / `.close` 渲染根本匹配不到，两版截图会一模一样而看不出问题 ——
这个坑真踩过。`scripts/extract-compiled-css.mjs` 就是为此写的：

```powershell
node scripts/extract-compiled-css.mjs <index-*.css> 1hos8 verify/host-src/theme/image-lightbox.css
```

---

## 三条命令

```powershell
node verify/prepare.mjs   # 由 host-src/ 生成 build/：令牌表 + 组件样式 + 令牌快照 + 插件样式
node verify/shoot.mjs     # 本机 Chrome/Edge 无头截图 -> verify/out/
python verify/montage.py  # 拼成对比图
```

`shoot.mjs` 会自动找 Chrome 或 Edge，用独立的 `--user-data-dir`，不碰你的浏览器配置，
也不需要任何鉴权。

---

## 回归夹具

对照图不靠「保留旧截图」—— 裁剪框是按像素硬编码的，任何一次视口或标题栏高度变化
都会让新旧截图取景对不上。改成**同一轮渲染里现场生成缺陷图**：

| 参数 | 还原的缺陷 |
| --- | --- |
| `?bug=ambient-frame` | 氛围光被挂到窗口框架上，在内容区左上角圆角处切出硬边色块 |
| `?bug=caption-overlap` | 抽掉 `safety.css`，灯箱关闭按钮落回原生窗口按钮的占位里 |

`verify/out/compare-corner.png` 与 `verify/out/compare-caption-safety.png` 就是
这样产出的三格/两格对照 —— 除那一条规则外完全同源，结论才立得住。

---

## 文件一览

| 文件 | 作用 |
| --- | --- |
| `preview.html` | 复刻页面：应用外壳 / 浮层 / 设置面板 / 真实窗口框架 / 圆角画廊 / 图片灯箱 |
| `shell.css` | 复刻页面自己的布局样式（视觉身份强的控件用宿主真实组件类） |
| `prepare.mjs` | 生成 `build/`；插件样式表清单直接读构建产物，不重复维护 |
| `shoot.mjs` | 无头截图 |
| `montage.py` | 拼对比图（Pillow） |
| `zoom.py` | 裁剪并放大某块区域，用于看圆角这类细节 |
| `sample.py` | 按坐标取像素颜色，用来核对令牌是否真的落到了控件上 |
| `inspect-size.py` | 核对各截图尺寸与布局分界是否一致（裁剪框对齐的前提） |
| `host-src/` | 宿主样式副本（不随仓库分发，见上） |
