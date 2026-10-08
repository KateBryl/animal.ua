from PIL import Image, ImageFilter
from pathlib import Path

src = Path(r'C:\Users\kateb\AppData\Local\Temp\codex-clipboard-606c21eb-ebf3-4d0e-ac96-4dec10ac7ddc.png')
out = Path(r'D:\Work\Animal.ua\extracted_logos')
out.mkdir(exist_ok=True)
im = Image.open(src).convert('RGBA')
boxes = {'royal-canin': (20,14,133,59), 'zoetis': (203,20,303,55), 'purina': (360,24,478,53), 'idexx': (547,25,647,50), 'vetexpert': (716,18,823,54), 'hills': (875,8,927,64)}
for name, box in boxes.items():
    crop = im.crop(box)
    rgb = crop.convert('RGB')
    alpha = Image.new('L', crop.size, 0)
    for y in range(crop.height):
        for x in range(crop.width):
            r, g, b = rgb.getpixel((x, y))
            darkness = max(0, 255 - max(r, g, b))
            alpha.putpixel((x, y), 0 if darkness < 38 else min(255, int((darkness - 34) * 5.8)))
    crop.putalpha(alpha)
    bbox = alpha.getbbox()
    if bbox:
        crop = crop.crop(bbox)
    pad = 10
    canvas = Image.new('RGBA', (crop.width + 2*pad, crop.height + 2*pad), (0,0,0,0))
    canvas.alpha_composite(crop, (pad, pad))
    canvas = canvas.resize((canvas.width*4, canvas.height*4), Image.Resampling.LANCZOS)
    canvas = canvas.filter(ImageFilter.UnsharpMask(radius=1.2, percent=130, threshold=2))
    canvas.save(out / f'{name}.png')
print(*sorted(str(p) for p in out.glob('*.png')), sep='\n')
