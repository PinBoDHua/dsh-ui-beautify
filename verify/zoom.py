"""放大截图里的某个区域，用来目视检查细节（例如圆是不是真的圆）。

用法：python verify/zoom.py <png> <x> <y> <w> <h> <out.png> [倍数]
坐标是 PNG 像素。
"""

import sys

from PIL import Image

src, x, y, w, h, out = (
    sys.argv[1],
    int(sys.argv[2]),
    int(sys.argv[3]),
    int(sys.argv[4]),
    int(sys.argv[5]),
    sys.argv[6],
)
factor = int(sys.argv[7]) if len(sys.argv) > 7 else 4

image = Image.open(src).convert("RGB")
box = (x, y, min(x + w, image.width), min(y + h, image.height))
crop = image.crop(box)
crop = crop.resize((crop.width * factor, crop.height * factor), Image.NEAREST)
crop.save(out)
print(f"{src} {box} -> {out} {crop.size[0]}x{crop.size[1]} (x{factor})")
