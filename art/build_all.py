"""Build every model and export it for the game.

Run:  npm run art            (everything)
      npm run art -- flora   (only kits whose name contains 'flora')
Previews land in art/_preview (not committed).
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from lib import geo as G  # noqa: E402
import plants  # noqa: E402

OUT = os.path.join(HERE, '..', 'src', 'assets', 'models')
PREVIEW = os.path.join(HERE, '_preview')
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
only = [a for a in args if not a.startswith('-')]
no_preview = '--no-preview' in args


def kit(name, parts, preview=None):
    """parts: list of (object name, Geo builder fn, to_object kwargs)."""
    if only and not any(o in name for o in only):
        return
    t0 = time.time()
    G.reset_scene()
    objs = []
    tris = 0
    for obj_name, fn, kw in parts:
        g = fn()
        obj = g.to_object(obj_name, **kw)
        objs.append(obj)
        n = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        tris += n
        print(f'  {obj_name}: {n} tris')
    G.export_glb(objs, os.path.join(OUT, name + '.glb'))
    size = os.path.getsize(os.path.join(OUT, name + '.glb')) / 1024
    print(f'[kit] {name}: {len(objs)} objects, {tris} tris, {size:.0f} KB, {time.time() - t0:.1f}s')
    if preview and not no_preview:
        if 'views' in preview:
            for tag, eye, target in preview['views']:
                G.render_preview(os.path.join(PREVIEW, f'{name}_{tag}.png'), eye=eye, target=target,
                                 lens=preview.get('lens', 50), size=preview.get('size', (900, 900)))
            return
        # lay the objects out in a row for the preview only
        x = 0.0
        for obj in objs:
            w = max(obj.dimensions.x, obj.dimensions.y, 0.3)
            obj.location.x = x + w / 2
            x += w + preview.get('gap', 0.3)
        total = x
        eye = preview.get('eye', (total / 2, -total * 1.25, total * 0.45))
        target = preview.get('target', (total / 2, 0, preview.get('look_z', total * 0.22)))
        G.render_preview(os.path.join(PREVIEW, name + '.png'), eye=eye, target=target,
                         lens=preview.get('lens', 50), size=preview.get('size', (1100, 800)))


FOL = dict(ao_dist=0.9, ao_strength=0.9, ao_samples=16, ground_ao=0.25)

kit('flora_small', [
    ('fern_a', lambda: plants.fern_clump(11), FOL),
    ('fern_b', lambda: plants.fern_clump(12, 1.25), FOL),
    ('fern_c', lambda: plants.fern_clump(13, 0.8), FOL),
    ('fern_lo', lambda: plants.fern_clump(14, 1.0, lod=1), FOL),
    ('fern_far', lambda: plants.fern_clump(15, 1.0, lod=2), dict(ao_dist=0.9, ao_strength=0.9, ao_samples=8, ground_ao=0.25)),
    ('horsetail_a', lambda: plants.horsetail_clump(21), FOL),
    ('horsetail_b', lambda: plants.horsetail_clump(22, 1.2), FOL),
    ('rock_a', lambda: plants.rock(31, 0.9), dict(ao_dist=0.5, ground_ao=0.2)),
    ('rock_b', lambda: plants.rock(32, 1.5), dict(ao_dist=0.5, ground_ao=0.25)),
    ('rock_c', lambda: plants.rock(33, 0.5), dict(ao_dist=0.5, ground_ao=0.12)),
], preview=dict(lens=55))

kit('flora_trees', [
    ('treefern_a', lambda: plants.tree_fern(41, 3.0), dict(ao_dist=1.2, ao_strength=0.9, ao_samples=16, ground_ao=0.5)),
    ('treefern_b', lambda: plants.tree_fern(42, 4.2), dict(ao_dist=1.2, ao_strength=0.9, ao_samples=16, ground_ao=0.5)),
    ('ginkgo_a', lambda: plants.ginkgo(51, 9.0), dict(ao_dist=1.6, ao_strength=0.95, ao_samples=16, ground_ao=0.8)),
    ('ginkgo_b', lambda: plants.ginkgo(52, 11.0), dict(ao_dist=1.6, ao_strength=0.95, ao_samples=16, ground_ao=0.8)),
    ('conifer_a', lambda: plants.conifer(61, 17.0), dict(ao_dist=2.0, ao_strength=0.95, ao_samples=16, ground_ao=1.0)),
    ('conifer_b', lambda: plants.conifer(62, 22.0, 0.5), dict(ao_dist=2.0, ao_strength=0.95, ao_samples=16, ground_ao=1.0)),
    ('treefern_lo', lambda: plants.tree_fern(43, 3.6, lod=1), dict(ao_dist=1.2, ao_strength=0.9, ao_samples=12, ground_ao=0.5)),
    ('ginkgo_lo', lambda: plants.ginkgo(53, 10.0, lod=1), dict(ao_dist=1.6, ao_strength=0.95, ao_samples=12, ground_ao=0.8)),
    ('conifer_lo', lambda: plants.conifer(63, 19.0, 0.45, lod=1), dict(ao_dist=2.0, ao_strength=0.95, ao_samples=12, ground_ao=1.0)),
    ('conifer_far', lambda: plants.conifer(64, 19.0, 0.45, lod=2), dict(ao_dist=2.0, ao_strength=0.95, ao_samples=8, ground_ao=1.0)),
    ('ginkgo_far', lambda: plants.ginkgo(54, 10.0, lod=2), dict(ao_dist=1.6, ao_strength=0.95, ao_samples=8, ground_ao=0.8)),
    ('treefern_far', lambda: plants.tree_fern(44, 3.6, lod=2), dict(ao_dist=1.2, ao_strength=0.9, ao_samples=8, ground_ao=0.5)),
    ('conifer_dist', lambda: plants.conifer(65, 19.0, 0.45, lod=3), dict(ao_dist=2.0, ao_strength=0.95, ao_samples=8, ground_ao=1.0)),
], preview=dict(gap=1.5, lens=40))

kit('props', [
    ('log', lambda: plants.fallen_log(71), dict(ao_dist=0.4, ground_ao=0.18)),
    ('arch', lambda: plants.arch_log(), dict(ao_dist=0.7, ground_ao=0.25)),
    ('boulder', lambda: plants.boulder(), dict(ao_dist=0.5, ground_ao=0.25)),
    ('lane_tree', lambda: plants.lane_tree(), dict(ao_dist=0.8, ao_samples=16, ground_ao=0.5)),
    ('amber', lambda: plants.amber_drop(), dict(ao=False)),
    ('egg', lambda: plants.egg(), dict(ao=False)),
    ('egg_true', lambda: plants.egg_true(), dict(ao=False)),
    ('eggshell_cup', lambda: plants.eggshell(3), dict(ao=False)),
    ('eggshell_cap', lambda: plants.eggshell(5, upper=True), dict(ao=False)),
], preview=dict(lens=60))

import hero  # noqa: E402


def hero_kit(form, previews=True):
    """A rigged animal: one skinned mesh and its skeleton."""
    name = form.name
    if only and not any(o in name for o in only):
        return
    t0 = time.time()
    G.reset_scene()
    g, bones = hero.build(form)
    obj = g.to_object(name, ao_dist=0.25 * form.head_scale / 0.88, ao_strength=0.9, ao_samples=28)
    arm = G.make_armature(name + '_rig', bones, obj)
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    G.export_glb([arm, obj], os.path.join(OUT, name + '.glb'), skins=True)
    size = os.path.getsize(os.path.join(OUT, name + '.glb')) / 1024
    print(f'[kit] {name}: {tris} tris, {len(bones)} bones, {size:.0f} KB, {time.time() - t0:.1f}s')
    if previews and not no_preview:
        for tag, eye, target in (('behind', (0.0, -1.55, 1.15), (0.0, 0.1, 0.42)),
                                 ('side', (1.7, 0.1, 0.5), (0.0, 0.1, 0.42)),
                                 ('front', (0.9, 1.5, 0.75), (0.0, 0.1, 0.42))):
            G.render_preview(os.path.join(PREVIEW, f'{name}_{tag}.png'), eye=eye, target=target, lens=50,
                             size=(760, 760))


hero_kit(hero.PARENT)
for chick in hero.CHICKS:
    hero_kit(chick, previews=False)
