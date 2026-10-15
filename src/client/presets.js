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
export function buildTokens(state) {
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
