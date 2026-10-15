"""按坐标采样截图里的像素颜色，用于核对令牌是否真的落到了控件上。

用法：python verify/sample.py <png> <x> <y> [<x> <y> ...]
坐标是 PNG 像素；截图按 2x 缩放，因此 CSS 坐标要乘 2。
"""

import sys

from PIL import Image

path = sys.argv[1]
image = Image.open(path).convert("RGB")
coords = [int(v) for v in sys.argv[2:]]
print(f"{path}  size={image.size}")
for i in range(0, len(coords), 2):
    x, y = coords[i], coords[i + 1]
    r, g, b = image.getpixel((x, y))
    print(f"  ({x:5d},{y:5d})  #{r:02x}{g:02x}{b:02x}   rgb({r},{g},{b})")
