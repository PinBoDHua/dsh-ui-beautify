window.__ModuleLoader__.load({
	id: "dsh-ui-beautify",
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
		const React = require("react")

// ---- src/client/presets.js ---------------------------------------
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
 * ## 命名约定
 * - `--dsw-*`：宿主官方令牌，覆盖它即改变宿主组件外观。
 * - `--dshb-*`：本插件自有令牌（b = beautify）。它们只作为原语存在，
 *   由 styles/*.css 组合成宿主令牌 —— 用于那些宿主在每个元素上重声明、
 *   因此行内样式够不着的令牌（`--dsw-elevation-*`）。
 */

/** 把一对明暗值包成宿主要求的形状。 */
const t = (light, dark) => ({ light, dark })

/**
 * 强调色。`light` 用于浅色主题（压暗以保证白底对比度），`dark` 用于深色主题
 * （提亮以保证深底对比度）。二者不是同一个色相的简单透明度变化，而是分别调校，
 * 因此这里显式写两遍。
 */
const ACCENTS = [
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
const RADIUS_SCALES = [
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
 * 四个预设。
 *
 * `neutral` 是每个预设的「表面与墨色」骨架，明暗各一组；`shadow` 是该预设的
 * 阴影气质（冷调/中性/深黑/暖调）；`ambient` 是氛围光叠加层的两组光斑颜色。
 * 品牌色不写死在这里 —— 它来自用户选中的强调色，见 buildTokens。
 */
const PRESETS = [
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

/** 把十六进制颜色取出 r/g/b，用于生成实色推导。 */
function rgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16))
}

/**
 * 把 `color` 按 `amount` 的比例混进 `base`，返回实色十六进制。
 *
 * 参数顺序刻意写成「底色在前、掺入色在后」，因为绝大多数调用都是
 * 「往画布/表面上掺一点强调色」；反过来写（先写强调色再写比例）极易读成
 * 「强调色占 amount」，从而把 12% 的淡染写成 88% 的实色 —— 这是本插件第一版
 * 真的踩过的坑：侧栏选中态与用户气泡变成了高饱和实色块。
 * 需要压暗强调色时，把 base 传成强调色、color 传成 #000000 即可。
 *
 * @param base - 底色（十六进制）。
 * @param color - 要掺入的颜色（十六进制）。
 * @param amount - 掺入比例，0..1。
 */
function tint(base, color, amount) {
  const a = rgb(base)
  const b = rgb(color)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amount))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** 强调色叠加 alpha（两位十六进制）。 */
function alpha(hex, a) {
  return `${hex}${Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')}`
}

/**
 * 把 8 位十六进制色的 alpha 归零，得到「同色相、全透明」的版本。
 *
 * 渐变里不能用 CSS 的 `transparent` 关键字收尾：它等于 `rgb(0 0 0 / 0)`，
 * 而 sRGB 插值会把中途的颜色往**黑**里带，于是本该干净淡出的光斑边缘
 * 会出现一圈发灰的脏边。用同色相零 alpha 才能淡出自己的颜色。
 */
function fadeOut(color) {
  return `${color.slice(0, 7)}00`
}

/**
 * 由「预设 + 强调色 + 圆角 + 若干开关」算出完整的令牌覆盖层。
 *
 * @param state - 当前外观状态（见 state.js 的 normalizeState）。
 * @returns 令牌名 → { light, dark }。
 */
function buildTokens(state) {
  const preset = PRESETS.find((p) => p.id === state.preset) ?? PRESETS[0]
  const accent = ACCENTS.find((a) => a.id === state.accent) ?? ACCENTS[0]
  const radius = RADIUS_SCALES.find((r) => r.id === state.radius) ?? RADIUS_SCALES[1]
  const L = preset.neutral.light
  const D = preset.neutral.dark
  const SL = preset.shadow.light
  const SD = preset.shadow.dark

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
    tint(L.sidebar, accent.light, 0.13),
    tint(D.sidebar, accent.dark, 0.19)
  )
  tokens['--dsw-specific-sidebar-nav-item-active-accent'] = t(
    accent.light,
    accent.dark
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
  tokens['--dsw-alias-border-inverted'] = t(L.border3, D.border2)
  tokens['--dsw-alias-border-inverted2'] = t(L.border2, D.border1)

  // ---- 文本与图标 ---------------------------------------------------------
  tokens['--dsw-alias-label-primary'] = t(L.ink, D.ink)
  tokens['--dsw-alias-label-primary-dimmed'] = t(L.inkDimmed, D.inkDimmed)
  tokens['--dsw-alias-label-primary-inverted'] = t(L.surface1, D.surface1)
  tokens['--dsw-alias-label-secondary'] = t(L.inkSecondary, D.inkSecondary)
  tokens['--dsw-alias-label-tertiary'] = t(L.inkTertiary, D.inkTertiary)
  tokens['--dsw-alias-label-caption'] = t(L.inkCaption, D.inkCaption)
  tokens['--dsw-alias-label-dimmed'] = t(L.border4, D.border3)
  tokens['--dsw-alias-menu-icon'] = t(L.icon, D.icon)
  tokens['--dsw-alias-label-primary-bluish'] = t(L.ink, D.ink)

  // ---- 品牌与强调 ---------------------------------------------------------
  // 官方主题在浅色下用近黑、深色下用近白做主按钮，界面因此缺少识别色。
  // 这里把品牌位交给强调色，是整套美化里视觉收益最大的一处改动。
  tokens['--dsw-alias-brand-primary'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-brand-primary-invert'] = t(L.surface1, D.canvas)
  tokens['--dsw-alias-brand-text'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-brand-primary-new-colorprimary-new-color'] = t(
    accent.light,
    accent.dark
  )
  tokens['--dsw-alias-button-primary-fill'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-button-primary-hover'] = t(
    tint(accent.light, '#000000', 0.14),
    tint(accent.dark, '#ffffff', 0.16)
  )
  tokens['--dsw-alias-button-primary-dimmed'] = t(
    tint(accent.light, L.canvas, 0.82),
    tint(accent.dark, D.canvas, 0.8)
  )
  tokens['--dsw-alias-button-info-fill'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-button-info-hover'] = t(
    tint(accent.light, '#000000', 0.12),
    tint(accent.dark, '#ffffff', 0.14)
  )
  tokens['--dsw-alias-state-business-primary'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-state-business-tertiary'] = t(
    tint(accent.light, L.surface1, 0.88),
    tint(accent.dark, D.surface1, 0.82)
  )
  tokens['--dsw-alias-link'] = t(accent.light, accent.dark)
  tokens['--dsw-focus-ring-color'] = t(accent.light, accent.dark)
  tokens['--dsw-alias-label-deep-diving'] = t(accent.light, accent.dark)

  // ---- 交互态 -------------------------------------------------------------
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
  tokens['--dsw-alias-button-ghost-active-fill'] = t(
    tint(L.surface1, accent.light, 0.1),
    tint(D.surface1, accent.dark, 0.16)
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
  tokens['--dsw-alias-bg-document-selection'] = t(
    alpha(accent.light, 0.32),
    alpha(accent.dark, 0.34)
  )

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
  tokens['--dsw-alias-tooltip-key-bg'] = t(
    tint(L.toast, '#ffffff', 0.18),
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

// ---- src/client/state.js -----------------------------------------
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
const DEFAULT_STATE = Object.freeze({
  enabled: true,
  preset: 'aurora',
  accent: 'deepseek',
  radius: 'standard',
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
const STRING_KEYS = ['preset', 'accent', 'radius']

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
function normalizeState(raw, options) {
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
    if (Array.isArray(allowed) && allowed.length > 0) {
      if (allowed.includes(value)) next[key] = value
    } else {
      next[key] = value
    }
  }
  return next
}

/** 读持久化状态；任何异常（隐私模式、配额、JSON 损坏）都回落到默认值。 */
function loadState(options) {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    return normalizeState(JSON.parse(raw), options)
  } catch {
    return { ...DEFAULT_STATE }
  }
}

/** 写持久化状态；写失败不影响本次会话内的生效（状态已在内存里）。 */
function saveState(state) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 持久化失败是可接受的降级：本次会话仍然按所选外观渲染 */
  }
}

// ---- src/client/styles.generated.js ------------------------------
/**
 * 本文件由 scripts/build.mjs 生成，请勿手工编辑。
 * 修改样式请编辑 src/client/styles/*.css，然后运行 `node scripts/build.mjs`。
 */
const STYLES = [
  ["base", "/*\n * 界面美化 · Lumina —— 基础层：画布氛围、选区、滚动条、交互过渡。\n *\n * 规则约束（与宿主 docs/web-styling 的取向一致）：\n *   1. 只使用三类稳定选择器 —— 元素选择器、ARIA role/状态属性、\n *      宿主明确设置的 data-* 属性；\n *   2. 需要覆盖宿主令牌化属性时，用 `html body` 前缀提升特异性，\n *      不写 !important（inline 令牌本来就该由 overrideTokens 负责）；\n *   3. CSS Module 的类名形如 `{hash}_{local}`，哈希随构建变化，\n *      因此只在确有必要时用 `[class*='_local']` 这种与哈希无关的后缀匹配，\n *      匹配不到时静默降级，绝不报错。\n */\n\n/* ------------------------------------------------------------------ *\n * 1. 页面根：把主题色透出到浏览器/窗口底色，并保住 body 背景的可预测性\n * ------------------------------------------------------------------ */\n\nhtml body {\n  background-color: var(--dsw-alias-bg-base);\n}\n\n/* ------------------------------------------------------------------ *\n * 2. 氛围光\n *\n *    只挂在**侧栏列**上。这一条是踩过坑之后收紧的：\n *\n *    最初同时挂在框架（`[class*='_frame']`）上。框架本来被两列完全盖住，\n *    唯一露出来的地方是 Windows 标题栏模式下中心列左上角那个\n *    `border-radius: 16px` 的圆角 —— 而 background-image 的默认原点\n *    （background-origin: padding-box）恰好就在内容区左上角。于是那个圆角\n *    里露出的是光斑**最亮的那一点**，被圆角切成一块带硬边的蓝色楔形，\n *    在浅色下非常显眼。\n *\n *    框架不需要氛围光：它可见的部分只有标题栏拖拽带（被 `:before` 盖住）\n *    和上述圆角露出的区域，而那两处应当是与侧栏连续的纯色。\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-ambient='on'] body [class*='_sidebarCol'] {\n  background-image: radial-gradient(\n      120% 55% at 0% 0%,\n      var(--dshb-ambient-a),\n      var(--dshb-ambient-a-fade) 70%\n    ),\n    radial-gradient(\n      120% 50% at 100% 100%,\n      var(--dshb-ambient-b),\n      var(--dshb-ambient-b-fade) 72%\n    );\n  /* radial-gradient 默认就铺满整个盒子，no-repeat 对它是空操作，\n     写出来只会让下一个人以为这里有平铺行为。 */\n}\n\n/* ------------------------------------------------------------------ *\n * 3. 文本选区：官方是 40% 蓝，这里改为强调色，与品牌位保持一致\n * ------------------------------------------------------------------ */\n\nhtml body ::selection {\n  background-color: var(--dsw-alias-bg-document-selection);\n}\n\n/* ------------------------------------------------------------------ *\n * 4. 滚动条：官方 5px 无边框。这里给滑块留出 1.5px 透明边，视觉更细但\n *    命中区域不变宽（宽度由 --dsh-scrollbar-width 决定，保持 6px）。\n *    WebKit 路径走伪元素；Firefox 路径由 scrollbar.css 的宽细标准接管。\n * ------------------------------------------------------------------ */\n\nhtml body {\n  --dsh-scrollbar-width: 6px;\n  --dsh-scrollbar-thumb-border: 1.5px;\n  --dsh-scrollbar-track-margin: 4px;\n}\n\n/* ------------------------------------------------------------------ *\n * 5. 交互过渡\n *    只过渡「颜色类」属性 —— 布局属性加过渡会造成拖拽/折叠时的粘滞感。\n *    尊重 prefers-reduced-motion：命中时整段失效。\n * ------------------------------------------------------------------ */\n\n@media (prefers-reduced-motion: no-preference) {\n  html[data-dshb-motion='on']\n    body\n    :is(\n      button,\n      a,\n      summary,\n      input,\n      textarea,\n      select,\n      [role='button'],\n      [role='menuitem'],\n      [role='menuitemcheckbox'],\n      [role='menuitemradio'],\n      [role='option'],\n      [role='tab'],\n      [role='switch'],\n      [role='checkbox'],\n      [role='radio']\n    ) {\n    transition: background-color var(--ds-transition-duration-fast)\n        var(--ds-ease-in-out),\n      border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),\n      color var(--ds-transition-duration-fast) var(--ds-ease-in-out),\n      box-shadow var(--ds-transition-duration-fast) var(--ds-ease-in-out),\n      opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);\n  }\n\n  /* 浮层与卡片入场时给一点高度变化，避免菜单「凭空出现」 */\n  html[data-dshb-motion='on'] body [data-menu-material],\n  html[data-dshb-motion='on'] body [role='dialog'],\n  html[data-dshb-motion='on'] body [role='menu'],\n  html[data-dshb-motion='on'] body [role='listbox'] {\n    transition: opacity var(--ds-transition-duration) var(--ds-ease-in-out),\n      transform var(--ds-transition-duration) var(--ds-ease-in-out),\n      box-shadow var(--ds-transition-duration) var(--ds-ease-in-out);\n  }\n}\n\n/* ------------------------------------------------------------------ *\n * 6. 焦点环：颜色已由 --dsw-focus-ring-color 令牌接管（随强调色走），\n *    这里只补一点外发光，让键盘焦点在复杂卡片上更容易被找到。\n * ------------------------------------------------------------------ */\n\nhtml body :focus-visible {\n  outline-offset: 2px;\n}\n\n/* ------------------------------------------------------------------ *\n * 7. 内容区圆角\n *\n *    Windows 标题栏模式下，宿主把中心列左上角切成\n *    `border-radius: var(--dsh-windows-content-radius) 0 0 0; corner-shape: round`，\n *    那个圆角露出的正是框架底色 —— 也就是侧栏填充色。它是整块内容区视觉上\n *    最靠外的一个圆角，必须与相邻表面（卡片、面板）用同一支笔。\n *\n *    宿主把该令牌声明在 frame 元素**自身**上（`[data-windows-titlebar]\n *    .xxx_frame`，特异性 0,0,2,0），body 上的行内值只够被继承，够不着它。\n *    因此这里用 `html body [class*='_frame']`（0,0,2,1）覆盖，取值来自插件\n *    原语 `--dshb-content-radius`，与圆角档位联动。\n *\n *    宿主同时写了 `corner-shape: round`：这个角是**正圆**，不是全局的方圆形。\n *    保持不动 —— 它是内容区最外沿的轮廓，跟随全局方圆形会让四个角与窗口\n *    自身的圆角对不上。\n * ------------------------------------------------------------------ */\n\nhtml body [class*='_frame'] {\n  --dsh-windows-content-radius: var(--dshb-content-radius);\n}\n"],
  ["elevation", "/*\n * 界面美化 · Lumina —— 高度（elevation）令牌重组层。\n *\n * ## 为什么这一层必须存在\n * 宿主 gradient-shadow-text.css 把 `--dsw-elevation-*` 声明在 `body, body *` 上 ——\n * 也就是**每一个元素都自带一份声明**。插件通过 ctx.theme.overrideTokens 拿到的\n * 是 body 上的行内样式，行内值只能被继承；元素自带的声明优先于继承，所以行内\n * 覆盖对这一族令牌完全无效（这是宿主令牌体系里唯一一处这样的例外）。\n *\n * ## 怎么解\n * 插件改为交出「原语」：--dshb-elev-stroke-color / --dshb-elev-panel 等，\n * 它们没有第二个声明点，行内值可正常继承到所有后代；再由本表把这些原语组合成\n * 宿主令牌。选择器写成 `html body` / `html body *`，特异性严格高于宿主的\n * `body` / `body *`，因此不依赖样式表顺序、也不需要 !important。\n */\n\nhtml body,\nhtml body * {\n  --dsw-elevation-stroke: 0 0 0 0.5px var(--dshb-elev-stroke-color);\n  --dsw-elevation-panel: var(--dsw-elevation-stroke), var(--dshb-elev-panel);\n  --dsw-elevation-prominent: var(--dsw-elevation-stroke),\n    var(--dshb-elev-prominent);\n  --dsw-elevation-soft: var(--dsw-elevation-stroke), var(--dshb-elev-soft);\n}\n\n/*\n * 宿主在深色模式下给菜单材质换了一根更亮的描边色。官方值来自 border-l3，\n * 这里改用本预设的 stroke 原语，让菜单描边与其余浮层保持同一支笔。\n * 选择器特异性 (0,0,2,2) 高于宿主的 (0,0,2,1)。\n */\nhtml body[data-ds-dark-theme] [data-menu-material],\nhtml body [data-menu-material] {\n  --dsw-elevation-stroke-color: var(--dshb-elev-stroke-color);\n}\n"],
  ["typography", "/*\n * 界面美化 · Lumina —— 内容排版精修层（可用 data-dshb-typography 整体关闭）。\n *\n * 这一层处理令牌表达不了的东西：字形平滑、等宽数字、代码块与引用块的细节。\n * 全部使用元素选择器 —— 它们由宿主 Markdown 渲染器产出，与 CSS Module 哈希无关，\n * 因此跨版本稳定；代价是无法区分「会话里的表格」与「插件面板里的表格」，\n * 这对视觉一致性而言反而是好事。\n *\n * 打开/关闭由 <html data-dshb-typography=\"on|off\"> 控制。\n */\n\n/* ------------------------------------------------------------------ *\n * 1. 字形渲染\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-typography='on'] body {\n  -webkit-font-smoothing: antialiased;\n  -moz-osx-font-smoothing: grayscale;\n  text-rendering: optimizeLegibility;\n}\n\n/* 中文正文在 system-ui 下字距偏挤；0.01em 是几乎察觉不到、但整页读起来更松的量 */\nhtml[data-dshb-typography='on'] body :is(p, li, dd, dt, td, th) {\n  letter-spacing: 0.01em;\n}\n\n/* 表格、代码、时间戳里的数字等宽，列才对得齐 */\nhtml[data-dshb-typography='on'] body :is(table, code, kbd, samp, pre) {\n  font-variant-numeric: tabular-nums;\n  font-feature-settings: 'tnum' 1, 'cv05' 1;\n}\n\n/* ------------------------------------------------------------------ *\n * 2. 代码\n * ------------------------------------------------------------------ */\n\n/* 行内代码：官方只给底色，这里补一根极淡描边，让它从正文里「浮」起来 */\nhtml body :not(pre) > code {\n  border: 1px solid var(--dsw-alias-border-l1);\n  border-radius: var(--dsw-radius-xs);\n  padding: 0.1em 0.34em;\n}\n\n/* 代码块：**刻意不动 `<pre>`**。\n *\n * 第一版给所有 `pre` 加了边框 + 圆角 + 顶部内高光，理由是「大面积实色显得扁平」。\n * 那是个错误：宿主的代码块把视觉身份放在 `pre` 自己身上 ——\n *\n *   .block { border-radius: var(--dsw-radius-lg); background: … }        ← 卡片\n *   .block :where(pre) { padding: 16px; background: …;\n *                        border-bottom-*-radius: var(--dsw-radius-lg) }   ← pre 自带圆角\n *\n * 于是我的规则会在卡片内部套出第二层细圆角边框。官方基线是**单层干净卡片**，\n * 而带这条规则的版本能在验证台里肉眼看出那个内框\n * （见 verify/out/panels-official-light.png 与 panels-pre-border-aurora-light.png\n * 的对照，夹具 `?bug=pre-border` 就是这条被删掉的规则）。\n *\n * 代码块与正文的区分已经由令牌层完成：`--dsw-alias-markdown-code-block` 与\n * `-banner` 都随预设调整过。样式表再叠一层，收益是零，代价是打一架。\n */\n\n/* ------------------------------------------------------------------ *\n * 3. 引用与分隔\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-typography='on'] body blockquote {\n  border-inline-start: 3px solid var(--dsw-alias-state-business-primary);\n  border-radius: 0 var(--dsw-radius-sm) var(--dsw-radius-sm) 0;\n  padding-inline-start: 0.85em;\n}\n\nhtml[data-dshb-typography='on'] body hr {\n  border: 0;\n  border-top: 1px solid var(--dsw-alias-border-l2);\n}\n\n/* ------------------------------------------------------------------ *\n * 4. 表格\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-typography='on'] body th {\n  background-color: var(--dsw-alias-markdown-code-block-banner);\n}\n\nhtml[data-dshb-typography='on'] body table {\n  border-radius: var(--dsw-radius-sm);\n  overflow: clip;\n}\n\n/* ------------------------------------------------------------------ *\n * 5. 链接与图片\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-typography='on'] body a {\n  text-underline-offset: 0.22em;\n  text-decoration-thickness: 0.06em;\n}\n\nhtml[data-dshb-typography='on'] body :is(img, video) {\n  border-radius: var(--dsw-radius-sm);\n}\n"],
  ["task-list", "/*\n * 界面美化 · Lumina —— 任务列表面板增强（可用 data-dshb-tasklist 整体关闭）。\n *\n * ## 要解决的问题\n * 宿主的 TodoPanel 三态在视觉上几乎不可分：任务项文字**恒为同一种**\n * `--dsw-alias-label-secondary`，状态只由一个 6px 的状态点承担 —— 已完成是绿点、\n * 进行中是转圈、待处理是灰点。十几行排下来，扫一眼得到的印象是「都差不多」，\n * 于是「做完了没有」这个问题在面板上读不出来。\n *\n * 另外列表 `max-height: 180px` 配 `overflow-y: auto`，行高 28px 不是整数倍，\n * 最后一行常常被硬切成两半，且没有任何「还能滚」的提示 —— 看起来像渲染坏了。\n *\n * ## 做了什么\n * 1. 把状态差从「6px 圆点」放大到「整行可辨」：\n *    已完成 → 文字降权 + 删除线；进行中 → 强调色淡染行底 + 左侧强调条 + 文字加重；\n *    待处理 → 保持宿主原样（它是基线，不需要被强调）。\n * 2. 列表底部加渐隐，并在末尾留出与渐隐等高的空白 —— 滚到底时渐隐落在空白上，\n *    最后一行不会被误伤；未滚到底时渐隐正好压住被切开的半行，把「硬切」\n *    变成「下面还有」的提示。\n * 3. 表头是 `<button>`，宿主没给 hover 反馈；补上，并保持图标横向位置不变。\n *\n * ## 选择器约定\n * 只用宿主**有意暴露**的钩子：面板根的 `data-testid=\"todo-panel\"`、\n * 任务项的 `data-status=\"completed|in_progress|pending\"`（封闭联合，来自\n * ui-conversation 的 TodoItem 类型）、以及 `aria-expanded`。\n * 全程不碰 `.aSus8q_item` 这类编译哈希类名 —— 宿主改一次构建就会失效。\n *\n * 内容节点用 `> span:last-child` 定位：任务项固定只有两个子元素\n * （状态点 span + 内容 span），这个结构由 JSX 决定，比类名稳定。\n */\n\n/* ------------------------------------------------------------------ *\n * 1. 状态阶梯\n * ------------------------------------------------------------------ */\n\n/* 已完成：降权 + 删除线。删除线用描边色而不是文字色，\n   让「划掉」这件事读得出来、又不至于抢走正文的注意力。 */\nhtml[data-dshb-tasklist='on']\n  body\n  [data-testid='todo-panel']\n  li[data-status='completed']\n  > span:last-child {\n  color: var(--dsw-alias-label-caption);\n  text-decoration: line-through;\n  text-decoration-color: var(--dsw-alias-border-l4);\n  text-decoration-thickness: 1px;\n}\n\n/* 进行中：这一行是「现在正在做的事」，给它最强的视觉权重。\n   左右各 6px 的负外边距与内边距配成一对，行被撑宽了 12px 又收回 12px，\n   状态点与文字的横向位置与其他行严格对齐。 */\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] li[data-status='in_progress'] {\n  position: relative;\n  margin-inline: -6px;\n  padding-inline: 6px;\n  border-radius: var(--dsw-radius-xs);\n  background: var(--dsw-alias-interactive-bg-hover-accent);\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n}\n\n/* 左侧强调条。绝对定位的包含块是行的内边距盒，inset-inline-start: 0\n   因此落在行的左边缘，而不是文字起点。 */\nhtml[data-dshb-tasklist='on']\n  body\n  [data-testid='todo-panel']\n  li[data-status='in_progress']::before {\n  content: '';\n  position: absolute;\n  inset-inline-start: 0;\n  inset-block: 2px;\n  width: 2px;\n  border-radius: 1px;\n  background: var(--dsw-alias-state-business-primary);\n}\n\n/* 待处理刻意不做任何样式：三档里只有它保持宿主原样，\n   另外两档的差异才有参照物。 */\n\n/* ------------------------------------------------------------------ *\n * 2. 列表溢出：底部渐隐\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] ul {\n  padding-block-end: 12px;\n  mask-image: linear-gradient(\n    to bottom,\n    #000 calc(100% - 12px),\n    transparent 100%\n  );\n}\n\n/* ------------------------------------------------------------------ *\n * 3. 表头：它是个按钮，宿主没给可点的反馈\n * ------------------------------------------------------------------ */\n\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] button {\n  margin-inline: -6px;\n  padding-inline: 6px;\n  border-radius: var(--dsw-radius-sm);\n}\n\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] button:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\nhtml[data-dshb-tasklist='on'] body [data-testid='todo-panel'] button:focus-visible {\n  outline: var(--dsw-focus-ring-width, 2px) solid\n    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));\n  outline-offset: 1px;\n}\n"],
  ["safety", "/*\n * 界面美化 · Lumina —— 安全修正层。\n *\n * 这一层不放任何装饰。它只修一个宿主自身的问题：**页面控件被原生窗口按钮盖住，\n * 用户点到的是「关闭程序」**。\n *\n * ## 问题\n * Windows 上宿主用 Electron 的 `titleBarOverlay` 画最小化/最大化/关闭三个按钮。\n * 它们不在 DOM 里 —— Chromium 把它们绘制在页面**之上**，占位约\n * `top: 0..40px`、`right: 0..138px`（高度来自 host preload 写入的\n * `--dsh-windows-titlebar-height: 40px`）。\n *\n * 而图片灯箱的关闭按钮是：\n *\n *   .close { position: fixed; top: 20px; right: 20px; width: 36px; height: 36px }\n *   （宿主 ui-primitives 的 ImageLightbox.module.css）\n *\n * 它整个落在那三个原生按钮的下半部分里。因为原生覆盖层在上，点击被它截走 ——\n * 用户点「图片的 ✕」，程序被关掉。这是可复现的误操作，不是观感问题。\n *\n * ## 修法\n * 把灯箱关闭按钮挪到标题栏覆盖层**下方**。位移量不写死，而是用宿主自己发布的\n * `--dsh-frame-overlay-top`：ui-layout 把它定义为\n * `calc(--dsh-frame-top-clearance + 20px)`，而全屏时宿主会把它降回 20px ——\n * 全屏下原生按钮本就不显示，关闭按钮自动回到原位，不需要插件再加一条全屏判断。\n *\n * ## 选择器\n * 用与哈希无关的后缀匹配：编译后的类名形如 `_backdrop_1hos8_1` / `_close_1hos8_29`。\n * 全应用只有一个 `_backdrop` 类（图片灯箱），因此\n * `[class*='_backdrop'] [class*='_close_']` 唯一且稳定。匹配不到时静默降级 ——\n * 宿主哪天自己修好了，这条规则自动失效，不会有副作用。\n *\n * `scripts/check.mjs` 会断言这条规则始终挂在 `[data-windows-titlebar]` 下并引用\n * 宿主变量；`scripts/audit-caption-collision.mjs` 可在宿主升级后重新全量排查。\n */\n\nhtml[data-windows-titlebar] body [class*='_backdrop'] [class*='_close_'] {\n  top: var(--dsh-frame-overlay-top, 60px);\n}\n"],
  ["panel", "/*\n * 界面美化 · Lumina —— 设置面板样式。\n *\n * 类名统一用 `dshb-` 前缀的普通全局类（不是 CSS Module）：面板组件由本插件\n * 拥有，前缀足以避免与宿主及其它插件冲突，同时也省掉一层构建期哈希。\n *\n * 全部颜色都读宿主令牌，因此面板会跟随浅色/深色与所选预设一起变。\n *\n * ## 正圆与胶囊必须写 corner-shape: round\n * 宿主的 corner-shape.css 通过 `*,:before,:after { corner-shape: superellipse(1.5) }`\n * 把**所有**圆角平滑成方圆形。这对卡片、输入框是想要的效果，但会把\n * `border-radius: 50%` 的圆和 `999px` 的胶囊压变形。宿主自己的约定是：\n * 正圆形状需在所属组件样式表里把 `corner-shape: round` 与半径声明配对。\n * 本文件里四处圆（色板、预设色点、开关轨道、开关滑块）都遵守这一约定。\n * 不支持 corner-shape 的引擎会忽略该声明，退化成普通圆弧 —— 正是想要的。\n */\n\n.dshb-root {\n  display: flex;\n  flex-direction: column;\n  gap: 20px;\n  color: var(--dsw-alias-label-primary);\n  font-family: var(--dsw-font-family);\n  font-size: var(--dsh-content-font-size-secondary, 13px);\n}\n\n/* ---------------------------------------------------------------- 头部 */\n\n.dshb-head {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 16px;\n}\n\n.dshb-title {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 600;\n  line-height: 24px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshb-subtitle {\n  margin: 4px 0 0;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-tertiary);\n  max-width: 46ch;\n}\n\n/* ------------------------------------------------------------ 主体容器 */\n\n.dshb-body {\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n  border: 1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4));\n  border-radius: var(--dsw-radius-md);\n  background-color: var(\n    --dsw-alias-settings-card-fill,\n    var(--dsw-alias-bg-layer-2)\n  );\n  padding: 4px 16px;\n}\n\n/* 总开关关闭时整块降饱和并禁用交互，明确表达「已停用」 */\n.dshb-body-off {\n  opacity: 0.45;\n  filter: saturate(0.4);\n  pointer-events: none;\n}\n\n/* ------------------------------------------------------------------ 行 */\n\n.dshb-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  padding: 14px 0;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.dshb-row:last-child {\n  border-bottom: 0;\n}\n\n.dshb-row-text {\n  min-width: 0;\n}\n\n.dshb-row-title {\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dshb-row-hint {\n  margin-top: 2px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshb-row-control {\n  flex: none;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n/* ------------------------------------------------------------- 预设卡片 */\n\n.dshb-group {\n  padding: 14px 0;\n  border-bottom: 1px solid var(--dsw-alias-border-l1);\n}\n\n.dshb-group-title {\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 20px;\n  margin-bottom: 10px;\n}\n\n.dshb-cards {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));\n  gap: 10px;\n}\n\n.dshb-card {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-start;\n  gap: 6px;\n  padding: 12px;\n  cursor: pointer;\n  text-align: left;\n  font: inherit;\n  color: var(--dsw-alias-label-primary);\n  background-color: var(--dsw-alias-bg-layer-1);\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n}\n\n.dshb-card:hover:not(:disabled) {\n  background-color: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshb-card-active {\n  border-color: var(--dsw-alias-state-business-primary);\n  box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary) inset;\n  background-color: var(--dsw-alias-interactive-bg-hover-accent);\n}\n\n.dshb-card:disabled {\n  cursor: default;\n}\n\n.dshb-card-dots {\n  display: flex;\n  gap: 4px;\n}\n\n.dshb-card-dot {\n  width: 14px;\n  height: 14px;\n  border-radius: 50%;\n  /* 正圆：必须显式关掉宿主的 superellipse，否则会被压成方圆形 */\n  corner-shape: round;\n  box-shadow: 0 0 0 1px var(--dsw-alias-border-l4) inset;\n}\n\n.dshb-card-name {\n  font-size: 13px;\n  font-weight: 500;\n  line-height: 18px;\n}\n\n.dshb-card-tagline {\n  font-size: 11px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* --------------------------------------------------------------- 色板 */\n\n.dshb-swatches {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n  justify-content: flex-end;\n}\n\n.dshb-swatch {\n  width: 24px;\n  height: 24px;\n  padding: 0;\n  border-radius: 50%;\n  /* 正圆：同上，宿主会给所有元素套 superellipse */\n  corner-shape: round;\n  cursor: pointer;\n  border: 0;\n  /* 面板可能在深色下，样式表按当前主题挑选明/暗两支强调色 */\n  background-color: var(--dshb-swatch-light);\n  box-shadow: 0 0 0 1px var(--dsw-alias-border-l4) inset;\n}\n\nbody[data-ds-dark-theme] .dshb-swatch {\n  background-color: var(--dshb-swatch-dark);\n}\n\n.dshb-swatch-active {\n  /* 中间那圈「空隙」必须用面板**实际所在的表面色**，不能用画布色：\n     面板坐在设置卡片上（--dsw-alias-settings-card-fill = bg-layer-2），\n     而画布色是 bg-base —— 深色下两者相差明显（#0c1017 vs #1b2230），\n     用画布色会在选中色板周围留下一圈发暗的光晕。 */\n  box-shadow: 0 0 0 1px var(--dsw-alias-border-l4) inset,\n    0 0 0 3px var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-base)),\n    0 0 0 5px var(--dsw-alias-state-business-primary);\n}\n\n.dshb-swatch:disabled {\n  cursor: default;\n}\n\n/* ----------------------------------------------------------- 分段选择器 */\n\n.dshb-segmented {\n  display: inline-flex;\n  padding: 2px;\n  gap: 2px;\n  border-radius: var(--dsw-radius-sm);\n  background-color: var(--dsw-alias-bg-layer-3);\n  border: 1px solid var(--dsw-alias-border-l2);\n}\n\n.dshb-segment {\n  padding: 4px 12px;\n  font: inherit;\n  font-size: 12px;\n  line-height: 18px;\n  cursor: pointer;\n  border: 0;\n  border-radius: calc(var(--dsw-radius-sm) - 3px);\n  background-color: transparent;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dshb-segment:hover:not(:disabled) {\n  color: var(--dsw-alias-label-primary);\n  background-color: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dshb-segment-active,\n.dshb-segment-active:hover:not(:disabled) {\n  background-color: var(--dsw-alias-bg-layer-1);\n  color: var(--dsw-alias-label-primary);\n  font-weight: 500;\n  box-shadow: var(--dsw-elevation-stroke, 0 0 0 0.5px var(--dsw-alias-border-l4)),\n    0 1px 3px 0 rgb(0 0 0 / 8%);\n}\n\n/* --------------------------------------------------------------- 开关 */\n\n.dshb-switch {\n  position: relative;\n  width: 36px;\n  height: 20px;\n  padding: 0;\n  cursor: pointer;\n  border: 0;\n  border-radius: 999px;\n  /* 胶囊：superellipse 会让两端不再是半圆 */\n  corner-shape: round;\n  background-color: var(--dsw-alias-interactive-bg-active);\n  transition: background-color var(--ds-transition-duration-fast)\n    var(--ds-ease-in-out);\n}\n\n.dshb-switch[aria-checked='true'] {\n  background-color: var(--dsw-alias-state-business-primary);\n}\n\n.dshb-switch-thumb {\n  position: absolute;\n  top: 2px;\n  left: 2px;\n  width: 16px;\n  height: 16px;\n  border-radius: 50%;\n  /* 正圆：同上 */\n  corner-shape: round;\n  background-color: var(--dsw-alias-switch-thumb);\n  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 24%);\n  transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out);\n}\n\n.dshb-switch[aria-checked='true'] .dshb-switch-thumb {\n  transform: translateX(16px);\n}\n\n/* --------------------------------------------------------------- 页脚 */\n\n.dshb-foot {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 16px;\n  font-size: 12px;\n  line-height: 18px;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dshb-foot-note {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n/* 版本号：插件走热替换，没有可见版本号就只能靠猜「我到底装上了没有」 */\n.dshb-version {\n  flex: none;\n  padding: 1px 6px;\n  border-radius: 999px;\n  corner-shape: round;\n  font-family: var(--ds-font-family-code);\n  font-size: 11px;\n  line-height: 16px;\n  color: var(--dsw-alias-label-secondary);\n  background-color: var(--dsw-alias-bg-layer-3);\n  border: 1px solid var(--dsw-alias-border-l2);\n}\n\n.dshb-reset {\n  flex: none;\n  padding: 5px 12px;\n  font: inherit;\n  font-size: 12px;\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n  background-color: transparent;\n  border: 1px solid var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-sm);\n}\n\n.dshb-reset:hover {\n  color: var(--dsw-alias-label-primary);\n  background-color: var(--dsw-alias-interactive-bg-hover);\n}\n\n/* 尊重系统的减少动效偏好：本插件自己的过渡也一并停掉 */\n@media (prefers-reduced-motion: reduce) {\n  .dshb-switch,\n  .dshb-switch-thumb {\n    transition: none;\n  }\n}\n"]
]

// ---- src/client/controller.js ------------------------------------
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





/** 主题覆盖层的身份。同一 source 重复调用会整体替换旧层，所以它必须稳定。 */
const SOURCE = 'dsh-ui-beautify'

/** 各枚举键的合法取值，用于把持久化数据里的陈旧 id 挡掉。 */
const KNOWN = {
  preset: PRESETS.map((p) => p.id),
  accent: ACCENTS.map((a) => a.id),
  radius: RADIUS_SCALES.map((r) => r.id)
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
  radius: 'data-dshb-radius'
}

/**
 * 建立外观控制器。
 *
 * @param options.theme - 宿主的 ui-theme 服务（提供 overrideTokens）。
 * @param options.doc - 文档对象，默认取全局 document；测试可注入替身。
 * @returns 控制器 API。
 */
function createController(options) {
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

  /** 通知所有订阅者。面板以整对象替换触发重渲染。 */
  function emit() {
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
   * 把外观推给宿主。令牌层永远保持存在（哪怕空对象）而不是反复增删，
   * 这样「关闭 → 打开」不会在宿主侧留下需要跟踪的悬挂 disposer。
   */
  function projectTokens() {
    if (!theme || typeof theme.overrideTokens !== 'function') return
    theme.overrideTokens(SOURCE, state.enabled ? buildTokens(state) : {})
  }

  /** 全量投射一次。 */
  function project() {
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
        raf(() => {
          motionReady = true
          projectAttributes()
        })
      } else {
        motionReady = true
        projectAttributes()
      }
      return () => {
        unmountStyles()
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

// ---- src/client/version.generated.js -----------------------------
/**
 * 本文件由 scripts/build.mjs 生成，请勿手工编辑。
 * 版本号的事实来源是 package.json。
 */
const VERSION = "1.1.0"

// ---- src/client/panel.js -----------------------------------------
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
function BeautifyPanel(props) {
  const controller = props.controller
  const t = props.t
  const [state, setState] = React.useState(() => controller.getState())

  React.useEffect(() => controller.subscribe(setState), [controller])

  const disabled = !state.enabled
  const update = (patch) => controller.setState(patch)

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
                '--dshb-swatch-light': accent.light,
                '--dshb-swatch-dark': accent.dark
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

// ---- src/client/locales.js ---------------------------------------
/**
 * 界面美化 · Lumina —— 设置面板词典。
 *
 * 中英两份键集必须完全一致：宿主在开发期会校验字典完整性，缺键在切换语言时
 * 会露出 key 本身而不是文案。
 */

/** 简体中文（键集的事实来源）。 */
const zh = {
  nav: '界面美化',
  title: '界面美化',
  subtitle: '为 DSH 换一套视觉语言：配色、层次、圆角与排版。改动即时生效。',
  preset: '预设风格',
  accent: '强调色',
  accentHint: '用于主按钮、选中态与链接',
  radius: '圆角',
  radiusHint: '影响卡片、输入框与弹层',
  ambient: '氛围光',
  ambientHint: '在侧栏叠一层低透明度光斑',
  typography: '内容精修',
  typographyHint: '行高、字距、代码块与表格细节',
  taskList: '任务列表增强',
  taskListHint: '三态一眼可辨：已完成降权划线，进行中高亮',
  glass: '毛玻璃',
  glassHint: '关闭后菜单改为近乎不透明的实色',
  motion: '过渡动效',
  motionHint: '仅过渡颜色，不影响布局与拖拽',
  footer: '偏好保存在本机浏览器，不写入会话配置。',
  reset: '恢复默认'
}

/** English，键集与 zh 一一对应。 */
const en = {
  nav: 'UI Beautify',
  title: 'UI Beautify',
  subtitle:
    'Give DSH a new visual language: palette, depth, radii and typography. Changes apply instantly.',
  preset: 'Preset',
  accent: 'Accent',
  accentHint: 'Used for primary buttons, selection and links',
  radius: 'Corner radius',
  radiusHint: 'Affects cards, inputs and popovers',
  ambient: 'Ambient light',
  ambientHint: 'Adds a low-opacity glow to the sidebar',
  typography: 'Content polish',
  typographyHint: 'Line height, letter spacing, code and tables',
  taskList: 'Task list clarity',
  taskListHint: 'Done fades out, in-progress stands out',
  glass: 'Translucent menus',
  glassHint: 'Turn off for near-opaque menu surfaces',
  motion: 'Transitions',
  motionHint: 'Colour only — layout and dragging are untouched',
  footer: 'Preferences stay in this browser, not in session config.',
  reset: 'Reset'
}

// ---- src/client/index.js -----------------------------------------
/**
 * 界面美化 · Lumina —— 客户端插件入口。
 *
 * 本文件是 bundle 的入口，构建脚本（scripts/build.mjs）会把它与同目录下的
 * 模块拼成一个 `window.__ModuleLoader__.load({ id, factory })` 的经典脚本。
 * 之所以手写而不是用 tsdown/rolldown：宿主模块加载器只保证 `react`、
 * `react-dom`、`react/jsx-runtime` 与 `@deepseek-ai/*` 可 require，插件自身的
 * 代码不依赖任何第三方包，因此一套零依赖的拼接式构建就够，且产物可逐行审阅。
 */





/** 插件 id，必须与 package.json 的 name 一致 —— 加载器用它做模块登记。 */
const NS = 'dsh-ui-beautify'

const name = NS

/**
 * 依赖的客户端服务。
 * - `theme`：唯一的外观写入通道（overrideTokens）。
 * - `slots`：把设置面板挂进「设置」分区。
 * - `locale`：中英文案。
 */
const inject = ['theme', 'slots', 'locale']

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
function apply(ctx) {
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

		exports.apply = apply
		exports.inject = inject
		exports.name = name
		return module.exports
	}
})
