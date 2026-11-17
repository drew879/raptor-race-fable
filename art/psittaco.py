"""A dozing Psittacosaurus, lying along the trail with its head down: something to go around.

What the fossils tell us and this model keeps (one Jehol specimen preserves skin and color):
- a stocky plant-eater about as long as a big dog, with a deep, parrot-like beak
- a horn jutting sideways from each cheek
- scaly skin, dark on the back and pale underneath, with darker face and patches
- a row of long bristles standing along the top of the tail

It is two pieces. The body lies still; the head is built around the base of its neck, so the
game can lift and turn it when the runner comes by.
"""

import math
import random

from mathutils import Vector

from lib.geo import Geo, catmull, clamp01, detail, fbm, lerp, mix, smoothstep, srgb

Z = Vector((0, 0, 1))
BACK = srgb('#4a3626')
FLANK = srgb('#80603f')
BELLY = srgb('#dccba4')
MASK = srgb('#35271e')
SPOT = srgb('#a98a5e')
BEAK = srgb('#5d564b')
BEAK_PALE = srgb('#958a76')
BRISTLE = srgb('#6a5236')
BRISTLE_TIP = srgb('#c9b58a')
LID = srgb('#2e221a')

# Where the neck meets the body. The head is built relative to this point.
NECK = Vector((0.0, 0.40, 0.15))

# The body's spine, tail tip to neck: (x, y, z, half width, half height). The tail curls round to the right.
SPINE = [
    (0.31, -0.46, 0.030, 0.012, 0.012),
    (0.29, -0.63, 0.045, 0.030, 0.030),
    (0.15, -0.75, 0.060, 0.052, 0.052),
    (0.02, -0.60, 0.100, 0.088, 0.092),
    (0.00, -0.32, 0.170, 0.170, 0.165),
    (0.00, -0.02, 0.180, 0.190, 0.175),
    (0.00, 0.24, 0.165, 0.160, 0.155),
    (0.00, 0.40, 0.150, 0.100, 0.110),
]


def skin(s, p, t=0.5, face=0.0):
    """s: sin of the ring angle (1 = back, -1 = belly). Dark above, pale below, blotched."""
    n = fbm((p.x * 9.0, p.y * 9.0, p.z * 9.0), 1.0, 3)
    c = mix(BACK, FLANK, smoothstep(0.75, 0.05, s + n * 0.5))
    c = mix(c, BELLY, smoothstep(-0.05, -0.6, s + n * 0.35))
    # pale spots along the flanks
    spots = smoothstep(0.26, 0.34, fbm((p.x * 26.0, p.y * 26.0, p.z * 26.0), 1.0, 2)) * smoothstep(0.6, 0.1, abs(s))
    c = mix(c, SPOT, spots * 0.5)
    return mix(c, MASK, face)


def scales(t, ang, p):
    # pebbled all round (see the skin role in paint.ts); the first number has to vary round the
    # body, or the pebbles line up into rings
    return detail(1, 0.6 + 0.4 * (ang / (2 * math.pi)), t * 46.0)


def limb(geo, pts, r0, r1, around=8):
    def col(t, ang, p):
        return skin(math.sin(ang) * 0.6, p)
    geo.tube(pts, lambda t, ang: (lerp(r0, r1, t),) * 2, col, 'skin', around=around, up_hint=Z, detail_fn=scales)


def body(seed=3):
    rnd = random.Random(seed)
    geo = Geo()
    n = 44
    pts = [Vector((p[0], p[1], p[2])) for p in SPINE]
    path = [catmull(pts, i / (n - 1)) for i in range(n)]
    rw = [p[3] for p in SPINE]
    rh = [p[4] for p in SPINE]

    def rad(t, ang):
        w, h = max(catmull(rw, t), 0.01), max(catmull(rh, t), 0.01)
        # lying down: the belly spreads flat on the ground
        return w * (1.0 + 0.1 * max(0.0, -math.sin(ang))), h * (1.0 - 0.18 * max(0.0, -math.sin(ang)))

    geo.tube(path, rad, lambda t, ang, p: skin(math.sin(ang), p, t), 'skin', around=18, up_hint=Z, cap_end=False,
             detail_fn=scales)

    # hind legs folded beside the body, and the forelimbs reaching forward under the chest
    for side in (-1, 1):
        hip = Vector((side * 0.15, -0.30, 0.16))
        knee = Vector((side * 0.25, -0.05, 0.085))
        ankle = Vector((side * 0.265, -0.31, 0.05))
        toe = Vector((side * 0.275, -0.13, 0.028))
        limb(geo, [hip, hip.lerp(knee, 0.5) + Vector((side * 0.03, 0, 0.02)), knee], 0.095, 0.062)
        limb(geo, [knee, knee.lerp(ankle, 0.5), ankle], 0.055, 0.036)
        limb(geo, [ankle, ankle.lerp(toe, 0.5), toe], 0.034, 0.026)
        for k in (-1, 0, 1):
            geo.tube([toe, toe + Vector((side * 0.012 * k + 0.004 * k, 0.05, -0.008))], lambda t, ang: (0.014 * (1 - 0.6 * t),) * 2,
                     lambda t, ang, p: MASK, 'skin', around=5, up_hint=Z)
        shoulder = Vector((side * 0.12, 0.22, 0.12))
        hand = Vector((side * 0.17, 0.44, 0.03))
        limb(geo, [shoulder, shoulder.lerp(hand, 0.5) + Vector((side * 0.02, 0, -0.01)), hand], 0.05, 0.028)

    # the bristles: a row of long quills standing along the top of the tail
    for i in range(34):
        t = lerp(0.08, 0.5, i / 33)
        p = catmull(pts, t)
        ahead = catmull(pts, min(1.0, t + 0.02)) - catmull(pts, max(0.0, t - 0.02))
        back = (-ahead).normalized()
        top = p + Z * (catmull(rh, t) * 0.92)
        length = lerp(0.11, 0.19, math.sin(math.pi * i / 33)) * rnd.uniform(0.85, 1.1)
        lean = (Z + back * rnd.uniform(0.25, 0.5) + Vector((rnd.uniform(-0.12, 0.12), 0, 0))).normalized()
        geo.blade(top, lean, back, length, lambda u: 0.009 * (1 - u * 0.75) + 0.0015,
                  lambda u, sd: mix(BRISTLE, BRISTLE_TIP, u), 'feather', segs=3, droop=-0.25, sway=(0.0, 0.5),
                  phase=rnd.random())
    return geo


def head():
    """Built around the base of the neck (the origin), lying forward with its chin near the ground."""
    geo = Geo()
    # neck and skull as one skin: neck base, back of skull, cheeks, beak
    keys = [
        (0.00, 0.000, 0.100, 0.105),
        (0.06, -0.035, 0.085, 0.090),
        (0.12, -0.070, 0.088, 0.085),   # back of the skull
        (0.18, -0.085, 0.096, 0.082),   # cheeks, the widest part
        (0.24, -0.092, 0.066, 0.070),
        (0.29, -0.100, 0.038, 0.055),   # beak
        (0.325, -0.118, 0.012, 0.028),  # its tip, hooked down
    ]
    n = 26
    pts = [Vector((0.0, k[0], k[1])) for k in keys]
    path = [catmull(pts, i / (n - 1)) for i in range(n)]

    def rad(t, ang):
        return max(catmull([k[2] for k in keys], t), 0.004), max(catmull([k[3] for k in keys], t), 0.004)

    def col(t, ang, p):
        s = math.sin(ang)
        beak = smoothstep(0.72, 0.8, t)
        c = skin(s, p + NECK, t, face=smoothstep(0.3, 0.55, t) * smoothstep(-0.5, 0.1, s) * 0.85)
        return mix(c, mix(BEAK_PALE, BEAK, clamp01(0.4 + 0.6 * s + (t - 0.8) * 2.0)), beak)

    geo.tube(path, rad, col, 'skin', around=16, up_hint=Z, cap_start=False,
             detail_fn=lambda t, ang, p: detail(2 if t > 0.76 else 1, 0.6 + 0.4 * (ang / (2 * math.pi)), t * 30.0))
    for side in (-1, 1):
        # the cheek horn
        base = Vector((side * 0.088, 0.185, -0.105))
        tip = base + Vector((side * 0.06, -0.012, -0.022))
        geo.tube([base, base.lerp(tip, 0.5), tip], lambda t, ang: (0.022 * (1 - t) + 0.003,) * 2,
                 lambda t, ang, p: mix(FLANK, BEAK_PALE, t), 'skin', around=6, up_hint=Z,
                 detail_fn=lambda t, ang, p: detail(2, 0.0, t))
        # the eye: a cap the shader draws, shut while it dozes
        c = Vector((side * 0.074, 0.165, -0.048))
        axis = Vector((side, 0.1, 0.25)).normalized()
        fwd = (Vector((0, 1, 0)) - axis * axis.y).normalized()
        up = axis.cross(fwd) * side
        if up.z < 0:
            up = -up
        reach, lat, lon, er = math.radians(64), 5, 12, 0.026
        rings = []
        for i in range(lat + 1):
            a = reach * i / lat
            rings.append([c - axis * er * 0.6 + (axis * math.cos(a) + (fwd * math.cos(2 * math.pi * j / lon) +
                          up * math.sin(2 * math.pi * j / lon)) * math.sin(a)) * er for j in range(lon)])

        def edet(i, j, p, lat=lat, lon=lon, reach=reach):
            r = math.sin(reach * i / lat) / math.sin(reach)
            b = 2 * math.pi * j / lon
            return detail(1, r * math.cos(b), 0.5 + 0.5 * r * math.sin(b))

        geo.add_grid(rings, lambda i, j, p: srgb('#7a4a1c'), 'eye', close_u=True, flip=(side > 0), detail_fn=edet)
    return geo
