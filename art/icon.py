"""Render the app icon: the Caudipteryx in profile against forest green.
Run:  blender -b --factory-startup -P art/icon.py
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from lib import geo as G  # noqa: E402
import hero  # noqa: E402

G.reset_scene()
hero.build()[0].to_object('caudipteryx', ao_dist=0.25, ao_strength=0.9, ao_samples=28)
out = os.path.join(HERE, '_preview', 'icon_1024.png')
G.render_preview(out, eye=(1.45, -0.2, 0.7), target=(0.0, 0.16, 0.56), lens=58, size=(1024, 1024),
                 bg=(0.06, 0.2, 0.16))
icons = os.path.join(HERE, '..', 'public', 'icons')
for name, size in (('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', out, '-vf', f'scale={size}:{size}:flags=lanczos',
                    os.path.join(icons, name)], check=True)
print('[icon] done')
