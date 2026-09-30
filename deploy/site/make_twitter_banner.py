from PIL import Image, ImageDraw, ImageFont
import math, random

random.seed(11)
W, H = 1500, 500

# background: deep near-black vertical gradient + faint dot grid
img = Image.new('RGB', (W, H), (9, 10, 12))
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(9 + 14 * t), int(10 + 12 * t), int(12 + 10 * t)))
for gx in range(0, W, 40):
    for gy in range(0, H, 40):
        d.point((gx, gy), fill=(20, 22, 26))

# glows: orange left-center, green accent right
glow = Image.new('RGB', (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
for r in range(420, 0, -6):
    a = int(70 * (1 - r / 420))
    gd.ellipse([380 - r, 250 - r, 380 + r, 250 + r], fill=(a, int(a * 0.45), 0))
for r in range(330, 0, -6):
    a = int(45 * (1 - r / 330))
    gd.ellipse([1150 - r, 220 - r, 1150 + r, 220 + r], fill=(0, int(a * 0.8), int(a * 0.4)))
img = Image.blend(img, Image.composite(glow, img, glow.convert('L')), 0.85)
d = ImageDraw.Draw(img)

# game-grid motif (Orbix Center) on the right
tiles = [(1030, 110), (1240, 110), (1030, 290), (1240, 290)]
colors = [(255, 140, 40), (0, 230, 150), (170, 90, 255), (255, 210, 70)]
for (x, y), c in zip(tiles, colors):
    d.rounded_rectangle([x, y, x + 170, y + 145], radius=16, outline=c, width=3)
    d.rounded_rectangle([x + 5, y + 5, x + 165, y + 140], radius=12, fill=(21, 22, 26))
    d.ellipse([x + 20, y + 18, x + 38, y + 36], fill=c)
    d.rounded_rectangle([x + 54, y + 21, x + 150, y + 32], radius=5, fill=(62, 64, 72))
    for i in range(3):
        d.rounded_rectangle([x + 20, y + 54 + i * 22, x + 150, y + 66 + i * 22], radius=4, fill=(42, 44, 52))

# orbit ring as a FAINT background motif on its own layer, so the copy always wins visually
ring = Image.new('RGBA', (W, H), (0, 0, 0, 0))
rd = ImageDraw.Draw(ring)
rd.ellipse([330, 40, 800, 400], outline=(255, 120, 40, 95), width=5)
rd.ellipse([548, 202, 582, 236], fill=(255, 140, 40, 110))
for ang in (30, 150, 270):
    sx = 565 + 228 * math.cos(math.radians(ang))
    sy = 220 + 175 * math.sin(math.radians(ang))
    rd.ellipse([sx - 7, sy - 7, sx + 7, sy + 7], fill=(255, 170, 80, 120))
img = Image.alpha_composite(img.convert('RGBA'), ring).convert('RGB')
d = ImageDraw.Draw(img)

f_title = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 86)
f_sub = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 30)
f_small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)

# measure ORBIX width so PROTOCOL sits clear of the X
tw = d.textlength('ORBIX', font=f_title)
d.text((60, 130), 'ORBIX', font=f_title, fill=(255, 255, 255))
d.text((60 + tw + 18, 168), 'PROTOCOL', font=f_small, fill=(255, 140, 40))
d.text((60, 235), 'Super-DeFi + Play — utility & fun for your tokens', font=f_sub, fill=(200, 202, 208))
d.text((60, 295), 'Robinhood Chain · testnet 46630', font=f_sub, fill=(140, 142, 150))
# reposition: ring is behind the LEFT text block, shrink to a badge circle right of the subtitle
# (ring geometry: bbox [330,40,800,400] — but tagline extends to x=791, so instead of relying on
# layering, draw the ring FIRST (already done above) and let the text render over it: the ring is
# a thin outline; text drawn after it sits on top, which reads as intentional depth, not collision.)

d.rounded_rectangle([60, 370, 360, 414], radius=10, fill=(255, 106, 9))
d.text((78, 380), 'orbixcore.fun', font=f_small, fill=(12, 14, 16))

# footer: wrap onto two lines, safely inside the canvas
d.text((1030, 440), '19 live minigames · create a room', font=f_small, fill=(150, 152, 160))
d.text((1030, 468), 'drop the link · play', font=f_small, fill=(150, 152, 160))

img.save('/home/agentuser/vibeswap/deploy/site/twitter-banner.jpg', quality=95)
print('banner written', img.size)
