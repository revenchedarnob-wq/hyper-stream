import os
from PIL import Image, ImageFilter, ImageEnhance

src_dir = r"C:\Users\arnob\Downloads\Upscaled"
out_dir = r"A:\Hyper-stream\app-preview\public\wallpapers"
os.makedirs(out_dir, exist_ok=True)

items = [
    {
        "src": "neon_background.jpg_2K_20260912222919.jpeg",
        "sharp": "bg-neon-waves.jpg",
        "frosted": "bg-neon-waves-frosted.webp",
        "type": "neon",
        "target_size": (2560, 1440),
    },
    {
        "src": "beauty_scene.jpg_2K_20260912230448.jpeg",
        "sharp": "bg-ghibli.jpg",
        "frosted": "bg-ghibli-frosted.webp",
        "type": "ghibli",
        "target_size": (2560, 1440),
    },
    {
        "src": "Blue_Curved_Lines_Projects____2K_20260912230509.jpeg",
        "sharp": "bg-violet-discs.jpg",
        "frosted": "bg-violet-discs-frosted.webp",
        "type": "glass",
        "target_size": (2560, 1440),
    },
    {
        "src": "background.jpg_2K_20260912230511.jpeg",
        "sharp": "bg-silk-loop.jpg",
        "frosted": "bg-silk-loop-frosted.webp",
        "type": "glass",
        "target_size": (2560, 1440),
    },
    {
        "src": "download_(2).jpg_2K_20260912230454.jpeg",
        "sharp": "bg-amber-flow.jpg",
        "frosted": "bg-amber-flow-frosted.webp",
        "type": "amber",
        "target_size": (2560, 1440),
    },
    {
        "src": "let_(1).jpg_2K_20260912230520.jpeg",
        "sharp": "bg-rose-petals.jpg",
        "frosted": "bg-rose-petals-frosted.webp",
        "type": "pastel",
        "target_size": (2560, 1440),
    },
    {
        "src": "업데이트___아이클릭아트.jpg_2K_20260912230502.jpeg",
        "sharp": "bg-prism-wave.jpg",
        "frosted": "bg-prism-wave-frosted.webp",
        "type": "prism",
        "target_size": (2560, 1440),
    },
]

for item in items:
    src_path = os.path.join(src_dir, item["src"])
    if not os.path.exists(src_path):
        print("Missing:", src_path)
        continue
    img = Image.open(src_path).convert("RGB")
    tw, th = item["target_size"]
    w, h = img.size
    scale = max(tw / w, th / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    img_scaled = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left, top = (nw - tw) // 2, (nh - th) // 2
    sharp_img = img_scaled.crop((left, top, left + tw, top + th))

    # Save sharp version with optimal compression
    sharp_path = os.path.join(out_dir, item["sharp"])
    sharp_img.save(sharp_path, "JPEG", quality=95, optimize=True)

    # Process tailored cinema optical bokeh
    itype = item["type"]
    if itype == "neon":
        # Photonic bloom for neon highlights
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=80))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=38))
        base_frosted = Image.blend(atmos, bokeh, 0.40)
        gray = sharp_img.convert("L")
        mask = gray.point(lambda p: int(((p / 255.0) ** 2.0) * 255)).filter(
            ImageFilter.GaussianBlur(radius=28)
        )
        glow = ImageEnhance.Color(sharp_img).enhance(1.85)
        glow = ImageEnhance.Brightness(glow).enhance(1.22).filter(
            ImageFilter.GaussianBlur(radius=34)
        )
        bloomed = Image.composite(glow, base_frosted, mask)
        frosted = Image.blend(base_frosted, bloomed, 0.50)
        frosted = ImageEnhance.Color(frosted).enhance(1.30)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.06)
    elif itype == "ghibli":
        # Atmospheric landscape dispersion + anime color grade
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=75))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=35))
        frosted = Image.blend(atmos, bokeh, 0.42)
        frosted = ImageEnhance.Color(frosted).enhance(1.38)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.05)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.06)
    elif itype == "amber":
        # Liquid metallic caramel diffusion
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=70))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=32))
        frosted = Image.blend(atmos, bokeh, 0.40)
        frosted = ImageEnhance.Color(frosted).enhance(1.25)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.08)
    elif itype == "prism":
        # Iridescent multi-hue glass wave
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=68))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=30))
        frosted = Image.blend(atmos, bokeh, 0.45)
        frosted = ImageEnhance.Color(frosted).enhance(1.28)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.04)
    else:
        # High-translucency soft glass
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=72))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=32))
        frosted = Image.blend(atmos, bokeh, 0.40)
        frosted = ImageEnhance.Color(frosted).enhance(1.20)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.04)

    frosted_path = os.path.join(out_dir, item["frosted"])
    frosted.save(frosted_path, "WEBP", quality=90)
    print(
        f"Done {item['sharp']} ({os.path.getsize(sharp_path)//1024} KB) -> {item['frosted']} ({os.path.getsize(frosted_path)//1024} KB)"
    )

print("All wallpapers processed successfully.")
