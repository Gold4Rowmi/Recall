# Draws every app icon from the brand grid at whole pixels, so no size is scaled or blurred. Run from the repo root.
from pathlib import Path
from PIL import Image

SHELL, COLORS = (0x6A, 0xA8, 0xF5, 255), {'#': (0x16, 0x18, 0x1D, 255), 't': (0xD9, 0x89, 0x3B, 255), 'e': (0xF4, 0xF5, 0xF7, 255)}
DOG = ['..##..##..', '##########', '###t##t###', '##########', '#.#e##e#.#', '..t####t..', '..#tttt#..', '...t##t...', '....##....', '..........']

def tile(size, rounded):
    # 12 x 12 grid: the Idle mark with 1 unit of shell around it. Spare pixels become shell, centred.
    im = Image.new('RGBA', (size, size), SHELL)
    u = size // 12
    pad = (size - 12 * u) // 2 + u
    for y, row in enumerate(DOG):
        for x, c in enumerate(row):
            if c != '.':
                im.paste(COLORS[c], (pad + x * u, pad + y * u, pad + (x + 1) * u, pad + (y + 1) * u))
    if rounded:  # radius 1/6 of the tile, hard edged so only brand colours appear
        r = size / 6
        for y in range(int(r)):
            for x in range(int(r)):
                if (r - x - .5) ** 2 + (r - y - .5) ** 2 > r * r:
                    for p in ((x, y), (size - 1 - x, y), (x, size - 1 - y), (size - 1 - x, size - 1 - y)):
                        im.putpixel(p, (0, 0, 0, 0))
    return im

icons = Path('src-tauri/icons')
for f in [*icons.rglob('*.png'), Path('src-tauri/app-icon.png')]:
    w, h = Image.open(f).size
    if w == h:
        tile(w, not {'android', 'ios'} & set(f.parts)).save(f)

ico = [tile(s, True) for s in (16, 24, 32, 48, 64, 256)]
ico[-1].save(icons / 'icon.ico', sizes=[(i.width, i.width) for i in ico], append_images=ico[:-1])
icns = [tile(s, True) for s in (16, 32, 64, 128, 256, 512, 1024)]
icns[-1].save(icons / 'icon.icns', append_images=icns[:-1])

web = Path('ui/icons')  # full bleed: phones draw their own corners
web.mkdir(exist_ok=True)
for s in (48, 192, 768):
    tile(s, False).save(web / f'icon-{s}.png')
