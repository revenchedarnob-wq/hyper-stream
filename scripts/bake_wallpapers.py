import os
from PIL import Image, ImageFilter, ImageEnhance

src_dir = r"A:\Downloads\2K qualty wallpaper"
public_dir = r"A:\Hyper-stream\app-preview\public\wallpapers"
dist_dir = r"A:\Hyper-stream\app-preview\dist\wallpapers"

os.makedirs(public_dir, exist_ok=True)
os.makedirs(dist_dir, exist_ok=True)

items = [
    {
        "src": "neon_background.jpg_2K_20260925233712.jpg",
        "sharp": "bg-neon-waves.jpg",
        "frosted": "bg-neon-waves-frosted.webp",
        "type": "neon",
        "target_size": (2560, 1440),
    },
    {
        "src": "beauty_scene.jpg_2K_20260925233549.jpg",
        "sharp": "bg-ghibli.jpg",
        "frosted": "bg-ghibli-frosted.webp",
        "type": "ghibli",
        "target_size": (2560, 1440),
    },
    {
        "src": "Blue_Curved_Lines_Projects____2K_20260925233657.jpg",
        "sharp": "bg-violet-discs.jpg",
        "frosted": "bg-violet-discs-frosted.webp",
        "type": "blue_curve",
        "target_size": (2560, 1440),
    },
    {
        "src": "background.jpg_2K_20260925233701.jpg",
        "sharp": "bg-silk-loop.jpg",
        "frosted": "bg-silk-loop-frosted.webp",
        "type": "glass",
        "target_size": (2560, 1440),
    },
    {
        "src": "download_(2).jpg_2K_20260925233603.jpg",
        "sharp": "bg-amber-flow.jpg",
        "frosted": "bg-amber-flow-frosted.webp",
        "type": "amber",
        "target_size": (2560, 1440),
    },
    {
        "src": "let_(1).jpg_2K_20260925233555.jpg",
        "sharp": "bg-rose-petals.jpg",
        "frosted": "bg-rose-petals-frosted.webp",
        "type": "pastel",
        "target_size": (2560, 1440),
    },
    {
        "src": "업데이트___아이클릭아트.jpg_2K_20260925233559.jpg",
        "sharp": "bg-prism-wave.jpg",
        "frosted": "bg-prism-wave-frosted.webp",
        "type": "prism",
        "target_size": (2560, 1440),
    },
    {
        "src": "Unsplash.jpg_2K_20260925233717.jpg",
        "sharp": "bg-unsplash.jpg",
        "frosted": "bg-unsplash-frosted.webp",
        "type": "dark_landscape",
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

    # Save 2K Sharp master with pristine 98 quality
    sharp_public = os.path.join(public_dir, item["sharp"])
    sharp_dist = os.path.join(dist_dir, item["sharp"])
    sharp_img.save(sharp_public, "JPEG", quality=98, optimize=True)
    sharp_img.save(sharp_dist, "JPEG", quality=98, optimize=True)

    # Process tailored cinema optical bokeh without white haze
    itype = item["type"]
    if itype == "neon":
        # Photonic bloom for neon highlights
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=75))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=40))
        base_frosted = Image.blend(atmos, bokeh, 0.40)
        gray = sharp_img.convert("L")
        mask = gray.point(lambda p: int(((p / 255.0) ** 2.0) * 255)).filter(
            ImageFilter.GaussianBlur(radius=28)
        )
        glow = ImageEnhance.Color(sharp_img).enhance(1.85)
        glow = ImageEnhance.Brightness(glow).enhance(1.15).filter(
            ImageFilter.GaussianBlur(radius=34)
        )
        bloomed = Image.composite(glow, base_frosted, mask)
        frosted = Image.blend(base_frosted, bloomed, 0.45)
        frosted = ImageEnhance.Color(frosted).enhance(1.28)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.10)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.00)
    elif itype == "blue_curve":
        # Radiant deep blue curves with specular highlights and rich indigo depth
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=70))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=42))
        base_frosted = Image.blend(atmos, bokeh, 0.42)
        frosted = ImageEnhance.Color(base_frosted).enhance(1.30)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.12)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.00)
    elif itype == "ghibli":
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=72))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=42))
        frosted = Image.blend(atmos, bokeh, 0.42)
        frosted = ImageEnhance.Color(frosted).enhance(1.35)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.08)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.00)
    elif itype == "amber":
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=68))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=40))
        frosted = Image.blend(atmos, bokeh, 0.40)
        frosted = ImageEnhance.Color(frosted).enhance(1.26)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.10)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.00)
    elif itype == "prism":
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=68))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=40))
        frosted = Image.blend(atmos, bokeh, 0.45)
        frosted = ImageEnhance.Color(frosted).enhance(1.28)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.10)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.00)
    elif itype == "dark_landscape":
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=72))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=42))
        frosted = Image.blend(atmos, bokeh, 0.40)
        frosted = ImageEnhance.Color(frosted).enhance(1.25)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.10)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.00)
    else:
        atmos = sharp_img.filter(ImageFilter.GaussianBlur(radius=70))
        bokeh = sharp_img.filter(ImageFilter.GaussianBlur(radius=42))
        frosted = Image.blend(atmos, bokeh, 0.40)
        frosted = ImageEnhance.Color(frosted).enhance(1.22)
        frosted = ImageEnhance.Contrast(frosted).enhance(1.09)
        frosted = ImageEnhance.Brightness(frosted).enhance(1.00)

    frosted_public = os.path.join(public_dir, item["frosted"])
    frosted_dist = os.path.join(dist_dir, item["frosted"])
    frosted.save(frosted_public, "WEBP", quality=95, method=6)
    frosted.save(frosted_dist, "WEBP", quality=95, method=6)
    sharp_kb = os.path.getsize(sharp_public) // 1024
    frosted_kb = os.path.getsize(frosted_public) // 1024
    print(f"Baked: {item['sharp']} ({sharp_kb} KB) | {item['frosted']} ({frosted_kb} KB)")

print("All wallpapers baked successfully.")
