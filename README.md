# 界面美化 · Lumina（`dsh-ui-beautify`）

给 DeepSeek Harness Web 界面换一套视觉语言的客户端插件：**配色身份、表面层次、
几何圆角、内容排版**四件事同时收紧，并提供可视化外观设置面板。

仓库：<https://github.com/PinBoDHua/dsh-ui-beautify>

- 走官方唯一支持的扩展点 `ctx.theme.overrideTokens()`，**不劫持组件、不改宿主代码**；
- 卸载或关闭总开关后界面**零残留**地回到官方原样；
- 手写客户端 bundle，**不引入任何第三方依赖**，构建脚本零 npm 包；
- 自带静态审计 + 运行时集成测试 + Chromium 渲染验证台。

![浅色对比](verify/out/compare-shell-light.png)

---

## 它改变了什么

官方主题是一套**近乎单色**的设计：浅色下主按钮是近黑（`#0f1115`），深色下是近白
（`#f9fafb`），表面三层同为纯白，描边只有 4%–10% 的黑。沉静、耐看，但也意味着
界面**没有识别色**，浅色模式下层次靠一根几乎看不见的发丝线撑着。

本插件做四件事：

| 维度 | 官方 | 美化后 |
| --- | --- | --- |
| 品牌位 | 近黑 / 近白 | 用户选定的强调色（默认深海蓝 `#3f6fe0` / `#7aaaff`） |
| 表面层次 | 三层同色 | 画布 / 表面 / 浮层分级，冷调或暖调成套 |
| 阴影 | 中性黑，极淡 | 带色相的阴影阶，高度可辨 |
| 选中态 | 灰底 | 强调色**淡染**（13%），长期驻留不刺眼 |
| 圆角 | 12 / 16 / 28 | 可切三档，全部令牌联动 |
| 排版 | 行高 24px | 行高 25px + 标题阶梯同步上调 + 等宽数字 |

![深色对比](verify/out/compare-shell-dark.png)

### 圆角

宿主自带一套 4 / 8 / 12 / 16 / 20 / 28 的半径阶梯，插件在此基础上给出三档
**逐档设计值**（不是统一乘数）：

| 令牌 | 用在什么上 | 紧凑 | 标准 | 圆润 | 宿主 |
| --- | --- | --- | --- | --- | --- |
| `xs` | 行内代码、小标记 | 3 | 4 | 5 | 4 |
| `sm` | 24–28px 小控件 | 6 | 8 | 10 | 8 |
| `md` | 32px 输入框、34–36px 按钮/菜单行 | 9 | 12 | **14** | 12 |
| `lg` | 卡片、代码块、内容区左上角 | 12 | 16 | 21 | 16 |
| `xl` | 用户气泡、文件卡片 | 15 | 20 | 26 | 20 |
| `panel` | 输入区卡片、对话框 | 22 | 28 | 36 | 28 |

**为什么不用统一乘数**：宿主的 `md` 同时用在 32px 高的输入框和 36px 高的按钮上。
统一乘 1.4 得到 17px，超过 32px 输入框的半高（16px），输入框会塌成胶囊 ——
这正是第一版「圆润」档的真实后果。现在 `md` 锁定在 14px（占 32px 的 44%），
三档的差异主要落在大表面上，小控件只做小幅调整。

这条约束写成了 `scripts/check.mjs` 里的断言（单调性 + `md` 上限 +
内容区圆角对齐 `lg`），避免下次「顺手把圆润档再调大一点」时又踩回去。
`verify/out/compare-corner.png` 与 `verify/out/radius-*.png` 是可视证据：
画廊里还刻意放了两组**不应该变化**的对照件（标签胶囊、开关），
它们用字面量 `999px` + `corner-shape: round`，不受圆角令牌影响 ——
如果它们跟着变，说明选择器写错了。

![圆角画廊](verify/out/radius-official-light.png)

### 任务列表增强

宿主的任务面板（composer 上方的「任务 N 已完成 · M 进行中 · K 待处理」）三态在视觉上
几乎不可分：任务项文字**恒为同一种灰**，状态只由一个 6px 状态点承担 —— 已完成绿点、
进行中转圈、待处理灰点。十几行排下来扫一眼，得到的印象是「都差不多」，
于是「到底做完了没有」在面板上读不出来。

插件把状态差从「6px 圆点」放大到「整行可辨」：

| 状态 | 表现 |
| --- | --- |
| 已完成 | 文字降权 + 删除线（划线用描边色，不抢正文注意力） |
| 进行中 | 强调色淡染行底 + 左侧强调条 + 文字加重 |
| 待处理 | 保持宿主原样 —— 它是基线，另外两档的差异才有参照物 |

顺带修掉列表溢出：`max-height: 180px` 配 28px 行高不是整数倍，最后一行常被硬切成
两半，且没有任何「还能滚」的提示，看起来像渲染坏了。现在列表底部有 12px 渐隐，
并在末尾留出与渐隐等高的空白 —— 滚到底时渐隐落在空白上，**最后一行不会被误伤**。

![任务面板](verify/out/compare-panels.png)

全部通过宿主有意暴露的 `data-testid="todo-panel"` 与 `data-status`
（`completed | in_progress | pending` 封闭联合）定位，**不碰任何编译哈希类名**。

> **一个必须说清的边界**：面板头部的计数由宿主的 todo 投影直接决定。
> 如果它显示「10 待处理」，那是**数据**里确实一条 completed 都没有 ——
> agent 更新待办时没有标记完成，CSS 变不出完成态。插件只负责让已有状态**读得出来**，
> 不负责修正数据。

### 四个预设

| 预设 | 气质 | 适用 |
| --- | --- | --- |
| **极光** `aurora` | 冷调分层 · 通透 | 默认，长时间阅读 |
| **午夜** `midnight` | 深邃高对比 · 夜航 | 暗环境、外接显示器 |
| **石墨** `graphite` | 中性克制 · 专注 | 不想改变官方色相，只要层次与几何 |
| **纸感** `paper` | 暖白墨色 · 阅读 | 白天、长文档 |

![预设 浅色](verify/out/presets-light.png)

七个强调色与预设**正交**：先挑骨架，再挑识别色。
`极光 + 星云紫` 与 `极光 + 深海蓝` 是两套气质，而不是同一个主题的深浅变化。

![浮层材质](verify/out/compare-overlay.png)

---

## 安全修正：图片灯箱的 ✕ 不再会关掉程序

这一条不是美化，是修宿主的一个真实缺陷。Windows 上宿主用 Electron 的
`titleBarOverlay` 画最小化/最大化/关闭三个按钮 —— 它们**不在 DOM 里**，
由 Chromium 绘制在页面**之上**，占位约 `top: 0–40px`、`right: 0–138px`。

而图片灯箱的关闭按钮被固定在 `top: 20px; right: 20px`（36×36），
**整块落在那三个原生按钮的下半部分里**。因为原生层在上，点击被它截走：

> 你打开一张图，看着右上角的 ✕ 点下去 —— 关掉的是整个程序。

宿主自己发布了 `--dsh-frame-overlay-top`（= 标题栏高度 + 20px）正是给这类浮层用的，
灯箱没用它。插件用一条规则把它接回去：

```css
html[data-windows-titlebar] body [class*='_backdrop'] [class*='_close_'] {
  top: var(--dsh-frame-overlay-top, 60px);
}
```

- 位移量引用宿主变量而非写死：全屏时宿主会把该变量降回 20px，
  而全屏下原生按钮本就不显示，关闭按钮自动回到原位；
- 只在 Windows 标题栏模式下生效，macOS 与浏览器访问不受影响；
- 选择器用与哈希无关的后缀匹配（编译后是 `_backdrop_1hos8_1` / `_close_1hos8_29`），
  全应用只有一个 `_backdrop` 类，匹配不到时静默降级 ——
  宿主哪天自己修好了，这条规则自动失效。

![安全修正](verify/out/compare-caption-safety.png)

`scripts/audit-caption-collision.mjs` 会全量扫描宿主样式，找出所有「固定定位且
落在覆盖层占位内」的控件。当前扫描 162 个文件，**命中 1 条**，就是这一处。

---

## 安装

### 前置

- DeepSeek Harness Desktop（本插件针对 `0.2.0-rc.2` 客户端契约开发）；
- 插件目录已就位（本仓库根目录即为插件包）。

### 方式一：用 DSH 自带 CLI（推荐）

`desktop` 是 Electron 独占的保留 profile，npm CLI 拒绝管理它，必须用内置 CLI。
**先完全退出 DeepSeek Harness 桌面端**（profile 有写锁，CLI 最多等 120 秒）。

```powershell
& "D:\deepseekharness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "file:D:/Questions/dsh-ui-beautify"
```

CLI 会把它装进 profile 的 `node_modules`，并因为本包声明了 `dsh.bundle.patch`
而自动追加到 `dsh.profile.bundles`。装完重新打开应用即可。

### 方式二：手工接入

1. 把整个 `dsh-ui-beautify` 目录复制到
   `C:\Users\<你>\.dsh\profiles\desktop\node_modules\dsh-ui-beautify`；
2. 在 `C:\Users\<你>\.dsh\profiles\desktop\package.json` 的 `dependencies` 里加
   `"dsh-ui-beautify": "file:D:/Questions/dsh-ui-beautify"`；
3. 在同一个文件的 `dsh.profile.bundles` 数组末尾加 `"dsh-ui-beautify"`；
4. 重启 DeepSeek Harness。

> 第 3 步不可省略：`dsh.client` 的发现锚点是**宿主侧的 loader 条目**，
> 而条目来自 `cordis.patch.yml`，只有进了 `bundles` 才会被应用。

### 卸载

```powershell
& "D:\deepseekharness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-ui-beautify
```

或手工反向执行上面的三步。因为插件只通过官方扩展点改令牌，卸载后没有任何
需要清理的样式残渣。

---

## 使用

装好后进入 **设置 → 界面美化**：

![设置面板](verify/out/compare-panel.png)

| 控件 | 说明 |
| --- | --- |
| **总开关** | 关闭即整套撤回：令牌层清空、六张样式表移除、`data-dshb-*` 属性清空 |
| **预设风格** | 四套骨架，各含明暗两套完整配色 |
| **强调色** | 七个色相；浅色/深色分别调校，不是同一色的透明度变化 |
| **圆角** | 紧凑 / 标准 / 圆润三档**逐档设计值**，联动全部 `--dsw-radius-*` |
| **氛围光** | 侧栏叠一层低透明度光斑 |
| **内容精修** | 行高、字距、等宽数字、代码块与表格细节 |
| **任务列表增强** | 三态一眼可辨：已完成降权划线，进行中高亮 |
| **毛玻璃** | 关闭后菜单改为近乎不透明的实色填充 |
| **过渡动效** | 仅过渡颜色类属性，绝不加在布局属性上 |

页脚显示**当前版本号**——插件走热替换，没有可见版本号就只能靠猜「我到底装上了没有」。

改动**即时生效**，偏好保存在本机 `localStorage`（键 `dsh-ui-beautify:prefs:v1`），
不写入会话配置。**恢复默认**一键回到出厂外观。

### 公开状态标记

面板之外，插件在 `<html>` 上发布两个属性，方便你自己写补充样式：

| 属性 | 取值 | 用途 |
| --- | --- | --- |
| `data-dshb-preset` | `aurora` / `midnight` / `graphite` / `paper` | 针对某个预设写补充规则 |
| `data-dshb-radius` | `compact` / `standard` / `soft` | 针对某档圆角写补充规则 |
| `data-dshb-enabled` | `on`（不存在即关闭） | 判断插件是否生效 |

其余 `data-dshb-ambient` / `-typography` / `-motion` 由插件内部消费，不建议依赖。

---

## 它会覆盖宿主哪些令牌

共 **101 个宿主令牌 + 12 个插件自有原语**，分组如下：

| 分组 | 数量 | 代表令牌 |
| --- | --- | --- |
| 画布与表面 | 14 | `--dsw-alias-bg-base`、`--dsw-specific-sidebar-fill` |
| 侧栏导航 | 3 | `--dsw-specific-sidebar-nav-item-active` |
| 边框 | 7 | `--dsw-alias-border-l1` … `l4` |
| 文本与图标 | 9 | `--dsw-alias-label-primary`、`--dsw-alias-menu-icon` |
| 品牌与强调 | 12 | `--dsw-alias-brand-primary`、`--dsw-focus-ring-color` |
| 交互态 | 8 | `--dsw-alias-interactive-bg-hover` |
| 气泡与选区 | 3 | `--dsw-specific-bubble`、`--dsw-alias-bg-document-selection` |
| 菜单与浮层 | 3 | `--dsw-menu-surface-fill`、`--dsw-menu-backdrop-filter` |
| 代码与 Markdown | 9 | `--dsw-alias-markdown-code-block` |
| 提示与轻提示 | 4 | `--dsw-alias-toast-bg`、`--dsw-alias-tooltip-bg` |
| 滚动条 | 5 | `--dsw-alias-scrollbar-bg-l1` |
| 文档预览 | 2 | `--dsw-alias-bg-document-preview` |
| 阴影阶 | 4 | `--dsw-shadow-lv1` … `lv3` |
| 高度（原语） | 4 | `--dshb-elev-panel` 等，由样式表组合成 `--dsw-elevation-*` |
| 氛围光（原语） | 2 | `--dshb-ambient-a` / `-b` |
| 圆角 | 6 | `--dsw-radius-xs` … `-panel` |
| 排版 | 9 | `--dsw-font-family`、`--ds-font-family-code`、Markdown 阶梯 |

完整清单与明暗取值见 `verify/out/` 的渲染结果与
`reference/host-tokens.json`（宿主 432 个令牌基准表）。

---

## 已知限制

- **插件只让已有状态读得出来，不修正数据**。任务面板若显示「10 待处理」，
  那是宿主的 todo 投影里确实一条 completed 都没有 —— 需要 agent 更新待办时
  标记完成，CSS 改不了这个。
- **氛围光只作用于侧栏**。它曾经也挂在窗口框架上，结果在 Windows 标题栏模式下
  被内容区左上角那个圆角切成一块硬边蓝楔形 —— 框架的 `background-image` 原点
  （`background-origin: padding-box`）恰好就在内容区左上角。现在框架恢复为纯色，
  圆角里露出的是与侧栏连续的底色。见 `verify/out/compare-corner.png`。
- **不含字体文件**：排版精修只调整字体栈顺序与字距行高，不打包 webfont。
  想换正文字体请自行安装系统字体，或把 `FONT_STACK` 改成你的字体名。
- **氛围光依赖宿主的布局类名后缀**（`[class*='_sidebarCol']`）。宿主改结构时它会
  静默失效 —— 不会报错，只是不再显示，其余效果不受影响。
- **第三方主题若晚于本插件注册并通过 `overrideTokens` 覆盖同一令牌，会盖住本插件**
  （宿主按注册顺序叠加，后来者胜）。这是宿主的设计，不是缺陷。
- **偏好存 `localStorage`**：换浏览器/清缓存会丢，因为宿主的 settings schema 不允许
  第三方插件增加字段（ui-theme 的 README 明确写了这一点）。
- 渲染验证台用的是**宿主真实样式表 + 复刻 DOM**，不是从运行中的应用抓的实时 DOM。
  见下节说明。

---

## 开发

```powershell
npm run build              # 生成 src/client/styles.generated.js 与 client/client.js
npm run check              # 静态审计：令牌有效性 / 变量引用 / 属性契约 / 词典 / 产物形状
npm run check:encoding     # 编码自检：找出被非 UTF-8 工具改写出乱码的源文件
npm run check:reproducible # 可复现性：LF 与 CRLF 检出必须产出逐字节相同的 client.js
npm test                   # 运行时集成测试：加载、投射、开关联动、卸载残留
npm run verify             # 以上全部串起来
```

### 渲染验证台

```powershell
node verify/prepare.mjs   # 从 host-src/ 生成 build/（宿主令牌表 + 组件样式 + 令牌快照）
node verify/shoot.mjs     # 本机 Chrome/Edge 无头截图 -> verify/out/
python verify/montage.py  # 拼成对比图
```

验证台把**宿主 ui-theme 的七张令牌样式表逐字节原样**、**宿主 ui-primitives 的 38 个
真实组件样式**与**插件 `buildTokens()` 的真实输出**放进真实 Chromium 渲染。

它能证明：令牌覆盖让宿主的真实组件样式呈现预期差异，且没有破坏对比度。
它**不能**证明真机 DOM 下的像素级结果 —— 复刻页面的结构是照着宿主组件样式反推的。
真机验收请按「安装」一节装进 profile 后目视确认。

### 目录

```
src/client/index.js         客户端插件入口（apply / inject / name）
src/client/controller.js    外观控制器：令牌投射、属性投射、样式表装卸
src/client/presets.js       设计令牌预设表（唯一的配色与几何真相来源）
src/client/panel.js         设置面板组件（React.createElement，无 JSX）
src/client/state.js         状态读写与归一化
src/client/locales.js       中英词典
src/client/styles/*.css     六张结构层样式表
                            base / elevation / typography / task-list / safety / panel
scripts/build.mjs           零依赖构建：拼接 + 包成 __ModuleLoader__ 脚本
scripts/check.mjs           静态审计（20 项）
scripts/check-encoding.mjs  编码自检：找出被非 UTF-8 工具改写出乱码的源文件
scripts/check-reproducible.mjs  可复现性：LF 与 CRLF 检出产物逐字节一致
scripts/install.mjs         安全安装 / 卸载（默认 dry-run，先备份）
scripts/host-tokens.mjs     生成宿主令牌基准表（宿主升级后手工跑）
scripts/audit-caption-collision.mjs   全量排查侵入原生标题栏覆盖层的控件
scripts/extract-compiled-css.mjs      从宿主编译产物抽取指定 hash 分组的规则
tests/runtime.test.mjs      运行时集成测试（14 项）
verify/                     渲染验证台
CHANGELOG.md                更新日志
```

---

## 许可

MIT。`verify/host-src/` 下的样式表来自 DeepSeek Harness（MIT），仅用于离线渲染
验证，不随插件发布（`package.json` 的 `files` 未包含 `verify/`）。
