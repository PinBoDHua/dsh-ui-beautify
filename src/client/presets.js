/**
 * 界面美化 · Lumina —— 设计令牌预设表。
 *
 * 这里是插件唯一的「配色与几何真相来源」。所有值最终通过
 * `ctx.theme.overrideTokens(source, tokens)` 交给宿主的主题管线，由 ui-layout 的
 * presenter 以行内样式写到 `document.body` 上；因此本文件不产生任何 CSS。
 *
 * ## 为什么走宿主的主题管线而不是自己塞 CSS 变量
 * 宿主 ui-theme 把令牌作为行内样式写在 body 上（见 dsh-client-ui-layout 的
 * ThemePresenter.apply）。行内样式优先级最高，自建 `<style>` 里重声明 `--dsw-*`
 * 对它无效。走 overrideTokens 才能：
 *   1. 与官方主题叠加而非互斥 —— 用户切换浅色/深色时自动重解析；
 *   2. 随插件卸载/HMR 干净回滚（返回的 disposer 由 ctx.effect 持有）；
 *   3. 被宿主的令牌检查工具（exportInspectTokens）看见。
 *
 * ## 值形状
 * 每个令牌都必须给出 `{ light, dark }` 一对字符串；给裸字符串会被宿主的
 * validateOverrides 抛错（它在运行时真的会校验，这是官方契约）。
 *
 * ## 本版的关键变化：承载文字的颜色改为「解出来」（v1.2）
 * v1.1 的每个色值都是手写的。手调在「默认预设 + 默认强调色」下看不出问题，但
 * 4 预设 × 7 强调色 × 2 明暗 = 56 种组合，人眼覆盖不了。实测漏掉四处，
 * 其中一处是**完全看不见**的：
 *
 *   宿主把 `--dsw-specific-sidebar-nav-item-active-accent` 当**徽标底色**用
 *   （ui-user-questions：`.badge { background: 该令牌; color: var(--dsw-alias-button-info-fill) }`），
 *   而 v1.1 把这个令牌写成了完整强调色 —— 于是徽标的字与底同色，对比度 1.00。
 *
 * 因此 v1.2 把「读得出来」写成 `readability.js` 里的契约，并让颜色**解出来**：
 * 中性骨架仍是手写的美术决定，但凡承载文字的颜色都过一遍 `solveTone`，达标即
 * 原样返回。这样加第八个强调色时不会再重蹈覆辙。
 *
 * ## 命名约定
 * - `--dsw-*`：宿主官方令牌，覆盖它即改变宿主组件外观。
 * - `--dshb-*`：本插件自有令牌（b = beautify）。它们只作为原语存在，
 *   由 styles/*.css 组合成宿主令牌 —— 用于那些宿主在每个元素上重声明、
 *   因此行内样式够不着的令牌（`--dsw-elevation-*`）。
 */

import {
  alpha,
  ensureContrast,
  fadeOut,
  solveColor,
  solveTone,
  tint
} from './color.js'
import {
  AA,
  NON_TEXT,
  SYNTAX_TOKENS,
  TEXT_TIERS,
  surfaceColors
} from './readability.js'

/** 把一对明暗值包成宿主要求的形状。 */
const t = (light, dark) => ({ light, dark })

/**
 * 强调色。`light` 用于浅色主题（压暗以保证白底对比度），`dark` 用于深色主题
 * （提亮以保证深底对比度）。二者不是同一个色相的简单透明度变化，而是分别调校，
 * 因此这里显式写两遍。
 */
export const ACCENTS = [
  { id: 'deepseek', name: '深海蓝', light: '#3f6fe0', dark: '#7aaaff' },
  { id: 'violet', name: '星云紫', light: '#6741d9', dark: '#a78bfa' },
  { id: 'teal', name: '碧波青', light: '#0d8f85', dark: '#2dd4bf' },
  { id: 'amber', name: '琥珀金', light: '#b26a06', dark: '#fbbf24' },
  { id: 'rose', name: '绯樱粉', light: '#c72e63', dark: '#f472b6' },
  { id: 'forest', name: '苔原绿', light: '#1f7a4d', dark: '#4ade80' },
  { id: 'graphite', name: '石墨灰', light: '#414a58', dark: '#c3ccdb' }
]

/**
 * 圆角档位。
 *
 * 刻意**不用统一乘数**，而是逐档给出设计值。两处硬约束：
 *
 * 1. 宿主的 `--dsw-radius-md` 同时用在 32px 高的输入框、34–36px 高的按钮/
 *    菜单行和卡片上。乘 1.4 会得到 17px，超过 32px 输入框半高（16px），
 *    圆角一越界控件就塌成胶囊 —— 这是第一版「圆润」档的实际后果。
 *    因此 `md` 的上限锁在 14px（占 32px 的 44%），并把这条约束写成
 *    scripts/check.mjs 里的断言。
 * 2. 圆角层级要单调：xs ≤ sm ≤ md ≤ lg ≤ xl ≤ panel。宿主自带的 4/8/12/16/20/28
 *    大致每级 +4，三档都在这个性格上做伸缩，而不是各调各的。
 *
 * 于是三档的差异主要落在大表面上（卡片、气泡、输入区卡片、对话框），
 * 小控件只做小幅收紧/放松 —— 把 32px 的输入框磨得比卡片还圆，
 * 正是「看起来没打磨过」的典型来源。
 *
 * `contentRadius` 是 Windows 标题栏模式下内容区左上角那个圆角
 * （宿主 `--dsh-windows-content-radius`），跟随 `lg` 一档走，
 * 与相邻表面保持同一支笔。
 */
export const RADIUS_SCALES = [
  {
    id: 'compact',
    name: '紧凑',
    radii: { xs: 3, sm: 6, md: 9, lg: 12, xl: 15, panel: 22 },
    contentRadius: 12
  },
  {
    id: 'standard',
    name: '标准',
    radii: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, panel: 28 },
    contentRadius: 16
  },
  {
    id: 'soft',
    name: '圆润',
    radii: { xs: 5, sm: 10, md: 14, lg: 21, xl: 26, panel: 36 },
    contentRadius: 21
  }
]

/**
 * 圆角**形状**（与圆角半径正交的一条轴）。
 *
 * 宿主自带 `theme/corner_shape.css`：
 *
 *   @supports (corner-shape: superellipse(1.5)) {
 *     :root { --dsw-corner-shape: superellipse(1.5) }
 *     *, :before, :after { corner-shape: var(--dsw-corner-shape) }
 *   }
 *
 * 也就是说官方在支持该属性的浏览器上把**所有**圆角都做成了方圆形
 * （超椭圆，苹果那种「更饱满」的圆角），并把它交给一个令牌控制 ——
 * 而 v1.2 从来没有碰过这个令牌。
 *
 * 这条轴与半径完全正交：半径决定「切多深」，形状决定「切口是什么曲线」。
 * 三档里 `squircle` 就是官方的 `superellipse(1.5)`，因此**默认值不改变现有观感**；
 * 另外两档才是有意的偏离。
 *
 * 为什么值得做成一个开关：`corner-shape` 是这两年的新属性，观感差异在
 * 16–28px 的大圆角上非常明显（卡片、对话框、输入区），而「正圆 / 方圆形」
 * 是一个真实的审美分歧点 —— 有人认为方圆形更「高级」，有人认为它「不够利落」。
 * 插件不该替用户选，但应该把它变成一行可选项。
 *
 * 圆形按钮与胶囊不受影响：宿主的 StateDot / Pill / Switch / Tag / 滚动条滑块
 * 都自己写了 `corner-shape: round`，那是刻意的（正圆才像圆），
 * `scripts/check.mjs` 有一条断言把这件事钉在插件自己的样式表上。
 */
export const CORNER_SHAPES = [
  { id: 'round', name: '正圆', css: 'round' },
  { id: 'squircle', name: '方圆形', css: 'superellipse(1.5)' },
  { id: 'crisp', name: '硬朗', css: 'superellipse(2.4)' }
]

/**
 * 四个预设。
 *
 * `neutral` 是每个预设的「表面与墨色」骨架，明暗各一组；`shadow` 是该预设的
 * 阴影气质（冷调/中性/深黑/暖调）；`ambient` 是氛围光叠加层的两组光斑颜色。
 * 品牌色不写死在这里 —— 它来自用户选中的强调色，见 buildTokens。
 */
export const PRESETS = [
  {
    id: 'aurora',
    name: '极光',
    tagline: '冷调分层 · 通透',
    swatch: ['#3f6fe0', '#eef2f9', '#0c1017'],
    neutral: {
      light: {
        canvas: '#f6f8fc',
        surface1: '#ffffff',
        surface2: '#ffffff',
        surface3: '#ffffff',
        sidebar: '#eef2f9',
        overlay: '#dde5f2',
        module: '#f1f5fb',
        input: '#ffffff',
        code: '#f3f6fb',
        codeBanner: '#eaeff8',
        inlineCode: '#eef2f9',
        citation: '#eef2f9',
        tag: '#eef2f9',
        placeholder: '#f1f5fb',
        menu: '#fbfcffd9',
        menuHeader: '#fbfcfff2',
        toast: '#1a2436',
        scrollbar: '#c6d2e4',
        scrollbarHover: '#a3b3cb',
        switchThumb: '#ffffff',
        documentPreview: '#eef2f9',
        documentPreviewLabel: '#48566e',
        ink: '#0e1626',
        inkDimmed: '#28344a',
        inkSecondary: '#48566e',
        inkTertiary: '#6b7a91',
        inkCaption: '#8c98ab',
        icon: '#3c4a61',
        border1: '#1b2a4a0f',
        border2: '#1b2a4a1a',
        border3: '#1b2a4a24',
        border4: '#1b2a4a33'
      },
      dark: {
        canvas: '#0c1017',
        surface1: '#151b26',
        surface2: '#1b2230',
        surface3: '#222a3a',
        sidebar: '#101620',
        overlay: '#2a3244',
        module: '#222a3a',
        input: '#151b26',
        code: '#111721',
        codeBanner: '#171e2a',
        inlineCode: '#1b2230',
        citation: '#222a3a',
        tag: '#222a3a',
        placeholder: '#1b2230',
        menu: '#1a2130cc',
        menuHeader: '#161c28f2',
        toast: '#2a3244',
        scrollbar: '#3b4661',
        scrollbarHover: '#525f7d',
        switchThumb: '#8fa0bb',
        documentPreview: '#0c1017',
        documentPreviewLabel: '#b6c2d4',
        ink: '#eef2f8',
        inkDimmed: '#dae2ee',
        inkSecondary: '#a8b4c8',
        inkTertiary: '#7d8899',
        inkCaption: '#697485',
        icon: '#c6d0e0',
        border1: '#ffffff14',
        border2: '#ffffff24',
        border3: '#ffffff2e',
        border4: '#ffffff3d'
      }
    },
    shadow: {
      light: {
        stroke: '#1b2a4a29',
        lv1: '0 1px 2px 0 #101d360a',
        lv1blur: '0 4px 12px 0 #101d3608',
        lv2: '0 4px 12px 0 #101d3608, 0 2px 8px 0 #101d360d',
        lv3: '0 0 1px 0 #101d361f, 0 4px 12px 0 #101d360a, 0 14px 36px 0 #101d3617',
        panel: '0 3px 8px 0 #101d360a, 0 0 16px 0 #101d3608',
        prominent: '0 4px 12px 0 #101d360f, 0 0 22px 0 #101d3612',
        soft: '0 6px 20px 0 #101d360d, 0 0 28px 0 #101d360a'
      },
      dark: {
        stroke: '#ffffff2b',
        lv1: '0 1px 2px 0 #0000003d',
        lv1blur: '0 4px 12px 0 #0000002e',
        lv2: '0 4px 14px 0 #00000033, 0 2px 8px 0 #0000003d',
        lv3: '0 0 1px 0 #00000073, 0 6px 18px 0 #0000003d, 0 16px 40px 0 #00000052',
        panel: '0 3px 10px 0 #0000003d, 0 0 18px 0 #00000033',
        prominent: '0 6px 18px 0 #0000004d, 0 0 26px 0 #0000003d',
        soft: '0 8px 26px 0 #00000047, 0 0 32px 0 #00000033'
      }
    },
    ambient: {
      light: ['#3f6fe01f', '#7c5cff14'],
      dark: ['#4d7ff01f', '#8b5cf614']
    }
  },
  {
    id: 'midnight',
    name: '午夜',
    tagline: '深邃高对比 · 夜航',
    swatch: ['#5b8cf7', '#e9edf5', '#080a10'],
    neutral: {
      light: {
        canvas: '#f2f4f8',
        surface1: '#ffffff',
        surface2: '#ffffff',
        surface3: '#ffffff',
        sidebar: '#e9edf5',
        overlay: '#d6dded',
        module: '#eef2f8',
        input: '#ffffff',
        code: '#f1f4f9',
        codeBanner: '#e7ecf4',
        inlineCode: '#eaeff6',
        citation: '#eaeff6',
        tag: '#eaeff6',
        placeholder: '#eef2f8',
        menu: '#fafcffd9',
        menuHeader: '#fafcfff2',
        toast: '#12192a',
        scrollbar: '#bcc8dc',
        scrollbarHover: '#93a3bd',
        switchThumb: '#ffffff',
        documentPreview: '#e9edf5',
        documentPreviewLabel: '#3c4a61',
        ink: '#0a0d14',
        inkDimmed: '#1d2536',
        inkSecondary: '#414c63',
        inkTertiary: '#69748c',
        inkCaption: '#8a94a8',
        icon: '#33405a',
        border1: '#0b1a3314',
        border2: '#0b1a3320',
        border3: '#0b1a332e',
        border4: '#0b1a3342'
      },
      dark: {
        canvas: '#080a10',
        surface1: '#111520',
        surface2: '#171d2b',
        surface3: '#1f2739',
        sidebar: '#0b0e15',
        overlay: '#28334a',
        module: '#1f2739',
        input: '#111520',
        code: '#0d1119',
        codeBanner: '#141924',
        inlineCode: '#171d2b',
        citation: '#1f2739',
        tag: '#1f2739',
        placeholder: '#171d2b',
        menu: '#151b28d9',
        menuHeader: '#111622f2',
        toast: '#28334a',
        scrollbar: '#34405a',
        scrollbarHover: '#4a5876',
        switchThumb: '#8296b8',
        documentPreview: '#080a10',
        documentPreviewLabel: '#bcc8dc',
        ink: '#f4f7fc',
        inkDimmed: '#e0e8f4',
        inkSecondary: '#aab6cc',
        inkTertiary: '#7f8b9f',
        inkCaption: '#68738a',
        icon: '#ccd8ea',
        border1: '#ffffff1a',
        border2: '#ffffff2b',
        border3: '#ffffff38',
        border4: '#ffffff4d'
      }
    },
    shadow: {
      light: {
        stroke: '#0b1a3333',
        lv1: '0 1px 2px 0 #08122b0d',
        lv1blur: '0 4px 14px 0 #08122b0a',
        lv2: '0 4px 14px 0 #08122b0a, 0 2px 8px 0 #08122b12',
        lv3: '0 0 1px 0 #08122b26, 0 6px 16px 0 #08122b0f, 0 18px 44px 0 #08122b1f',
        panel: '0 4px 10px 0 #08122b0f, 0 0 18px 0 #08122b0a',
        prominent: '0 6px 16px 0 #08122b17, 0 0 26px 0 #08122b17',
        soft: '0 8px 24px 0 #08122b14, 0 0 32px 0 #08122b0f'
      },
      dark: {
        stroke: '#ffffff33',
        lv1: '0 1px 3px 0 #00000059',
        lv1blur: '0 5px 16px 0 #00000042',
        lv2: '0 5px 16px 0 #00000047, 0 2px 10px 0 #00000052',
        lv3: '0 0 1px 0 #0000008a, 0 8px 22px 0 #00000057, 0 20px 52px 0 #0000006b',
        panel: '0 4px 12px 0 #00000057, 0 0 20px 0 #00000047',
        prominent: '0 8px 22px 0 #00000066, 0 0 30px 0 #00000052',
        soft: '0 10px 32px 0 #00000061, 0 0 36px 0 #00000047'
      }
    },
    ambient: {
      light: ['#2f5fd41a', '#0ea5a412'],
      dark: ['#3b82f62e', '#22d3ee1a']
    }
  },
  {
    id: 'graphite',
    name: '石墨',
    tagline: '中性克制 · 专注',
    swatch: ['#414a58', '#f1f1f3', '#131315'],
    neutral: {
      light: {
        canvas: '#f7f7f8',
        surface1: '#ffffff',
        surface2: '#ffffff',
        surface3: '#ffffff',
        sidebar: '#f1f1f3',
        overlay: '#e2e2e5',
        module: '#f4f4f6',
        input: '#ffffff',
        code: '#f4f4f6',
        codeBanner: '#ececef',
        inlineCode: '#f0f0f2',
        citation: '#f0f0f2',
        tag: '#f0f0f2',
        placeholder: '#f4f4f6',
        menu: '#fafafad9',
        menuHeader: '#fafafaf2',
        toast: '#2b2b2e',
        scrollbar: '#c9c9ce',
        scrollbarHover: '#a6a6ad',
        switchThumb: '#ffffff',
        documentPreview: '#f1f1f3',
        documentPreviewLabel: '#4c4c52',
        ink: '#141416',
        inkDimmed: '#2c2c30',
        inkSecondary: '#5c5f66',
        inkTertiary: '#82868f',
        inkCaption: '#a0a4ac',
        icon: '#414147',
        border1: '#00000012',
        border2: '#0000001f',
        border3: '#0000002b',
        border4: '#0000003d'
      },
      dark: {
        canvas: '#131315',
        surface1: '#1e1e21',
        surface2: '#26262a',
        surface3: '#2e2e33',
        sidebar: '#18181b',
        overlay: '#35353a',
        module: '#2e2e33',
        input: '#1e1e21',
        code: '#161618',
        codeBanner: '#1e1e21',
        inlineCode: '#26262a',
        citation: '#2e2e33',
        tag: '#2e2e33',
        placeholder: '#26262a',
        menu: '#232327d9',
        menuHeader: '#1c1c20f2',
        toast: '#35353a',
        scrollbar: '#4a4a51',
        scrollbarHover: '#5f5f68',
        switchThumb: '#a9a9b2',
        documentPreview: '#131315',
        documentPreviewLabel: '#c9c9ce',
        ink: '#f2f2f3',
        inkDimmed: '#dededf',
        inkSecondary: '#adadb4',
        inkTertiary: '#83838b',
        inkCaption: '#6d6d75',
        icon: '#cfcfd6',
        border1: '#ffffff14',
        border2: '#ffffff24',
        border3: '#ffffff2e',
        border4: '#ffffff3d'
      }
    },
    shadow: {
      light: {
        stroke: '#00000029',
        lv1: '0 1px 2px 0 #0000000f',
        lv1blur: '0 4px 12px 0 #0000000a',
        lv2: '0 4px 12px 0 #0000000a, 0 2px 8px 0 #00000012',
        lv3: '0 0 1px 0 #00000029, 0 5px 14px 0 #00000012, 0 16px 38px 0 #0000001f',
        panel: '0 3px 8px 0 #0000000f, 0 0 16px 0 #0000000a',
        prominent: '0 5px 14px 0 #00000017, 0 0 22px 0 #00000017',
        soft: '0 6px 20px 0 #00000014, 0 0 28px 0 #0000000f'
      },
      dark: {
        stroke: '#ffffff2b',
        lv1: '0 1px 2px 0 #00000047',
        lv1blur: '0 4px 12px 0 #00000033',
        lv2: '0 4px 14px 0 #00000038, 0 2px 8px 0 #00000042',
        lv3: '0 0 1px 0 #0000007a, 0 6px 18px 0 #00000042, 0 16px 40px 0 #0000005c',
        panel: '0 3px 10px 0 #00000042, 0 0 18px 0 #00000038',
        prominent: '0 6px 18px 0 #00000052, 0 0 26px 0 #00000042',
        soft: '0 8px 26px 0 #0000004d, 0 0 32px 0 #00000038'
      }
    },
    ambient: {
      light: ['#64748b14', '#94a3b80f'],
      dark: ['#94a3b81a', '#64748b14']
    }
  },
  {
    id: 'paper',
    name: '纸感',
    tagline: '暖白墨色 · 阅读',
    swatch: ['#a8492a', '#f3efe6', '#17150f'],
    neutral: {
      light: {
        canvas: '#faf8f3',
        surface1: '#fffdf8',
        surface2: '#fffdf8',
        surface3: '#fffdf8',
        sidebar: '#f3efe6',
        overlay: '#e8e0d0',
        module: '#f6f2e9',
        input: '#fffdf8',
        code: '#f6f2e9',
        codeBanner: '#efe9dc',
        inlineCode: '#f2ede2',
        citation: '#f2ede2',
        tag: '#f2ede2',
        placeholder: '#f6f2e9',
        menu: '#fffcf6d9',
        menuHeader: '#fffcf6f2',
        toast: '#332e24',
        scrollbar: '#d4c9b4',
        scrollbarHover: '#b9ab90',
        switchThumb: '#fffdf8',
        documentPreview: '#f3efe6',
        documentPreviewLabel: '#5d5443',
        ink: '#1f1b14',
        inkDimmed: '#3a3325',
        inkSecondary: '#5d5443',
        inkTertiary: '#8a7f6a',
        inkCaption: '#a89c85',
        icon: '#4a4234',
        border1: '#3a2f1f1a',
        border2: '#3a2f1f24',
        border3: '#3a2f1f30',
        border4: '#3a2f1f40'
      },
      dark: {
        canvas: '#17150f',
        surface1: '#211e16',
        surface2: '#2a261c',
        surface3: '#332e22',
        sidebar: '#1b1811',
        overlay: '#3d3728',
        module: '#332e22',
        input: '#211e16',
        code: '#1b1813',
        codeBanner: '#231f18',
        inlineCode: '#2a261c',
        citation: '#332e22',
        tag: '#332e22',
        placeholder: '#2a261c',
        menu: '#26221ad9',
        menuHeader: '#1f1c15f2',
        toast: '#3d3728',
        scrollbar: '#544c3b',
        scrollbarHover: '#6b6250',
        switchThumb: '#b8ab92',
        documentPreview: '#17150f',
        documentPreviewLabel: '#d4c9b4',
        ink: '#f3eee3',
        inkDimmed: '#e3dccd',
        inkSecondary: '#c0b6a2',
        inkTertiary: '#958b78',
        inkCaption: '#7d7462',
        icon: '#d3c8b4',
        border1: '#ffffff17',
        border2: '#ffffff26',
        border3: '#ffffff33',
        border4: '#ffffff45'
      }
    },
    shadow: {
      light: {
        stroke: '#3a2f1f2e',
        lv1: '0 1px 2px 0 #3a2f1f0f',
        lv1blur: '0 4px 12px 0 #3a2f1f0a',
        lv2: '0 4px 12px 0 #3a2f1f0a, 0 2px 8px 0 #3a2f1f12',
        lv3: '0 0 1px 0 #3a2f1f29, 0 5px 14px 0 #3a2f1f12, 0 16px 38px 0 #3a2f1f1f',
        panel: '0 3px 8px 0 #3a2f1f0f, 0 0 16px 0 #3a2f1f0a',
        prominent: '0 5px 14px 0 #3a2f1f17, 0 0 22px 0 #3a2f1f17',
        soft: '0 6px 20px 0 #3a2f1f14, 0 0 28px 0 #3a2f1f0f'
      },
      dark: {
        stroke: '#ffffff2e',
        lv1: '0 1px 2px 0 #00000052',
        lv1blur: '0 4px 12px 0 #0000003d',
        lv2: '0 4px 14px 0 #00000042, 0 2px 8px 0 #0000004d',
        lv3: '0 0 1px 0 #00000085, 0 6px 18px 0 #0000004d, 0 16px 40px 0 #00000066',
        panel: '0 3px 10px 0 #0000004d, 0 0 18px 0 #00000042',
        prominent: '0 6px 18px 0 #0000005c, 0 0 26px 0 #0000004d',
        soft: '0 8px 26px 0 #00000057, 0 0 32px 0 #00000042'
      }
    },
    ambient: {
      light: ['#c2803a1f', '#8a5a2b14'],
      dark: ['#d99a4a1f', '#a86a3014']
    }
  }
]

/** 精修排版时替换的字体栈。中文回退顺序按 Windows/macOS 实际可用性排列。 */
const FONT_STACK = {
  ui: '-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans SC", "Helvetica Neue", Helvetica, Arial, sans-serif',
  code: '"Cascadia Code", "Cascadia Mono", "JetBrains Mono", "SF Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, "PingFang SC", "Microsoft YaHei", monospace'
}

/** 三档圆角对应的宿主令牌名。 */
const RADIUS_TOKENS = {
  xs: '--dsw-radius-xs',
  sm: '--dsw-radius-sm',
  md: '--dsw-radius-md',
  lg: '--dsw-radius-lg',
  xl: '--dsw-radius-xl',
  panel: '--dsw-radius-panel'
}

/**
 * 浅染比例。宿主多处把强调色的淡染层当**背景**用（Tag 语气、徽标、更新指示），
 * 而这些层由程序算出而不是用户挑的，因此比例也在这里集中定义。
 */
const TINTS = Object.freeze({
  /** ui-primitives 的 Tag info 语气：`color-mix(accent 10%, transparent)`。 */
  tag: 0.1,
  /** 插件自己的侧栏选中底：长期驻留视野，淡一些。 */
  navActive: 0.13,
  navActiveDark: 0.16,
  /** 徽标底（宿主 .badge 直接改用该令牌）。 */
  badge: 0.12,
  badgeDark: 0.18
})

/**
 * 快捷键键帽底板与气泡底的最低可分辨度。
 *
 * 官方是 2.00（浅色）/ 1.82（深色），所以 2.0 是「至少不输给官方」这条线。
 * v1.1 的固定 18% 白混只有 1.75 —— 阈值原本写在契约里是 1.3，等于没有约束。
 */
const TOOLTIP_KEY_MIN = 2

/**
 * 思考态扫光朝画布退让的比例。
 *
 * 官方那一对（正文 / 扫光）的可分辨度是 1.6 上下 —— 它本来就是一道
 * 「若有若无」的微光，因此这里不能按 3:1 去解，只能复刻那种强度。
 * 42% 是实测能让 56 组组合都落在 1.5 以上、又不超过 3.0 的取值：
 * 再小会让扫光与正文糊在一起，再大就成了一道真正的条纹。
 */
const THINK_SHIMMER_MIX = 0.42

/**
 * 让一个文字色对**一整组**背景都达标。
 *
 * 文字不总是落在画布上：同一段灰字会出现在画布、卡片、代码块、侧栏上。
 * 只对画布求解是不够的 —— 代码块底色比卡片暗一档，那里往往才是最先读不清的地方
 * （实测三级文字在代码块上比在卡片上低 0.3–0.4）。
 *
 * `scripts/check.mjs` 有一条断言要求这组背景同属亮侧或暗侧：混侧时可行区间可能
 * 为空，而那不是本插件会遇到的情形，应当构建期失败而不是运行期给出奇怪的颜色。
 *
 * @param color - 起始文字色。
 * @param backgrounds - 该文字可能压在其上的全部背景。
 * @param target - 目标对比度。
 */
function ensureContrastAllSurfaces(color, backgrounds, target) {
  return solveTone(color, backgrounds, target)
}

/**
 * 自指约束的求解余量。
 *
 * 自指约束（背景由被求解的颜色自己派生）在迭代里收敛到**边界**上：最后一轮解出的
 * 颜色，其派生的背景是用上一轮颜色算的，两者相差一个 8 位色的舍入量。实测这会
 * 让最差的一处停在 4.47 而非 4.50。给目标加一点余量，把结果推离边界，
 * 而不是把断言放宽到 4.4 —— 后者会让真正的回归悄悄通过。
 */
const SELF_REFERENTIAL_MARGIN = 0.15

/**
 * 求解结果的缓存。
 *
 * 求解是纯函数（输入只有强调色与预设），但一次要跑 2 轮 × 约 40 条约束 × 26 步
 * 二分，实测约 7ms。面板每次渲染都会调 `buildTokens`，静态审计要跑 1344 种状态
 * 组合 —— 不缓存的话审计要多花十几秒，面板拨开关时也会掉帧。
 *
 * 键是「强调色 id | 预设 id」：两者都不变，结果必然相同（求解不读任何全局状态）。
 */
const accentCache = new Map()
const syntaxCache = new Map()

/**
 * 求解一个强调色的两个明暗取值。
 *
 * ## 为什么只有一支，而不是「填充支 + 文字支」
 * 试过拆两支（填充只对压在其上的文字负责、文字对全部表面负责），但实测两支的
 * 解只差 1–2 个色阶（例如 `#2357d6` 与 `#2254d0`）—— 肉眼完全不可区分，
 * 却让「同一个强调色」变成两个不同的值，用户看到的主按钮与链接会有一丝对不上，
 * 维护者也要多记一条规则。**一个强调色就是一个身份色**，因此这里只解一支，
 * 让它同时满足全部约束。
 *
 * ## 约束从哪来
 * 强调色在本插件里承担三种角色，每一种都有对侧的约束：
 *
 *   1. **当底**：白字（浅色）/ 近黑字（深色）压在其上 —— 主按钮、开关轨道、
 *      StateDot、以及 ui-conversation 那个 34px 圆形按钮。
 *   2. **当文字**：压在全部表面色上 —— 链接、品牌文字、Tag 语气、业务强调。
 *   3. **当浅染层的来源**：淡染层本身是背景，而它上面又要压强调色文字（自指）。
 *      最典型的是 ui-user-questions 的徽标：底色是
 *      `--dsw-specific-sidebar-nav-item-active-accent`（本色的淡染），
 *      文字是 `--dsw-alias-button-info-fill`（本色自己）。
 *
 * ## 为什么是迭代
 * 第 3 类约束的背景**由强调色自己派生**，所以「解强调色」与「算淡染层」互为因果。
 * 一遍求解用的是旧色算出的淡染层；用解出的新色重算后可能又差一点。实测一遍的
 * 余量是 4.33（目标 4.5），两遍收敛到 4.5 以上。第三轮起收益低于 8 位色的可
 * 分辨精度，因此固定两轮 —— 轮数写成常量，而不是「跑到收敛为止」。
 *
 * @param accent - 强调色条目（含 `light` / `dark` 原始色）。
 * @param preset - 预设条目（提供表面色）。
 * @returns `{ light, dark }` 求解后的实色。
 */
function solveAccent(accent, preset) {
  const cacheKey = `${accent.id}|${preset.id}`
  const hit = accentCache.get(cacheKey)
  if (hit !== undefined) return hit

  const out = {}
  for (const mode of ['light', 'dark']) {
    const neutral = preset.neutral[mode]
    const surfaces = surfaceColors(neutral)
    // 压在强调色填充上的文字：浅色是纯白，深色是近黑（都是宿主的官方取值，
    // 见 readability.js 的 HOST_FALLBACK —— 插件有意不覆盖那个令牌）。
    const onAccent = mode === 'light' ? '#ffffff' : '#0f1115'
    const navAmount = mode === 'light' ? TINTS.navActive : TINTS.navActiveDark
    const badgeAmount = mode === 'light' ? TINTS.badge : TINTS.badgeDark

    let color = accent[mode]
    for (let pass = 0; pass < 2; pass += 1) {
      const layers = []
      for (const surface of surfaces) {
        layers.push(
          tint(surface, color, TINTS.tag),
          tint(surface, color, navAmount),
          tint(surface, color, badgeAmount)
        )
      }
      layers.push(tint(neutral.sidebar, color, navAmount))
      layers.push(tint(neutral.sidebar, color, badgeAmount))
      const solved = solveColor(color, [
        // 1. 当底：压在上面的文字读得出来
        { against: onAccent, target: AA },
        // 2. 当文字：压在全部表面上
        ...surfaces.map((surface) => ({ against: surface, target: AA })),
        // 3. 当文字：压在自己的淡染层上（自指，留一点余量）
        ...layers.map((layer) => ({ against: layer, target: AA + SELF_REFERENTIAL_MARGIN }))
      ])
      // 无解时保留上一轮的值：`scripts/check.mjs` 的断言会把它变成构建期失败，
      // 而不是在这里悄悄塞一个不达标的颜色。
      if (solved === null) break
      color = solved
    }
    out[mode] = color
  }
  accentCache.set(cacheKey, out)
  return out
}

/**
 * 求解语法着色。
 *
 * 宿主的 `shiki.css` 把九个 token 色写死在 `:root` / `[data-ds-dark-theme]` 上，
 * 深浅两套**都与主题绑定**，却不随插件的预设走。插件改了代码块底色
 * （`--dsw-alias-markdown-code-block`）之后，这些色就落在了一个它们从未被设计过的
 * 底上：浅色下九个里有六个低于 AA，最差的注释只有 2.97 —— 官方底上本来也只有 3.18，
 * 但插件把纸感的底压得更暖之后又低了 0.21。
 *
 * 修法是**接管这九个令牌**，按当前代码块底色求解到 AA，并且保持色相 ——
 * 语法高亮的可读性来自「这几类 token 互相可区分」，而区分靠的是色相，
 * 不是明度。因此这里只沿明度轴移动，不动色相。
 *
 * 深色下宿主的九个色本来就有 6.95 以上，求解器会原样返回 —— 实测确实一个都没变。
 *
 * @param shiki - 宿主原始 token 色（`{ light, dark }` 两张表）。
 * @param preset - 预设条目（提供代码块底色）。
 */
function solveSyntax(shiki, preset) {
  const cacheKey = preset.id
  const hit = syntaxCache.get(cacheKey)
  if (hit !== undefined) return hit

  const out = {}
  for (const mode of ['light', 'dark']) {
    const background = preset.neutral[mode].code
    const table = {}
    for (const name of SYNTAX_TOKENS) {
      table[name] = ensureContrast(shiki[mode][name], background, AA)
    }
    out[mode] = table
  }
  syntaxCache.set(cacheKey, out)
  return out
}

/** 宿主 `theme/shiki.css` 的九个 token 色，逐字节照抄。求解器以此为起点。 */
const HOST_SHIKI = Object.freeze({
  light: Object.freeze({
    constant: '#1c7ed6',
    string: '#2f9e44',
    comment: '#868e96',
    keyword: '#d6336c',
    parameter: '#e8590c',
    function: '#6741d9',
    'string-expression': '#2b8a3e',
    punctuation: '#495057',
    link: '#1971c2'
  }),
  dark: Object.freeze({
    constant: '#4dabf7',
    string: '#69db7c',
    comment: '#adb5bd',
    keyword: '#faa2c1',
    parameter: '#ffa94d',
    function: '#b197fc',
    'string-expression': '#8ce99a',
    punctuation: '#ced4da',
    link: '#74c0fc'
  })
})

/**
 * 宿主 `design_platform.css` 的语义色，逐字节照抄。求解器以此为起点。
 *
 * ## 为什么语义色与强调色是两套，而且都不共用
 * 强调色是**用户的身份色**（品牌、按钮、链接），语义色是**状态的语言**：
 * 绿 = 成功、琥珀 = 警告、红 = 危险。后者的色相不是审美选择，而是一条被反复
 * 学习的约定 —— 把「危险」换成紫色，界面就不再可信。
 *
 * 因此这里的处理与强调色**正好相反**：
 *   · 强调色：色相由用户挑，明度由求解器决定（只保证读得出来）；
 *   · 语义色：色相与饱和度锁死（约定不可动），只沿明度轴移动到读得出来。
 * 两者都只动明度，但理由不同，`scripts/check.mjs` 也分别断言。
 *
 * ## 种子为什么是「宿主的两支」
 * 宿主的语义色在浅色/深色两套里几乎相同（绿-500 与琥珀-500 两边都用），
 * 只有危险色的浅色档用了更深的红-600。照抄宿主而不是自选，是为了让
 * 「插件之前的界面」与「插件之后的界面」在同一套语言里 ——
 * 用户看到的仍然是那个绿，只是终于读得出来了。
 */
const HOST_SEMANTIC = Object.freeze({
  light: Object.freeze({
    success: '#22c55e',
    successSoft: '#4ed17e',
    warn: '#f59e0b',
    warnSoft: '#f7ad31',
    error: '#ec1313',
    errorSoft: '#f25a5a'
  }),
  dark: Object.freeze({
    success: '#22c55e',
    successSoft: '#4ed17e',
    warn: '#f59e0b',
    warnSoft: '#f7ad31',
    error: '#f25a5a',
    errorSoft: '#f25a5a'
  })
})

/**
 * 语义色的淡染比例，取自宿主 `Tag.module.css` 的原始注释：
 * 「The tint is 10%, except `warning`, which keeps the 12%」。
 * 这三个语气（success / warning / danger）与 v1.2 已经求解过的 `info` 语气
 * 是同一张样式表里隔几行的兄弟规则，比例也照抄，唯一的改动是**把颜色解出来**。
 */
const SEMANTIC_WASH = Object.freeze({ success: 0.1, warn: 0.12, error: 0.1 })

/** 差异视图的整行淡染比例，取自宿主 `--dsw-static-green-500-a08/a12`。 */
const DIFF_WASH = Object.freeze({ light: 0.08, dark: 0.12 })

/** 深色下调色板键名 → 语义族成员。 */
const SEMANTIC_MEMBERS = Object.freeze([
  ['success', 'successSoft'],
  ['warn', 'warnSoft'],
  ['error', 'errorSoft']
])

const semanticCache = new Map()

/**
 * 求解一个预设的语义色（四支：成功 / 警告 / 危险，各含一支「柔和档」）。
 *
 * ## 约束从哪来
 * 与强调色同一个套路，但这次的**每一条都有消费者**：
 *
 *   1. **当文字**：压在全部表面色与画布上 —— `.failed` 的保存失败提示、
 *      菜单里的危险项、（柔和档的）shortcuts / plugin-manager 内联样式；
 *   2. **当文字，压在自己的淡染层上**：Tag 的 success / warning / danger 语气
 *      （`color-mix(色 10%/12%, transparent)` + `color: 色`），这是一处**自指**约束，
 *      因此与强调色一样迭代两轮；
 *   3. **当底色**：`.brokenBadge` 把危险色铺成徽标底，字是 `--dsw-alias-bg-layer-3`
 *      —— 也就是插件的 surface3。**只有危险色有这条消费者**，所以只有它带这条约束：
 *      给成功与警告加一条不存在的需求，只会让它们的明度被推着走。
 *
 * 轻提示上的那一对**不在**约束里，也解不出来 —— 见 `readability.js` 的 INFEASIBLE。
 *
 * @param preset - 预设条目（提供表面色与画布）。
 * @returns `{ light, dark }`，每侧含 `success/successSoft/warn/warnSoft/error/errorSoft`。
 */
function solveSemantic(preset) {
  const cacheKey = preset.id
  const hit = semanticCache.get(cacheKey)
  if (hit !== undefined) return hit

  const out = {}
  for (const mode of ['light', 'dark']) {
    const neutral = preset.neutral[mode]
    const surfaces = surfaceColors(neutral)
    const all = [...surfaces, neutral.canvas]
    const seeds = HOST_SEMANTIC[mode]
    const result = {}

    for (const [base, soft] of SEMANTIC_MEMBERS) {
      const wash = SEMANTIC_WASH[base]
      let color = seeds[base]
      for (let pass = 0; pass < 2; pass += 1) {
        const layers = all.map((surface) => tint(surface, color, wash))
        const requirements = [
          // 1. 当文字：压在全部表面与画布上
          ...all.map((surface) => ({ against: surface, target: AA })),
          // 菜单材质是半透明的，落点仍以画布计
          { against: neutral.menu, target: AA },
          // 2. 当文字：压在自己的淡染层上（自指，留余量）
          ...layers.map((layer) => ({ against: layer, target: AA + SELF_REFERENTIAL_MARGIN }))
        ]
        // 3. 当底色：只有危险色有这条消费者（.brokenBadge）
        if (base === 'error') {
          requirements.push({ against: neutral.surface3, target: AA })
        }
        const solved = solveColor(color, requirements)
        if (solved === null) break
        color = solved
      }
      result[base] = color
      // 柔和档：宿主的 green-400 / amber-400 是「同色相、更低饱和度」的一档，
      // 它同样被当文字用（shortcuts / plugin-manager），所以也解到 AA。
      // 一次把全部约束交给求解器 —— 逐个表面反复调用会让前一个表面的结论
      // 被后一个表面推翻（最后一次调用说了算），那是错的。
      result[soft] =
        solveColor(
          seeds[soft],
          all.map((surface) => ({ against: surface, target: AA }))
        ) ?? seeds[soft]
    }
    out[mode] = result
  }
  semanticCache.set(cacheKey, out)
  return out
}

/**
 * 面板色板要显示的颜色 —— **求解后**的取值，而不是配色表里的原始值。
 *
 * 为什么必须求解后再显示：求解会沿明度轴微调强调色（最多约 11%），如果色板画的是
 * 原始值、界面用的是求解值，用户就会看到「我选的那个颜色和我得到的不一样」。
 * 色板上的那一点必须是最终会渲染出来的那一点，否则这一版新增的求解就成了
 * 一件用户看不见、也无法预期的事。
 *
 * @param presetId - 当前预设 id（求解依赖预设的表面色）。
 * @returns `{ [accentId]: { light, dark } }`。
 */
export function accentSwatches(presetId) {
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]
  const out = {}
  for (const accent of ACCENTS) out[accent.id] = solveAccent(accent, preset)
  return out
}

/**
 * 由「预设 + 强调色 + 圆角 + 若干开关」算出完整的令牌覆盖层。
 *
 * @param state - 当前外观状态（见 state.js 的 normalizeState）。
 * @returns 令牌名 → { light, dark }。
 */
export function buildTokens(state) {
  const preset = PRESETS.find((p) => p.id === state.preset) ?? PRESETS[0]
  const accentEntry = ACCENTS.find((a) => a.id === state.accent) ?? ACCENTS[0]
  const radius = RADIUS_SCALES.find((r) => r.id === state.radius) ?? RADIUS_SCALES[1]
  const corner = CORNER_SHAPES.find((c) => c.id === state.corner) ?? CORNER_SHAPES[1]
  const L = preset.neutral.light
  const D = preset.neutral.dark
  const SL = preset.shadow.light
  const SD = preset.shadow.dark

  /**
   * 强调色与它的派生量在这里统一解出来。
   * 手写取值只提供色相与饱和度，明度由求解器按可读性契约决定 —— 见 `solveAccent`。
   */
  const accent = solveAccent(accentEntry, preset)
  const semantic = solveSemantic(preset)
  const syntax = solveSyntax(HOST_SHIKI, preset)

  /**
   * 文字阶梯也过一遍求解：四个预设的墨色是美术选择，但「三级文字能不能读」
   * 不该由美术选择决定。实测石墨与纸感的浅色下三级文字只有 3.65 / 3.88，
   * 比官方基线（3.71）还低 —— 求解器把它们抬到 AA。
   *
   * ## v1.3：把「悬停淡染层」也算进去
   * 这一族此前只对**平面**表面求解，而宿主动辄把 `--dsw-alias-interactive-bg-hover`
   * 铺在文字底下（`Menu.module.css` 的 `.item:hover`，行里还有 11px 的
   * `.shortcutKeys` 与 `.label`）。深色模式下强调色是亮色，那层 12% 的罩层把
   * 深底**提亮**，于是同一段灰字的有效底变亮了：
   *
   *   石墨 + 石墨灰 + 深色，卡片上的 caption 从 3.x 掉到 **2.06**（目标 3）、
   *   tertiary 掉到 **3.06**（目标 4.5）—— 全 1680 组「文字 × 悬停底」里
   *   **969 组低于自己的档位**。
   *
   * 这是「契约的输入集少了一类底」的典型：不是算错，是没算 —— 与 v1.2 漏掉
   * 输入框占位文字、v1.3 漏掉语义色是同一类。修法是把这两层加进 `all`，
   * 让整支阶梯在**它真正会落在的所有底**上都达标。
   *
   * ## 哪几级进得了这个约束集，是算出来的，不是挑出来的
   * 罩层把深色底**提亮**，于是「最亮的那支墨还能不能达标」变成一条算术题：
   * 底越亮，纯白能拿到的对比度越低。实测最亮的那层（surface3 + 按下罩层）
   * 相对亮度 0.057，**纯白对它也只有 9.8:1** —— 于是：
   *
   *   · tertiary(4.5) / caption(3) / secondary(5.5) / icon(3)：可行，纳入；
   *   · primary(12) 与 dimmed(9)：**数学上不可行**（12 需要底 ≤0.0375）。
   *
   * 这两级因此保持「对平面表面求解」：它们的高底线是稳态界面的美术标准，
   * 而不是一个瞬态底色上的承诺。悬停时它们仍然读得出来（实测最低 8.6:1，
   * 高于 AAA 的 7），只是不再满足插件自定的 12 —— `scripts/check.mjs`
   * 会把这个实测值连同它的来源一起钉住，而不是让这条界线消失在注释里。
   */
  const HOVER_WASH = { light: 0.08, dark: 0.12 }
  const ACTIVE_WASH = { light: 0.14, dark: 0.2 }
  const neutralText = {}
  for (const mode of ['light', 'dark']) {
    const neutral = preset.neutral[mode]
    const surfaces = surfaceColors(neutral)
    const canvas = neutral.canvas
    const accentColor = accent[mode]
    const flat = [...surfaces, canvas]
    /** 悬停 / 按下时文字真正压在什么上：强调色罩层合成到每一支平面底上。 */
    const washed = flat.flatMap((surface) => [
      tint(surface, accentColor, HOVER_WASH[mode]),
      tint(surface, accentColor, ACTIVE_WASH[mode])
    ])
    const transient = [...flat, ...washed]
    neutralText[mode] = {
      ink: solveTone(neutral.ink, flat, TEXT_TIERS.primary),
      inkDimmed: ensureContrastAllSurfaces(neutral.inkDimmed, flat, TEXT_TIERS.dimmed),
      inkSecondary: ensureContrastAllSurfaces(
        neutral.inkSecondary,
        transient,
        TEXT_TIERS.secondary
      ),
      inkTertiary: ensureContrastAllSurfaces(
        neutral.inkTertiary,
        transient,
        TEXT_TIERS.tertiary
      ),
      inkCaption: ensureContrastAllSurfaces(
        neutral.inkCaption,
        transient,
        TEXT_TIERS.caption
      ),
      // 占位文字（`--dsw-alias-label-dimmed`）是**正文**，不是描边：
      // 宿主唯一的消费者是 `.input::placeholder`，14px。v1.1 把它绑在描边色上，
      // 实测只有 1.48–2.00:1。这里从说明文字那支墨出发解到 AA ——
      // 从 inkCaption 起步而不是 inkTertiary，是为了让占位文字比三级文字淡一点，
      // 保持「提示 < 正文」的层级感。输入框不会悬停变色，因此仍按平面底求解。
      placeholder: ensureContrastAllSurfaces(neutral.inkCaption, flat, AA),
      icon: ensureContrastAllSurfaces(neutral.icon, transient, NON_TEXT)
    }
  }

  /** 令牌表。先铺中性骨架，再叠强调色派生量，便于审阅。 */
  const tokens = {}

  // ---- 画布与表面 ---------------------------------------------------------
  tokens['--dsw-alias-bg-base'] = t(L.canvas, D.canvas)
  tokens['--dsw-alias-bg-layer-1'] = t(L.surface1, D.surface1)
  tokens['--dsw-alias-bg-layer-2'] = t(L.surface2, D.surface2)
  tokens['--dsw-alias-bg-layer-3'] = t(L.surface3, D.surface3)
  tokens['--dsw-specific-sidebar-fill'] = t(L.sidebar, D.sidebar)
  tokens['--dsw-alias-bg-overlay'] = t(L.overlay, D.overlay)
  tokens['--dsw-alias-bg-module-platform'] = t(L.module, D.module)
  tokens['--dsw-alias-bg-multi-select'] = t(L.module, D.module)
  tokens['--dsw-specific-input-major'] = t(L.input, D.input)
  tokens['--dsw-specific-login-input'] = t(L.module, D.input)
  tokens['--dsw-specific-tip'] = t(L.module, D.module)
  tokens['--dsw-specific-selector'] = t(L.module, D.module)

  // ---- 侧栏导航 -----------------------------------------------------------
  // 选中态用强调色「淡染」surface，而不是铺满强调色：侧栏是长期停留在视野里的
  // 区域，高饱和实色会在几分钟内变成视觉噪音。
  tokens['--dsw-specific-sidebar-nav-item-active'] = t(
    tint(L.sidebar, accent.light, TINTS.navActive),
    tint(D.sidebar, accent.dark, TINTS.navActiveDark)
  )
  // **这是 v1.2 修掉的一处真实缺陷，也是本版最严重的一处。**
  // 宿主把它当徽标**底色**用（ui-user-questions：
  // `.badge { background: 该令牌; color: var(--dsw-alias-button-info-fill) }`）。
  // v1.1 在这里写的是完整强调色，而 `button-info-fill` 用的也是同一个强调色 ——
  // 于是徽标的字与底**完全同色**，对比度 1.00，字数完全消失。
  //
  // 现在它是一层淡染，与官方语义一致（浅色 deepseek-100、深色 bluish-800
  // 都是「同系但更接近底色的浅染层」，而不是强调色本体）。
  tokens['--dsw-specific-sidebar-nav-item-active-accent'] = t(
    tint(L.sidebar, accent.light, TINTS.badge),
    tint(D.sidebar, accent.dark, TINTS.badgeDark)
  )
  tokens['--dsw-specific-sidebar-nav-item-hover'] = t(
    tint(L.sidebar, accent.light, 0.06),
    tint(D.sidebar, accent.dark, 0.1)
  )

  // ---- 边框 ---------------------------------------------------------------
  tokens['--dsw-alias-border-l1'] = t(L.border1, D.border1)
  tokens['--dsw-alias-border-l2'] = t(L.border2, D.border2)
  tokens['--dsw-alias-border-l2-darkmode-thin'] = t(L.border1, D.border1)
  tokens['--dsw-alias-border-l3'] = t(L.border3, D.border3)
  tokens['--dsw-alias-border-l4'] = t(L.border4, D.border4)
  // 官方把这两个写成 `transparent` —— 语义是「这个方向有意不画线」，不是
  // 「一条几乎看不见的线」。v1.1 给了它们可见的描边色，于是在官方刻意留白的
  // 位置（账户对话框、命令面板重试按钮）多出边框。v1.2 交回透明。
  tokens['--dsw-alias-border-inverted'] = t('#00000000', '#ffffff0f')
  tokens['--dsw-alias-border-inverted2'] = t('#00000000', '#ffffff14')

  // ---- 文本与图标 ---------------------------------------------------------
  tokens['--dsw-alias-label-primary'] = t(neutralText.light.ink, neutralText.dark.ink)
  tokens['--dsw-alias-label-primary-dimmed'] = t(
    neutralText.light.inkDimmed,
    neutralText.dark.inkDimmed
  )
  tokens['--dsw-alias-label-primary-inverted'] = t(L.surface1, D.surface1)
  tokens['--dsw-alias-label-secondary'] = t(
    neutralText.light.inkSecondary,
    neutralText.dark.inkSecondary
  )
  tokens['--dsw-alias-label-tertiary'] = t(
    neutralText.light.inkTertiary,
    neutralText.dark.inkTertiary
  )
  tokens['--dsw-alias-label-caption'] = t(
    neutralText.light.inkCaption,
    neutralText.dark.inkCaption
  )
  tokens['--dsw-alias-label-dimmed'] = t(
    neutralText.light.placeholder,
    neutralText.dark.placeholder
  )
  tokens['--dsw-alias-menu-icon'] = t(neutralText.light.icon, neutralText.dark.icon)
  tokens['--dsw-alias-label-primary-bluish'] = t(neutralText.light.ink, neutralText.dark.ink)

  // ---- 品牌与强调 ---------------------------------------------------------
  // 官方主题在浅色下用近黑、深色下用近白做主按钮，界面因此缺少识别色。
  // 这里把品牌位交给强调色，是整套美化里视觉收益最大的一处改动。
  //
  // 下面这一组**共用同一个求解结果**：宿主把它们分别当「底」与「字」用，
  // 但官方主题里它们的取值本来就相同（都是品牌色），因此插件也保持一致 ——
  // 一个强调色就是一个身份色，不该在按钮与链接之间出现两个色阶。
  // 求解器已把所有角色（当底承载白字、当字压遍全部表面与自指淡染层）
  // 一起算进约束，所以同一个值在两种角色下都成立。
  tokens['--dsw-alias-brand-primary'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-brand-primary-invert'] = t(L.surface1, D.canvas)
  tokens['--dsw-alias-brand-text'] = t(accent.light, accent.dark)
  // 设置里的「更新可用」指示与账户提示图标都用它当文字色，底是它自己的 8% 淡染。
  // 文字支的求解已经把 8% 淡染层算进约束里，因此这里直接复用。
  tokens['--dsw-alias-brand-primary-new-colorprimary-new-color'] = t(
    accent.light,
    accent.dark
  )
  tokens['--dsw-alias-button-primary-fill'] = t(accent.light, accent.dark)
  // 悬停色是**另一个底**，压在它上面的还是同一支前景色（白/近黑），因此它也要过
  // 一遍求解。v1.1 直接朝黑/白各混 14%/16%，实测浅色下碧波青的悬停态只有 3.5 ——
  // 比常态还低，鼠标一放上去按钮文字就糊了。
  tokens['--dsw-alias-button-primary-hover'] = t(
    solveTone(tint(accent.light, '#000000', 0.14), ['#ffffff'], AA),
    solveTone(tint(accent.dark, '#ffffff', 0.16), ['#0f1115'], AA)
  )
  tokens['--dsw-alias-button-primary-dimmed'] = t(
    tint(accent.light, L.canvas, 0.82),
    tint(accent.dark, D.canvas, 0.8)
  )
  tokens['--dsw-alias-button-info-fill'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-button-info-hover'] = t(
    solveTone(tint(accent.light, '#000000', 0.12), ['#ffffff'], AA),
    solveTone(tint(accent.dark, '#ffffff', 0.14), ['#0f1115'], AA)
  )
  tokens['--dsw-alias-state-business-primary'] = t(accent.light, accent.dark)
  // 业务浅底：Tag 的 info 语气、徽标与状态标签用它当底，强调色文字压在上面。
  // 由**文字支**派生 —— 与求解文字支时假设的淡染层一致，契约才算得准。
  tokens['--dsw-alias-state-business-tertiary'] = t(
    tint(L.surface1, accent.light, 0.12),
    tint(D.surface1, accent.dark, 0.18)
  )
  tokens['--dsw-alias-link'] = t(accent.light, accent.dark)
  tokens['--dsw-focus-ring-color'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-label-deep-diving'] = t(accent.light, accent.dark)
  // 思考态的**扫光**：宿主把 `--dsw-alias-label-shimmer` 在这一处重指到
  // `-deep-diving-shimmer`（`.running { --dsw-alias-label-shimmer: var(...-deep-diving-shimmer);
  // color: var(...-deep-diving) }`），TextShimmer 再用它把正文**再画一遍**、
  // 遮罩成一条扫过的带。因此它是「同一个色相的两个明度」，
  // v1.2 只接管了其中一支（正文 = 强调色），扫光留在宿主的蓝上 ——
  // 非蓝强调色下，扫光颜色不属于用户选的那套配色。
  // 现在两支同源：扫光 = 强调色朝画布方向退一段，退到与正文刚好可分辨（≥1.5，
  // 官方自己那一对是 1.6 上下 —— 它本来就是一道若有若无的微光）。
  tokens['--dsw-alias-label-deep-diving-shimmer'] = t(
    tint(accent.light, L.canvas, THINK_SHIMMER_MIX),
    tint(accent.dark, D.canvas, THINK_SHIMMER_MIX)
  )

  // ---- 语义色（成功 / 警告 / 危险）---------------------------------------
  // 这是 v1.3 的主题。v1.2 把强调色解了出来，却把**同一张样式表里隔三行的
  // 兄弟规则**整族留给了宿主：Tag 的 info 语气被求解，success/warning/danger
  // 三个语气一条没算；差异视图的 `.add` 正文实测只有 **1.91:1**。
  // 理由与做法见 solveSemantic —— 色相锁死、只动明度。
  //
  // 这里**没有开关**：它不是一种「口味」，而是一处与 v1.2 同类（甚至更明显）的
  // 可读性缺陷 —— 「通过」徽标的正文、差异视图的新增行正文，都是要被读的内容。
  // v1.2 也没有为「把字解到达标」提供开关。
  tokens['--dsw-alias-state-success-primary'] = t(
    semantic.light.success,
    semantic.dark.success
  )
  // 淡染层：与 Tag 的 `color-mix(色 10%, transparent)` 同源，
  // 只是把它落成实色（宿主把它当 ConnectionIndicator 的底）。
  tokens['--dsw-alias-state-success-tertiary'] = t(
    tint(L.surface1, semantic.light.success, SEMANTIC_WASH.success),
    tint(D.surface1, semantic.dark.success, SEMANTIC_WASH.success)
  )
  tokens['--dsw-alias-state-success-secondary'] = t(
    semantic.light.successSoft,
    semantic.dark.successSoft
  )
  tokens['--dsw-alias-state-warn-primary'] = t(semantic.light.warn, semantic.dark.warn)
  tokens['--dsw-alias-state-warn-tertiary'] = t(
    tint(L.surface1, semantic.light.warn, SEMANTIC_WASH.warn),
    tint(D.surface1, semantic.dark.warn, SEMANTIC_WASH.warn)
  )
  // 宿主的 label 与 primary 是两支琥珀（600 / 500）。插件的求解已经保证了
  // 「同色相 + 压得住自己的淡染层」，再分两支只会让它们各自解到不同明度、
  // 于是在连接指示里同时出现两种琥珀。合成一支 —— 一个状态一个颜色。
  tokens['--dsw-alias-state-warn-label'] = t(semantic.light.warn, semantic.dark.warn)
  tokens['--dsw-alias-state-warn-secondary'] = t(
    semantic.light.warnSoft,
    semantic.dark.warnSoft
  )
  tokens['--dsw-alias-state-error-primary'] = t(semantic.light.error, semantic.dark.error)
  tokens['--dsw-alias-state-error-secondary'] = t(
    semantic.light.errorSoft,
    semantic.dark.errorSoft
  )
  // `--dsw-alias-state-idle-primary` **刻意不接管**：它是「待处理」状态点的
  // 弱化档，宿主的 1.5:1 是有意为之。理由写在 readability.js 的 UNCOVERED。

  // 差异视图的整行淡染：宿主用的是 8%（浅色）/ 12%（深色）的 alpha 绿红，
  // 由浏览器合成在半透明层上。这里保持同样的语义（一层随底色走的淡染），
  // 只把颜色换成求解后的语义色 —— 于是 `.add` 的正文终于对得上它的底。
  tokens['--dsw-alias-code-diff-added'] = t(
    alpha(semantic.light.success, DIFF_WASH.light),
    alpha(semantic.dark.success, DIFF_WASH.dark)
  )
  tokens['--dsw-alias-code-diff-deleted'] = t(
    alpha(semantic.light.error, DIFF_WASH.light),
    alpha(semantic.dark.error, DIFF_WASH.dark)
  )
  // 文件级差异：整块底、行号槽、左侧标记。宿主这三支是写死的十六进制
  // （浅色 `#e6f4e7` / `#edf7ed` / `#01a241`），完全不随预设走 ——
  // 在纸感（暖白）与午夜（冷黑）上都是一块突兀的冷绿。现在按同一支语义色
  // 在画布上派生：行底掺 10%，行号槽掺 5%（宿主的槽比行**更淡**，两种明暗都是），
  // 标记用求解后的本色。
  for (const [family, [light, dark]] of [
    ['added', [semantic.light.success, semantic.dark.success]],
    ['deleted', [semantic.light.error, semantic.dark.error]]
  ]) {
    tokens[`--dsw-alias-file-diff-${family}-bg`] = t(
      tint(L.canvas, light, 0.1),
      tint(D.canvas, dark, 0.1)
    )
    tokens[`--dsw-alias-file-diff-${family}-gutter`] = t(
      tint(L.canvas, light, 0.05),
      tint(D.canvas, dark, 0.05)
    )
    tokens[`--dsw-alias-file-diff-${family}-marker`] = t(light, dark)
  }
  tokens['--dsw-alias-interactive-bg-hover-danger'] = t(
    alpha(semantic.light.error, 0.08),
    alpha(semantic.dark.error, 0.15)
  )

  // ---- 宿主缺口的修正 -----------------------------------------------------
  // 这两个令牌**宿主从未声明过**，却有组件在消费它们。这不是猜测：
  // `scripts/audit-consumers.mjs` 把「被消费、却从未声明」的令牌从宿主样式与
  // 51 个 bundle 里枚举出来（见 reference/host-consumers.json），它们就在那张表里。
  // 缺失的后果各不相同，但都是静默的：
  //
  //   · `--dsw-alias-label-error` —— `color: var(--该令牌)` 在计算值阶段成为
  //     guaranteed-invalid，`color` 于是按 `unset` 处理（= 继承）。
  //     结果：设置页的「保存失败」提示用的是正文墨色，与普通文字一模一样，
  //     用户看不出这次保存失败了。
  //   · `--dsw-alias-bg-layer-4` —— 同理，`background` 落到 initial（transparent）。
  //     结果：设置页那个「?」帮助按钮悬停时没有底色反馈。
  //
  // 修法就是把这两支补上，并从预设里取值 —— 与 v1.0 修灯箱关闭按钮同属一类：
  // 不改宿主，只把它漏掉的那一格填上。
  tokens['--dsw-alias-label-error'] = t(semantic.light.error, semantic.dark.error)
  // 表面阶梯的第四级。宿主的 1/2/3 在浅色下全是纯白，第四级本来就是
  // 「悬停时那一点可见的差」；这里按同一支笔派生：浅色往墨色掺 6%，
  // 深色往白色掺 6%（深色下越高越亮），于是它天然是第 3 级之上的一档。
  tokens['--dsw-alias-bg-layer-4'] = t(
    tint(L.surface3, neutralText.light.ink, 0.06),
    tint(D.surface3, '#ffffff', 0.06)
  )

  // ---- 交互态 -------------------------------------------------------------
  // 这些淡染层之上压的是正文（`--dsw-alias-label-primary`）或强调色本身，
  // 因此淡染的来源统一用**文字支**：它比填充支更暗（浅色）/更亮（深色），
  // 用它算出来的淡染层与文字之间的对比度才不会在边缘上打滑。
  tokens['--dsw-alias-interactive-bg-hover'] = t(
    alpha(accent.light, 0.08),
    alpha(accent.dark, 0.12)
  )
  tokens['--dsw-alias-interactive-bg-active'] = t(
    alpha(accent.light, 0.14),
    alpha(accent.dark, 0.2)
  )
  tokens['--dsw-alias-interactive-bg-hover-accent'] = t(
    alpha(accent.light, 0.16),
    alpha(accent.dark, 0.22)
  )
  tokens['--dsw-alias-interactive-bg-hover-solid'] = t(
    tint(L.canvas, accent.light, 0.07),
    tint(D.canvas, accent.dark, 0.12)
  )
  // 幽灵激活态：底色之上压的是 `--dsw-alias-label-primary`（正文色），
  // 因此这里求解的是**底色**而不是文字色 —— 淡染太重会让正文读不清。
  tokens['--dsw-alias-button-ghost-active-fill'] = t(
    ensureContrast(tint(L.surface1, accent.light, 0.1), neutralText.light.ink, AA),
    ensureContrast(tint(D.surface1, accent.dark, 0.16), neutralText.dark.ink, AA)
  )
  tokens['--dsw-alias-button-ghost-active-hover'] = t(
    tint(L.surface1, accent.light, 0.16),
    tint(D.surface1, accent.dark, 0.24)
  )
  tokens['--dsw-alias-button-ghost-active-border'] = t(
    alpha(accent.light, 0.45),
    alpha(accent.dark, 0.5)
  )

  // ---- 气泡与选区 ---------------------------------------------------------
  // 官方气泡是 deepseek-50（极淡的品牌底）。这里换成极淡的强调色底，
  // 保持同样的「一眼区分说话人、但不抢戏」的强度。
  tokens['--dsw-specific-bubble'] = t(
    tint(L.surface1, accent.light, 0.09),
    tint(D.surface1, accent.dark, 0.15)
  )
  tokens['--dsw-specific-bubble-highlight'] = t(
    tint(L.surface1, accent.light, 0.19),
    tint(D.surface1, accent.dark, 0.27)
  )
  // 选区底：正文（label-primary）压在其上。32% 是官方强度，但强调色比官方蓝
  // 更深时这个叠加会明显变暗，因此由求解器把它挡在 AA 之外。
  tokens['--dsw-alias-bg-document-selection'] = t(
    alpha(accent.light, 0.32),
    alpha(accent.dark, 0.34)
  )

  // ---- 代码语法着色 -------------------------------------------------------
  // 宿主的九个 token 色写在 `:root` 上，深浅两套都与主题绑定却不随预设走。
  // 插件改了代码块底色之后它们就落在了没被设计过的底上（浅色下六个低于 AA）。
  // 这里按当前底色逐个求解，保持色相不变 —— 见 solveSyntax。
  for (const name of SYNTAX_TOKENS) {
    tokens[`--shiki-token-${name}`] = t(
      syntax.light[name],
      syntax.dark[name]
    )
  }

  // ---- 菜单与浮层 ---------------------------------------------------------
  tokens['--dsw-menu-surface-fill'] = t(L.menu, D.menu)
  tokens['--dsw-specific-menu'] = t(L.menu, D.menu)
  tokens['--dsw-alias-menu-group-header-fill'] = t(L.menuHeader, D.menuHeader)

  // ---- 代码与 Markdown ---------------------------------------------------
  tokens['--dsw-alias-markdown-code-block'] = t(L.code, D.code)
  tokens['--dsw-alias-markdown-code-block-banner'] = t(L.codeBanner, D.codeBanner)
  tokens['--dsw-alias-markdown-inline-code'] = t(L.inlineCode, D.inlineCode)
  tokens['--dsw-alias-markdown-citation'] = t(L.citation, D.citation)
  tokens['--dsw-alias-markdown-tag'] = t(L.tag, D.tag)
  tokens['--dsw-alias-markdown-placeholder'] = t(L.placeholder, D.placeholder)
  tokens['--dsw-alias-markdown-code-segment-selected'] = t(
    L.surface1,
    D.surface2
  )
  tokens['--dsw-alias-markdown-code-segment-unselected'] = t(
    L.codeBanner,
    D.code
  )
  tokens['--dsw-alias-turn-trigger-bg'] = t(L.code, D.codeBanner)

  // ---- 提示与轻提示 -------------------------------------------------------
  tokens['--dsw-alias-toast-bg'] = t(L.toast, D.toast)
  tokens['--dsw-alias-toast-label'] = t('#ffffff', '#f7f9fc')
  tokens['--dsw-alias-tooltip-bg'] = t(L.toast, D.toast)
  // 键帽底板要与气泡底**可分辨**（契约要求 ≥2.0；官方 2.00 / 1.82）。
  // v1.1 用的是固定 18% 白混，实测只有 1.75 —— 比官方还难分辨，属于
  // 「看着没问题、量出来才知道」的那一类。现在从同一个混合值出发按底线求解，
  // 解不出来就退回原值（不会为了达标把键帽变成一块突兀的亮片）。
  tokens['--dsw-alias-tooltip-key-bg'] = t(
    solveTone(tint(L.toast, '#ffffff', 0.18), [L.toast], TOOLTIP_KEY_MIN) ??
      tint(L.toast, '#ffffff', 0.18),
    solveTone(tint(D.toast, '#ffffff', 0.18), [D.toast], TOOLTIP_KEY_MIN) ??
      tint(D.toast, '#ffffff', 0.18)
  )

  // ---- 滚动条 -------------------------------------------------------------
  tokens['--dsw-alias-scrollbar-bg-l1'] = t(L.scrollbar, D.scrollbar)
  tokens['--dsw-alias-scrollbar-bg-l2'] = t(L.scrollbar, D.scrollbar)
  tokens['--dsw-alias-scrollbar-hover-l1'] = t(
    L.scrollbarHover,
    D.scrollbarHover
  )
  tokens['--dsw-alias-scrollbar-hover-l2'] = t(
    L.scrollbarHover,
    D.scrollbarHover
  )
  // 开关滑块：官方在浅色下用纯白、深色下用 bluish-400 灰。既然轨道被换成了
  // 强调色，滑块必须回到白系才读得出「亮点在轨道上滑动」——灰色滑块压在
  // 蓝色轨道上会糊成一片低对比。
  tokens['--dsw-alias-switch-thumb'] = t('#ffffff', '#eef3fb')

  // ---- 文档预览 -----------------------------------------------------------
  tokens['--dsw-alias-bg-document-preview'] = t(
    L.documentPreview,
    D.documentPreview
  )
  tokens['--dsw-alias-label-document-preview'] = t(
    L.documentPreviewLabel,
    D.documentPreviewLabel
  )

  // ---- 阴影阶（宿主只在 body 上声明，行内覆盖可达所有后代） -----------------
  tokens['--dsw-shadow-lv1'] = t(SL.lv1, SD.lv1)
  tokens['--dsw-shadow-lv1-blur'] = t(SL.lv1blur, SD.lv1blur)
  tokens['--dsw-shadow-lv2'] = t(SL.lv2, SD.lv2)
  tokens['--dsw-shadow-lv3'] = t(SL.lv3, SD.lv3)

  // ---- 高度（elevation）----------------------------------------------------
  // 宿主把这一族声明在 `body, body *` 上 —— 每个元素都自带声明，行内样式够不着。
  // 因此这里只交出「原语」，由 styles/elevation.css 以更高特异性组合成宿主令牌。
  tokens['--dshb-elev-stroke-color'] = t(SL.stroke, SD.stroke)
  tokens['--dshb-elev-panel'] = t(SL.panel, SD.panel)
  tokens['--dshb-elev-prominent'] = t(SL.prominent, SD.prominent)
  tokens['--dshb-elev-soft'] = t(SL.soft, SD.soft)

  // ---- 插件自有：氛围光 ---------------------------------------------------
  tokens['--dshb-ambient-a'] = t(preset.ambient.light[0], preset.ambient.dark[0])
  tokens['--dshb-ambient-b'] = t(preset.ambient.light[1], preset.ambient.dark[1])
  // 同色相零 alpha 的淡出终点，避免渐变边缘出现发灰的脏边（见 fadeOut）
  tokens['--dshb-ambient-a-fade'] = t(
    fadeOut(preset.ambient.light[0]),
    fadeOut(preset.ambient.dark[0])
  )
  tokens['--dshb-ambient-b-fade'] = t(
    fadeOut(preset.ambient.light[1]),
    fadeOut(preset.ambient.dark[1])
  )

  // ---- 圆角 ---------------------------------------------------------------
  for (const [key, name] of Object.entries(RADIUS_TOKENS)) {
    const px = `${radius.radii[key]}px`
    tokens[name] = t(px, px)
  }
  // 圆角形状：宿主把它声明在 `:root`、由 `*` 规则消费，因此 body 上的行内值
  // 能正常继承到全部后代（唯一够不着的是 `html` 自己，而它没有可见圆角）。
  // 取值必须是合法的 `corner-shape` 语法 —— 宿主那句 `@supports` 保证
  // 不支持的浏览器根本不会消费这个令牌，所以写错也只是静默无效，
  // 因此 check.mjs 直接断言三档的语法。
  tokens['--dsw-corner-shape'] = t(corner.css, corner.css)
  // Windows 标题栏模式下内容区左上角的那个圆角。宿主把它声明在 frame 元素上，
  // 行内值够不着，因此这里只交出原语，由 base.css 以更高特异性贴上去。
  tokens['--dshb-content-radius'] = t(
    `${radius.contentRadius}px`,
    `${radius.contentRadius}px`
  )

  // ---- 排版 ---------------------------------------------------------------
  if (state.typography) {
    tokens['--dsw-font-family'] = t(FONT_STACK.ui, FONT_STACK.ui)
    tokens['--ds-font-family-code'] = t(FONT_STACK.code, FONT_STACK.code)

    // Markdown 正文阶梯在宿主里是 body 上的复合令牌，行内覆盖可直达所有后代。
    // 官方基准行高 24px，中文与混排的舒适区在 25–26px；这里取 25px，
    // 并让标题阶梯同步 +1px，保持层级的相对距离不变。
    const base = 'var(--dsh-content-font-size, 14px)'
    const delta = 'var(--dsh-content-font-delta)'
    tokens['--dsw-font-markdown-base'] = t(
      `${base} / calc(25px + ${delta}) var(--dsw-font-family)`,
      `${base} / calc(25px + ${delta}) var(--dsw-font-family)`
    )
    const heading = (size, lead, weight) => {
      const value = `${weight} calc(${size}px + ${delta}) / calc(${lead}px + ${delta}) var(--dsw-font-family)`
      return t(value, value)
    }
    tokens['--dsw-font-markdown-h1'] = heading(21, 32, 700)
    tokens['--dsw-font-markdown-h1-line-height'] = t(
      `calc(32px + ${delta})`,
      `calc(32px + ${delta})`
    )
    tokens['--dsw-font-markdown-h2'] = heading(19, 29, 700)
    tokens['--dsw-font-markdown-h2-line-height'] = t(
      `calc(29px + ${delta})`,
      `calc(29px + ${delta})`
    )
    tokens['--dsw-font-markdown-h3'] = heading(18, 27, 650)
    tokens['--dsw-font-markdown-h3-line-height'] = t(
      `calc(27px + ${delta})`,
      `calc(27px + ${delta})`
    )
    tokens['--dsw-font-markdown-h4'] = heading(14, 25, 600)
    tokens['--dsw-font-markdown-h4-line-height'] = t(
      `calc(25px + ${delta})`,
      `calc(25px + ${delta})`
    )
  }

  // ---- 毛玻璃 -------------------------------------------------------------
  if (!state.glass) {
    // 关掉菜单/浮层的背景模糊，换成近乎不透明的填充，避免半透明层叠导致的
    // 文字对比度下降（低端 GPU 上还能省一次合成）。
    tokens['--dsw-menu-backdrop-filter'] = t('none', 'none')
    tokens['--dsw-mask-blur'] = t('none', 'none')
    tokens['--dsw-menu-surface-fill'] = t(L.surface1, D.surface2)
    tokens['--dsw-specific-menu'] = t(L.surface1, D.surface2)
    tokens['--dsw-alias-menu-group-header-fill'] = t(L.surface1, D.surface2)
  }

  return tokens
}
