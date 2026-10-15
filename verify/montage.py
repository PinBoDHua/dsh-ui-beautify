"""把单张截图拼成对比图，便于一眼看出「官方原版 / 插件令牌」的差异。

用法：python verify/montage.py

每张对比图带标题与逐格标注；标注文字用系统中文字体，取不到时回落到
Pillow 内置字体（此时中文会显示成方块，但仍能在文件层面确认拼图成功）。
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"

PANEL_WIDTH = 880          # 每格的缩放后宽度
LABEL_HEIGHT = 34          # 每格顶部标注条高度
GAP = 12
MARGIN = 18
TITLE_HEIGHT = 46
BACKGROUND = (24, 26, 30)
LABEL_BG = (38, 41, 47)
LABEL_FG = (232, 236, 243)
TITLE_FG = (255, 255, 255)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhl.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
]


def load_font(size: int) -> ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


FONT_LABEL = load_font(19)
FONT_TITLE = load_font(26)


def panel(path: Path, label: str) -> Image.Image:
    """把一张截图缩放成带标注条的单元格。"""
    image = Image.open(path).convert("RGB")
    scale = PANEL_WIDTH / image.width
    image = image.resize(
        (PANEL_WIDTH, max(1, round(image.height * scale))), Image.LANCZOS
    )
    cell = Image.new(
        "RGB", (PANEL_WIDTH, image.height + LABEL_HEIGHT), LABEL_BG
    )
    cell.paste(image, (0, LABEL_HEIGHT))
    draw = ImageDraw.Draw(cell)
    draw.text((12, 7), label, font=FONT_LABEL, fill=LABEL_FG)
    return cell


def montage(title: str, items: list[tuple[Path, str]], cols: int, out: Path) -> None:
    """按给定列数拼图并写出。"""
    cells = [panel(path, label) for path, label in items]
    rows = (len(cells) + cols - 1) // cols
    cell_w = PANEL_WIDTH
    cell_h = max(cell.height for cell in cells)
    width = MARGIN * 2 + cell_w * cols + GAP * (cols - 1)
    height = (
        TITLE_HEIGHT
        + MARGIN * 2
        + cell_h * rows
        + GAP * (rows - 1)
    )
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.text((MARGIN, 12), title, font=FONT_TITLE, fill=TITLE_FG)

    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        x = MARGIN + col * (cell_w + GAP)
        y = TITLE_HEIGHT + MARGIN + row * (cell_h + GAP)
        canvas.paste(cell, (x, y))

    canvas.save(out)
    print(f"  {out.name:34} {canvas.size[0]}x{canvas.size[1]}  {out.stat().st_size // 1024} KB")


def shots(prefix: str, state: str, mode: str) -> Path:
    return OUT / f"{prefix}-{state}-{mode}.png"


print("生成对比图：")

montage(
    "会话界面 · 浅色 —— 官方原版 vs 插件令牌",
    [
        (shots("shell", "official", "light"), "官方原版（近黑白品牌位 · 全白表面 · 极淡描边）"),
        (shots("shell", "aurora", "light"), "极光 · 深海蓝（强调色品牌位 · 冷调分层 · 氛围光）"),
    ],
    2,
    OUT / "compare-shell-light.png",
)

montage(
    "会话界面 · 深色 —— 官方原版 vs 插件令牌",
    [
        (shots("shell", "official", "dark"), "官方原版（近白品牌位 · 中性灰表面）"),
        (shots("shell", "aurora", "dark"), "极光 · 深海蓝（蓝黑画布 · 提亮表面 · 氛围光）"),
    ],
    2,
    OUT / "compare-shell-dark.png",
)

montage(
    "四个预设 · 浅色",
    [
        (shots("shell", "official", "light"), "官方原版"),
        (shots("shell", "aurora", "light"), "极光 · 冷调分层"),
        (shots("shell", "midnight", "light"), "午夜 · 高对比"),
        (shots("shell", "graphite", "light"), "石墨 · 中性克制"),
        (shots("shell", "paper", "light"), "纸感 · 暖白墨色"),
        (shots("shell", "violet", "light"), "极光 · 星云紫（换强调色）"),
    ],
    3,
    OUT / "presets-light.png",
)

montage(
    "四个预设 · 深色",
    [
        (shots("shell", "official", "dark"), "官方原版"),
        (shots("shell", "aurora", "dark"), "极光 · 蓝黑画布"),
        (shots("shell", "midnight", "dark"), "午夜 · 深邃高对比"),
        (shots("shell", "graphite", "dark"), "石墨 · 中性克制"),
        (shots("shell", "paper", "dark"), "纸感 · 暖夜"),
        (shots("shell", "violet", "dark"), "极光 · 星云紫（换强调色）"),
    ],
    3,
    OUT / "presets-dark.png",
)

montage(
    "浮层与材质（菜单毛玻璃 / 卡片高度 / 提示气泡）",
    [
        (shots("overlay", "official", "light"), "官方原版 · 浅色"),
        (shots("overlay", "aurora", "light"), "极光 · 浅色"),
        (shots("overlay", "official", "dark"), "官方原版 · 深色"),
        (shots("overlay", "aurora", "dark"), "极光 · 深色"),
    ],
    2,
    OUT / "compare-overlay.png",
)

montage(
    "插件设置面板（面板本身也用宿主令牌着色）",
    [
        (shots("panel", "official", "light"), "官方令牌 · 浅色"),
        (shots("panel", "aurora", "light"), "极光 · 浅色"),
        (shots("panel", "official", "dark"), "官方令牌 · 深色"),
        (shots("panel", "aurora", "dark"), "极光 · 深色"),
    ],
    2,
    OUT / "compare-panel.png",
)

def zoom(src: Path, box: tuple[int, int, int, int], factor: int, out: Path) -> Image.Image:
    """裁一块并放大，用于检查圆角这类细节。"""
    image = Image.open(src).convert("RGB")
    x, y, w, h = box
    crop = image.crop((x, y, min(x + w, image.width), min(y + h, image.height)))
    crop = crop.resize((crop.width * factor, crop.height * factor), Image.NEAREST)
    crop.save(out)
    return crop


def strip(title: str, crops: list[tuple[Image.Image, str]], out: Path) -> None:
    """横向排一组等宽放大图，带各自的说明条。"""
    width = sum(c.width for c, _ in crops) + GAP * (len(crops) - 1) + MARGIN * 2
    height = TITLE_HEIGHT + MARGIN * 2 + max(c.height for c, _ in crops) + LABEL_HEIGHT
    canvas = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.text((MARGIN, 12), title, font=FONT_TITLE, fill=TITLE_FG)
    x = MARGIN
    for crop, label in crops:
        banner = Image.new("RGB", (crop.width, LABEL_HEIGHT), LABEL_BG)
        ImageDraw.Draw(banner).text((10, 7), label, font=FONT_LABEL, fill=LABEL_FG)
        y = TITLE_HEIGHT + MARGIN
        canvas.paste(banner, (x, y))
        canvas.paste(crop, (x, y + LABEL_HEIGHT))
        x += crop.width + GAP
    canvas.save(out)
    print(f"  {out.name:34} {canvas.size[0]}x{canvas.size[1]}  {out.stat().st_size // 1024} KB")


# 圆角修复对照：官方基线 / 缺陷复现（回归夹具） / 修复后。
# 三张来自**同一轮渲染**、同一裁剪框、同一放大倍数，因此取景严格一致；
# 其中「复现」那张只多了一条已被删除的规则（见 preview.html 的 ?bug=ambient-frame）。
CORNER_BOX = (400, 86, 190, 108)


def load(path: Path) -> Image.Image:
    return Image.open(path).convert("RGB")


corner_sources = [
    ("frame-official-light.png", "官方基线：圆角内是连续的侧栏底色"),
    (
        "frame-ambient-frame-aurora-light.png",
        "缺陷复现：氛围光原点落在内容区左上角，被圆角切成硬边蓝楔形",
    ),
    ("frame-aurora-light.png", "修复后：氛围光只作用于侧栏，圆角恢复为连续纯色"),
]
missing = [name for name, _ in corner_sources if not (OUT / name).exists()]
if missing:
    print(f"  跳过圆角对照图，缺少：{missing}")
else:
    strip(
        "内容区左上角圆角 · 同一裁剪框 6 倍放大 —— 缺陷复现与修复",
        [
            (
                zoom(OUT / name, CORNER_BOX, 6, OUT / f"zoom-{Path(name).stem}.png"),
                label,
            )
            for name, label in corner_sources
        ],
        OUT / "compare-corner.png",
    )

# 安全修正对照：灯箱关闭按钮 vs 原生标题栏覆盖层占位。
# 同样的同源夹具思路（?bug=caption-overlap 抽掉 safety.css），两图取自同一轮渲染。
CAPTION_BOX = (1150, 0, 650, 260)
caption_sources = [
    (
        "lightbox-caption-overlap-aurora-light.png",
        "修正前：灯箱的 ✕ 与原生窗口 ✕ 占位重叠，上半被盖住 —— 点击落到「关闭程序」",
    ),
    (
        "lightbox-aurora-light.png",
        "修正后：灯箱的 ✕ 整体落到覆盖层下方，完全可点",
    ),
]
missing = [name for name, _ in caption_sources if not (OUT / name).exists()]
if missing:
    print(f"  跳过标题栏对照图，缺少：{missing}")
else:
    strip(
        "图片灯箱关闭按钮 × Windows 原生标题栏覆盖层（红框为覆盖层占位）",
        [
            (
                zoom(OUT / name, CAPTION_BOX, 3, OUT / f"zoom-caption-{i}.png"),
                label,
            )
            for i, (name, label) in enumerate(caption_sources)
        ],
        OUT / "compare-caption-safety.png",
    )

print(f"\n对比图已写入 {OUT}")
