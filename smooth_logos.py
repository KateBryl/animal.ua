from pathlib import Path
from PIL import Image, ImageFilter, ImageEnhance

folder = Path(r'D:\Work\Animal.ua\extracted_logos')
for p in folder.glob('*.png'):
    im = Image.open(p).convert('RGBA')
    rgb = im.convert('RGB')
    alpha = im.getchannel('A')
    # Remove residual pale fringe, then make the edge transition continuous.
    alpha = alpha.point(lambda v: 0 if v < 45 else min(255, int((v - 45) * 1.22)))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.45))
    # Neutralize the warm paper tint in the surviving logo pixels.
    rgb = Image.new('RGB', im.size, (57, 52, 47))
    # Render at 2x and downsample once with Lanczos for smoother curves.
    scale = 2
    rgb = rgb.resize((rgb.width * scale, rgb.height * scale), Image.Resampling.LANCZOS)
    alpha = alpha.resize((alpha.width * scale, alpha.height * scale), Image.Resampling.LANCZOS)
    alpha = alpha.filter(ImageFilter.UnsharpMask(radius=1.0, percent=90, threshold=3))
    # Keep the original dark logo colors while preventing light paper pixels at the edge.
    out = Image.merge('RGBA', (*rgb.split(), alpha))
    out = out.filter(ImageFilter.UnsharpMask(radius=0.7, percent=80, threshold=2))
    out.save(p, optimize=True)
    print(p.name, out.size)
