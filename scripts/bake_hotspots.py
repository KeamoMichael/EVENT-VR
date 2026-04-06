import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "scenes_config.json"
SOURCE_SUFFIX = "-hq.jpg"
OUTPUT_SUFFIX = "-nav.jpg"


def yaw_pitch_to_xy(width: int, height: int, yaw: float, pitch: float) -> tuple[float, float]:
    x = ((yaw / 360.0) + 0.5) % 1.0
    y = 0.5 - (pitch / 180.0)
    return x * width, max(0, min(height - 1, y * height))


def draw_hotspot(draw: ImageDraw.ImageDraw, x: float, y: float, scale: float) -> None:
    ring_r = 42 * scale
    core_r = 28 * scale

    draw.ellipse((x - ring_r, y - ring_r, x + ring_r, y + ring_r), outline=(201, 169, 110, 170), width=max(1, int(2 * scale)))
    draw.ellipse((x - core_r, y - core_r, x + core_r, y + core_r), fill=(8, 8, 8, 175), outline=(255, 255, 255, 190), width=max(1, int(2 * scale)))

    aw = 16 * scale
    ah = 20 * scale
    arrow = [
        (x, y - ah * 0.7),
        (x + aw, y + ah * 0.15),
        (x + aw * 0.28, y + ah * 0.15),
        (x + aw * 0.28, y + ah * 0.72),
        (x - aw * 0.28, y + ah * 0.72),
        (x - aw * 0.28, y + ah * 0.15),
        (x - aw, y + ah * 0.15),
    ]
    draw.polygon(arrow, fill=(255, 255, 255, 245))


def bake_scene(scene: dict) -> None:
    source_path = ROOT / scene["file"].replace(".png", SOURCE_SUFFIX)
    output_path = source_path.with_name(source_path.stem.replace("-hq", "") + OUTPUT_SUFFIX)

    with Image.open(source_path).convert("RGBA") as base:
        width, height = base.size
        scale = width / 6144.0

        glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow, "RGBA")
        overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay, "RGBA")

        for hs in scene.get("hotspots", []):
            x, y = yaw_pitch_to_xy(width, height, hs["yaw"], hs["pitch"])
            glow_r = 58 * scale
            glow_draw.ellipse((x - glow_r, y - glow_r, x + glow_r, y + glow_r), fill=(201, 169, 110, 58))
            draw_hotspot(overlay_draw, x, y, scale)

        glow = glow.filter(ImageFilter.GaussianBlur(radius=max(8, int(14 * scale))))
        composed = Image.alpha_composite(base, glow)
        composed = Image.alpha_composite(composed, overlay)
        composed.convert("RGB").save(output_path, "JPEG", quality=92, subsampling=0, optimize=True, progressive=True)
        print(f"baked {output_path.relative_to(ROOT)}")


def main() -> None:
    scenes = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    for scene in scenes:
        bake_scene(scene)


if __name__ == "__main__":
    main()
