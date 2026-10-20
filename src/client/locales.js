/**
 * 界面美化 · Lumina —— 设置面板词典。
 *
 * 中英两份键集必须完全一致：宿主在开发期会校验字典完整性，缺键在切换语言时
 * 会露出 key 本身而不是文案。
 */

/** 简体中文（键集的事实来源）。 */
export const zh = {
  nav: '界面美化',
  title: '界面美化',
  subtitle: '为 DSH 换一套视觉语言：配色、层次、圆角与排版。改动即时生效。',
  enabled: '启用界面美化',
  enabledHint: '关闭后立即恢复 DSH 官方外观',
  preset: '预设风格',
  accent: '强调色',
  accentHint: '用于主按钮、选中态与链接',
  radius: '圆角',
  radiusHint: '影响卡片、输入框与弹层',
  corner: '圆角形状',
  cornerHint: '圆角是正圆还是方圆形；圆形按钮与胶囊始终是正圆',
  typeScale: '内容字号',
  typeScaleHint: '调整消息正文与标题阶梯；默认舒适档与 DSH 一致，随「内容精修」开关生效',
  readability: '可读性',
  readabilityHint: '全部文字与底色的对比度下限（WCAG AA）',
  readabilityWorst: '最低',
  readabilityChecks: '检查项',
  readabilityFailing: '未达标',
  readabilityPass: '全部达标',
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
export const en = {
  nav: 'UI Beautify',
  title: 'UI Beautify',
  subtitle:
    'Give DSH a new visual language: palette, depth, radii and typography. Changes apply instantly.',
  enabled: 'Enable UI Beautify',
  enabledHint: 'Turn off to restore the official DSH appearance',
  preset: 'Preset',
  accent: 'Accent',
  accentHint: 'Used for primary buttons, selection and links',
  radius: 'Corner radius',
  radiusHint: 'Affects cards, inputs and popovers',
  corner: 'Corner shape',
  cornerHint: 'Round or squircle corners; circles and pills stay round',
  typeScale: 'Content size',
  typeScaleHint:
    'Scale message text and headings; comfortable matches DSH by default and follows the content polish switch',
  readability: 'Legibility',
  readabilityHint: 'Lowest text-on-surface contrast across the palette (WCAG AA)',
  readabilityWorst: 'Lowest',
  readabilityChecks: 'Checks',
  readabilityFailing: 'below target',
  readabilityPass: 'all pass',
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
