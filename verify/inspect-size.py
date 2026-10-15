"""核对各截图的像素尺寸，并沿一条水平线找出侧栏与内容区的分界位置。

用途：确认「同一裁剪框」在不同截图里落到的 CSS 位置是否一致 ——
如果某次渲染的 devicePixelRatio 不同，按像素硬编码的裁剪框就会取到不同区域，
对照图也就失去意义。`verify/montage.py` 依赖这一点成立。

用法：python verify/inspect-size.py [截图名 ...]
不传参数时检查一组默认的框架视图截图。
"""

import sys
from pathlib import Path

from PIL import Image

OUT = Path(__file__).resolve().parent / "out"

DEFAULT_NAMES = [
    "frame-official-light.png",
    "frame-aurora-light.png",
    "frame-paper-light.png",
    "zoom-corner-official.png",
    "zoom-corner-aurora-fixed.png",
]

names = sys.argv[1:] or DEFAULT_NAMES

for name in names:
    path = OUT / name
    if not path.exists():
        print(f"{name:34} 缺失")
        continue
    image = Image.open(path).convert("RGB")
    width, height = image.size
    # 在第 40 行（设备像素）扫出第一处明显的颜色跳变，作为侧栏↔内容区的边界
    edge = None
    row = min(40, height - 1)
    prev = image.getpixel((0, row))
    for x in range(1, width):
        cur = image.getpixel((x, row))
        if sum(abs(a - b) for a, b in zip(cur, prev)) > 6:
            edge = x
            break
        prev = cur
    print(f"{name:34} {width:5d}x{height:<5d}  第 {row} 行首个跳变 x={edge}")
