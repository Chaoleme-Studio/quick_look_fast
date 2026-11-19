"""Build application icons from the user-supplied source image.

Usage: python tools/branding/generate.py [source.png]
Pillow is only needed to regenerate assets; the generated files are included.
"""
from pathlib import Path
from shutil import copyfile
import sys
from PIL import Image, ImageOps

root = Path(__file__).resolve().parents[2]
output = root / 'public' / 'branding'
output.mkdir(parents=True, exist_ok=True)
stored = output / 'icon-source.png'
source = Path(sys.argv[1]) if len(sys.argv) > 1 else stored
if source.resolve() != stored.resolve():
    copyfile(source, stored)

# Keep the chosen artwork intact apart from a centered square crop and scaling.
with Image.open(stored) as original:
    icon = ImageOps.fit(original.convert('RGBA'), (1024, 1024), Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    icon.resize((512, 512), Image.Resampling.LANCZOS).save(output / 'app.png', optimize=True)
    icon.save(output / 'app.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    icon.save(output / 'app.icns')
    icon.resize((64, 64), Image.Resampling.LANCZOS).save(output / 'tray.png', optimize=True)
print('Generated QuickLook Fast icon assets in', output)
