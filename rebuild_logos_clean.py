from pathlib import Path
from PIL import Image, ImageFilter
src=Image.open(r'C:\Users\kateb\AppData\Local\Temp\codex-clipboard-606c21eb-ebf3-4d0e-ac96-4dec10ac7ddc.png').convert('RGB')
out=Path(r'D:\Work\Animal.ua\extracted_logos')
boxes={'royal-canin':(20,14,133,59),'zoetis':(203,20,303,55),'purina':(360,24,478,53),'idexx':(547,25,647,50),'vetexpert':(716,18,823,54),'hills':(875,8,927,64)}
for name,box in boxes.items():
    crop=src.crop(box); a=Image.new('L',crop.size,0)
    for y in range(crop.height):
        for x in range(crop.width):
            r,g,b=crop.getpixel((x,y)); d=255-max(r,g,b)
            a.putpixel((x,y),0 if d<50 else min(255,int((d-46)*6.0)))
    bb=a.getbbox(); crop=crop.crop(bb); a=a.crop(bb)
    pad=10; canvas=Image.new('L',(a.width+2*pad,a.height+2*pad),0); canvas.paste(a,(pad,pad))
    canvas=canvas.resize((canvas.width*8,canvas.height*8),Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.35))
    color=Image.new('RGBA',canvas.size,(57,52,47,0)); color.putalpha(canvas)
    color.save(out/f'{name}.png',optimize=True)
