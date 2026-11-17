"""Caudipteryx zoui and its chick, built standing in a rest pose with a skeleton.
The game poses the skeleton in code (run, jump, slide, brood), so there are no baked animations.

What the fossils tell us and this model keeps:
- about the size of a peacock, long legs built for running, short arms, short tail
- a small, short, deep head on a long neck, with a beak-like snout and a large eye
- a fan of long feathers at the tip of the tail and on each hand, with dark and light banding
  preserved on the tail feathers
- a coat of short downy feathers over the body
Colors beyond the banding are not known, so the palette is a choice: blue-black with
cream bands and a gold collar.

Everything that differs between the parent and the chick lives in a Form. Both share one
skeleton, so the game can pose either with the same code.
"""

import math
import random

from mathutils import Vector

from lib.geo import (Geo, basis, catmull, chain_bind, clamp01, detail, fbm, frames_along, lerp, mix,
                     rot, scale, smoothstep, srgb)

X = Vector((1, 0, 0))
Y = Vector((0, 1, 0))
Z = Vector((0, 0, 1))

INK = srgb('#141922')
BLUE_BLACK = srgb('#1c2535')
DEEP_BLUE = srgb('#27406b')
SLATE = srgb('#3d4e66')
CREAM = srgb('#efe3c2')
CREAM_SHADE = srgb('#cdbb94')
GOLD = srgb('#e0a63a')
GOLD_DEEP = srgb('#b9772a')
SPECULUM = srgb('#2f63a8')
HORN = srgb('#4d4a45')
HORN_PALE = srgb('#a39b88')
SKIN = srgb('#4a4f58')
SKIN_PALE = srgb('#7c7b73')
CLAW = srgb('#1a1a1c')
MOUTH = srgb('#2b1719')
TOOTH = srgb('#e9e2cf')
LID = srgb('#23262c')

# detail kinds the shader knows (see paint.ts)
VANE, CONTOUR, DOWN, PLUMAGE, DOWNY = 1, 2, 3, 4, 5   # on feathers (the last two are drawn on the skin)
SCUTES, HORNY = 1, 2            # on skin
IRIS = 1                        # on eyes


class Form:
    """Proportions, plumage and colors for one animal."""

    def __init__(self, **kw):
        self.__dict__.update(kw)


def curve(points):
    """A smooth function through (x, value) points, x rising. Flat beyond both ends."""
    xs = [p[0] for p in points]
    vs = [p[1] for p in points]
    n = len(xs)
    ms = []
    for i in range(n):
        if i == 0:
            m = (vs[1] - vs[0]) / (xs[1] - xs[0])
        elif i == n - 1:
            m = (vs[-1] - vs[-2]) / (xs[-1] - xs[-2])
        else:
            m = 0.5 * ((vs[i + 1] - vs[i]) / (xs[i + 1] - xs[i]) + (vs[i] - vs[i - 1]) / (xs[i] - xs[i - 1]))
        ms.append(m)

    def f(x):
        if x <= xs[0]:
            return vs[0]
        if x >= xs[-1]:
            return vs[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * vs[i] + (t3 - 2 * t2 + t) * h * ms[i] +
                (-2 * t3 + 3 * t2) * vs[i + 1] + (t3 - t2) * h * ms[i + 1])

    return f


def spow(v, e):
    return math.copysign(abs(v) ** e, v)


def loft(geo, rings, color_fn, mat, detail_fn=None, cap_start=None, cap_end=None):
    """A closed skin over a stack of rings (each a list of points, all the same count).
    color_fn(i, j, p). cap_start / cap_end: a point to close that end with, or None."""
    idx, cols, _ = geo.add_grid(rings, color_fn, mat, close_u=True, flip=True, detail_fn=detail_fn)
    n = len(rings[0])
    for end, center in ((0, cap_start), (len(rings) - 1, cap_end)):
        if center is None:
            continue
        c = geo.vert(center)
        cc = color_fn(end, 0, center)
        cd = detail_fn(end, 0, center) if detail_fn else None
        for j in range(n):
            j2 = (j + 1) % n
            tri = [idx[end][j], idx[end][j2], c]
            tc = [cols[end][j], cols[end][j2], cc]
            td = [detail_fn(end, j, rings[end][j]), detail_fn(end, j + 1, rings[end][j2]), cd] if detail_fn else None
            if end != 0:
                tri.reverse()
                tc.reverse()
                if td:
                    td.reverse()
            geo.face(tri, tc, mat, detail=td)


def tube_rings(path, radius_fn, around, up_hint=Z):
    """Rings of points round a path, as Geo.tube lays them out."""
    frames = frames_along(path, up_hint)
    n = len(path)
    rings = []
    for i in range(n):
        t = i / (n - 1)
        _, right, up = frames[i]
        ring = []
        for j in range(around):
            ang = 2 * math.pi * j / around
            rx, ry = radius_fn(t, ang)
            ring.append(path[i] + right * (math.cos(ang) * rx) + up * (math.sin(ang) * ry))
        rings.append(ring)
    return rings


def plume_skin(geo, rings, color_fn, rows, feather_width, kind=PLUMAGE, cap_start=None, cap_end=None):
    """A feathered skin. The shader draws the plumage on it: rows of small overlapping feathers,
    each shaded at its root and pale at its tip, so no feather needs triangles of its own.
    rings: stacked rings of points. rows[i]: the row count at ring i, running in the direction
    the feathers point; a whole number is where one row of feathers ends and the next begins.
    feather_width: how wide a feather should be, in meters. Each row gets a whole number of them."""
    ni, nj = len(rings), len(rings[0])
    idx = [[geo.vert(p) for p in ring] for ring in rings]
    cols = [[color_fn(i, j, rings[i][j]) for j in range(nj)] for i in range(ni)]

    def girth(i):
        return sum((rings[i][j] - rings[i][(j + 1) % nj]).length for j in range(nj))

    # the number of feathers round each row, measured where the row is
    by_row = {}
    for i in range(ni - 1):
        r = math.floor(min(rows[i], rows[i + 1]) + 1e-6)
        by_row.setdefault(r, []).append(0.5 * (girth(i) + girth(i + 1)))
    count = {r: max(5, round(sum(g) / len(g) / feather_width)) for r, g in by_row.items()}
    for i in range(ni - 1):
        n = float(count[math.floor(min(rows[i], rows[i + 1]) + 1e-6)])
        for j in range(nj):
            j2 = (j + 1) % nj
            a0 = 2.0 * j / nj - 1.0
            a1 = 2.0 * (j + 1) / nj - 1.0
            quad = [(i, j, a0), (i, j2, a1), (i + 1, j2, a1), (i + 1, j, a0)]
            quad.reverse()
            geo.face([idx[a][b] for a, b, _ in quad], [cols[a][b] for a, b, _ in quad], 'feather',
                     [(0.0, n)] * 4, True, detail=[detail(kind, ac, rows[a]) for a, _, ac in quad])
    for end, center in ((0, cap_start), (ni - 1, cap_end)):
        if center is None:
            continue
        c = geo.vert(center)
        cc = color_fn(end, 0, center)
        for j in range(nj):
            j2 = (j + 1) % nj
            tri = [idx[end][j], idx[end][j2], c]
            tc = [cols[end][j], cols[end][j2], cc]
            if end != 0:
                tri.reverse()
                tc.reverse()
            geo.face(tri, tc, 'feather')


def rows_along(count, step_fn, toward_start=True):
    """Row counts for `count` rings. step_fn(i) is how much of a row the strip after ring i
    covers (1 = a whole row, 0.5 = half of one). toward_start: feathers point at ring 0."""
    rows = [0.0] * count
    if toward_start:
        for i in range(count - 2, -1, -1):
            rows[i] = rows[i + 1] + step_fn(i)
    else:
        for i in range(1, count):
            rows[i] = rows[i - 1] + step_fn(i - 1)
    return rows


# ---------------------------------------------------------------- the parent

# Leg segment lengths and the rest pose: angles from straight down, positive = forward.
FEMUR, TIBIA, META = 0.13, 0.20, 0.13
REST_LEG = (math.radians(26), math.radians(-34), math.radians(18), math.radians(88))

D, C, B = INK, CREAM, SPECULUM

PARENT = Form(
    name='caudipteryx',
    # Spine from tail tip to just inside the back of the head: (y, z, half width, half height)
    spine=[
        (-0.300, 0.548, 0.010, 0.010),
        (-0.215, 0.528, 0.026, 0.029),
        (-0.125, 0.503, 0.050, 0.055),
        (-0.030, 0.487, 0.083, 0.089),
        (0.075, 0.478, 0.098, 0.106),
        (0.175, 0.497, 0.089, 0.097),
        (0.240, 0.542, 0.060, 0.068),
        (0.283, 0.605, 0.036, 0.042),
        (0.316, 0.675, 0.0245, 0.0275),
        (0.344, 0.737, 0.021, 0.022),
        (0.362, 0.754, 0.016, 0.016),
    ],
    # where the spine's bones meet, in key units, and the bone that owns each stretch
    spine_joints=[0.0, 1.7, 3.0, 4.5, 6.0, 7.5, 9.1, 10.0],
    spine_bones=['tail2', 'tail1', 'hips', 'chest', 'neck1', 'neck2', 'head'],
    torso=(2.0, 3.2, 6.5, 5.5),
    hip=(0.064, -0.02, 0.452),
    leg=(FEMUR, TIBIA, META, 0.076),
    leg_thick=1.0,
    rest_leg=REST_LEG,
    shoulder=(0.070, 0.185, 0.530),
    # upper arm, forearm, hand: (length, direction for the right side)
    arm=((0.075, (0.42, -0.78, -0.46)), (0.060, (0.55, 0.80, -0.22)), (0.070, (0.66, -0.66, -0.36))),
    arm_thick=1.0,
    # the head, in its own frame: x forward from the back of the skull, z up, all in meters
    head_origin=(0.0, 0.340, 0.758),
    head_pitch=math.radians(-6),
    head_scale=0.88,
    head_top=[(-0.004, 0.006), (0.0, 0.016), (0.012, 0.026), (0.030, 0.031), (0.048, 0.028), (0.062, 0.0195),
              (0.078, 0.0095), (0.090, 0.003), (0.098, -0.006)],
    head_bottom=[(-0.004, -0.004), (0.0, -0.016), (0.015, -0.023), (0.035, -0.023), (0.055, -0.019),
                 (0.075, -0.0145), (0.090, -0.0115), (0.095, -0.0098)],
    head_mouth=[(0.046, -0.0065), (0.070, -0.0075), (0.090, -0.0088), (0.098, -0.0096)],
    head_width=[(-0.004, 0.008), (0.0, 0.0165), (0.014, 0.0225), (0.030, 0.0235), (0.044, 0.0215),
                (0.058, 0.0165), (0.070, 0.0115), (0.084, 0.007), (0.094, 0.0035), (0.098, 0.0015)],
    gape=0.048,          # the corner of the mouth
    beak_from=0.060,     # where feathers give way to horn along the top of the snout
    jaw_joint=(0.030, -0.008),
    eye=(0.0405, 0.0075, 0.0098),   # x, z in the head frame, and the eyeball's radius
    eye_color=GOLD,
    teeth=4,
    coat=CONTOUR,
    coat_scale=1.0,
    # Eleven tail feathers are preserved on one side of the first skeleton found.
    tail_fan=dict(per_side=11, length=(0.2, 0.26), width=0.03,
                  bands=[BLUE_BLACK, D, C, C, D, D, C, C, D, D, C, D]),
    # At least fourteen feathers ran along the second finger. The three nearest the fingertip
    # measure about 30, 64 and 95 mm in the fossils, and the longest known is 182 mm.
    arm_fan=dict(lengths=[0.168, 0.176, 0.181, 0.182, 0.18, 0.176, 0.17, 0.162, 0.15, 0.136, 0.118, 0.095,
                          0.0635, 0.03],
                 width=0.022, bands=[BLUE_BLACK, B, B, C, D, D, C, C, D, D]),
)


def body_color(fm, k, s, p):
    """k: position along the spine in key units. s: sin of the ring angle (1 = back, -1 = belly)."""
    n = fbm((p.x * 14.0, p.y * 14.0, p.z * 14.0), 1.0, 2)
    c = mix(BLUE_BLACK, DEEP_BLUE, smoothstep(0.1, 0.95, s) * 0.75 + n * 0.5)
    c = mix(c, SLATE, smoothstep(0.35, -0.2, s) * 0.55)
    # pale underside from the throat to under the tail
    under = smoothstep(-0.2, -0.62, s + n * 0.25)
    under *= smoothstep(1.2, 2.6, k) * smoothstep(9.9, 8.8, k) + smoothstep(8.6, 9.4, k) * smoothstep(-0.05, -0.5, s)
    c = mix(c, mix(CREAM_SHADE, CREAM, 0.5 + n), clamp01(under))
    # gold collar where the neck meets the shoulders
    collar = smoothstep(5.95, 6.25, k) * smoothstep(7.05, 6.7, k) * smoothstep(-0.55, -0.1, s)
    c = mix(c, mix(GOLD_DEEP, GOLD, 0.6 + n * 1.5), clamp01(collar * (0.85 + n)))
    return c


def head_color(fm, x, z, p):
    """Colors of the feathered head, in head-frame meters (already divided by the head's scale):
    dark cap, cream brow line, dark stripe through the eye, cream cheek and throat."""
    ex, ez, _ = fm.eye
    n = fbm((p.x * 30.0, p.y * 30.0, p.z * 30.0), 1.0, 2)
    # the stripe and brow rise a little behind the eye and dip toward the beak
    line = ez + 0.004 * smoothstep(ex, ex - 0.035, x) - 0.004 * smoothstep(ex, ex + 0.03, x)
    dz = z - line + n * 0.003
    cream = mix(CREAM_SHADE, CREAM, smoothstep(-0.02, -0.004, dz) * 0.7 + 0.3 + n)
    c = cream
    stripe = smoothstep(-0.0068, -0.0045, dz) * smoothstep(0.0058, 0.0038, dz)
    stripe *= smoothstep(0.066, 0.058, x)
    c = mix(c, INK, stripe)
    cap = smoothstep(0.0105, 0.0135, dz)
    c = mix(c, mix(INK, DEEP_BLUE, clamp01(0.25 + n * 2.0 + smoothstep(0.02, 0.035, dz) * 0.3)), cap)
    return c


class Head:
    """The head's shape in one place, so the skin, the feathers on it, the eyes and the jaw agree."""

    def __init__(self, fm):
        self.fm = fm
        self.s = fm.head_scale
        self.O = Vector(fm.head_origin)
        a = fm.head_pitch
        self.F = Vector((0, math.cos(a), math.sin(a)))
        self.U = Vector((0, -math.sin(a), math.cos(a)))
        self.top = curve(fm.head_top)
        self.bottom = curve(fm.head_bottom)
        self.mouth = curve(fm.head_mouth)
        self.width = curve(fm.head_width)
        self.x0 = fm.head_top[0][0]
        self.x1 = fm.head_top[-1][0]

    def at(self, x, side_x, z):
        """A point given in head-frame meters (before scaling)."""
        return self.O + (self.F * x + X * side_x + self.U * z) * self.s

    def beak(self, x):
        """0 on the skull, 1 on the beak."""
        return smoothstep(self.fm.gape - 0.008, self.fm.gape + 0.004, x)

    def upper(self, x, ang):
        """The skull and upper beak: (sideways, up) at x for a ring angle (0 right, 90 degrees top)."""
        fm = self.fm
        k = self.beak(x)
        top = self.top(x)
        bot = lerp(self.bottom(x), self.mouth(x) + 0.0002, k)
        w = self.width(x)
        zc = lerp(fm.eye[1] - 0.004, bot + (top - bot) * 0.22, k)   # height of the widest point
        cx, sx = math.cos(ang), math.sin(ang)
        n_side = lerp(2.5, 2.0, k)
        px = w * spow(cx, 2.0 / n_side)
        if sx >= 0:
            # the top of the beak comes to a soft ridge
            pz = zc + (top - zc) * sx ** (2.0 / lerp(2.4, 1.55, k))
        else:
            flat = min(1.0, -sx * 3.0)
            pz = zc - (zc - bot) * lerp((-sx) ** (2.0 / 2.3), flat, k)
        return px, pz

    def lower(self, x, ang):
        """The lower jaw. Behind the corner of the mouth it hides inside the cheeks."""
        fm = self.fm
        k = self.beak(x)
        top = self.mouth(x) - 0.0006
        bot = self.bottom(x) + lerp(0.004, 0.0, k)
        w = self.width(x) * lerp(0.72, 0.9, k)
        zc = top - (top - bot) * 0.3
        cx, sx = math.cos(ang), math.sin(ang)
        px = w * spow(cx, 2.0 / 2.2)
        if sx >= 0:
            pz = zc + (top - zc) * min(1.0, sx * 3.0)
        else:
            pz = zc - (zc - bot) * (-sx) ** (2.0 / 2.2)
        return px, pz

    def surface(self, x, ang):
        px, pz = self.upper(x, ang)
        return self.at(x, px, pz)

    def normal(self, x, ang):
        e = 0.0015
        a = self.surface(x, ang + 0.05) - self.surface(x, ang - 0.05)
        b = self.surface(min(x + e, self.x1), ang) - self.surface(max(x - e, self.x0), ang)
        n = a.cross(b)
        if n.length < 1e-12:
            return Vector((math.cos(ang), 0, math.sin(ang)))
        n.normalize()
        out = X * math.cos(ang) + self.U * math.sin(ang)
        return n if n.dot(out) >= 0 else -n

    def eye_center(self, side):
        ex, ez, r = self.fm.eye
        # on the surface at the eye's height
        w = self.width(ex)
        return self.at(ex, side * (w - 0.0012), ez)

    def eye_axis(self, side):
        return (X * side * 0.96 + self.F * 0.22 + self.U * 0.08).normalized()


def tuft(geo, rnd, p, t_dir, n_dir, length, width, base_col, tip_gain=1.25, lift=0.14, droop=0.45,
         kind=CONTOUR, segs=4, jitter=0.1):
    """A short body feather lying back along the surface. It borrows the body's normal for
    shading, so the coat reads as soft plumage with a broken edge instead of separate scales.
    The whole feather moves with the bone under its root."""
    d = (t_dir + n_dir * lift + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * jitter).normalized()
    tip = mix(scale(base_col, tip_gain), base_col, 0.5)

    if kind == DOWN:
        def w(u):
            # a loose plume: wide and soft, never a clean oval
            return width * 1.7 * (0.3 + 0.7 * smoothstep(0.0, 0.5, u)) * (1.0 - 0.8 * smoothstep(0.6, 1.0, u)) + 0.0004
    else:
        def w(u):
            # narrow at the root, widest past the middle, a rounded tip
            return width * (0.42 + 0.58 * smoothstep(0.0, 0.45, u)) * math.sqrt(max(0.0, 1.0 - max(0.0, (u - 0.62) / 0.38) ** 2)) + 0.0004

    outer = geo.bind
    if callable(outer):
        geo.bind = outer(Vector(p))
    geo.blade(p + n_dir * 0.0015, d, n_dir, length, w, lambda u, sd: mix(base_col, tip, u * u), 'feather',
              segs=segs, droop=droop, fold=-0.1 if kind != DOWN else 0.15, sway=(0.0, 0.25 if kind != DOWN else 0.6),
              phase=rnd.random(), shade_normal=(n_dir * 0.85 + d * 0.15), kind=kind)
    geo.bind = outer


def banded_feather(geo, base, direction, normal, length, width, bands, rnd, droop=0.18, fold=0.1,
                   curl=0.0):
    """A long vaned feather with bands of color. The shaft and barbs are drawn by the shader."""
    count = len(bands)
    segs = count * 2 if count <= 8 else count

    def w(u):
        root = smoothstep(0.0, 0.2, u)
        tip = math.sqrt(max(0.0, 1.0 - max(0.0, (u - 0.74) / 0.26) ** 2))
        return width * (0.2 + 0.8 * root) * tip + 0.0012

    def col(u, sd):
        c = bands[min(count - 1, int(u * count))]
        return scale(c, 0.93 if sd < 0 else 1.0)

    geo.blade(base, direction, normal, length, w, col, 'feather', segs=segs, droop=droop, fold=fold,
              curl=curl, sway=(0.0, 0.5), phase=rnd.random(), kind=VANE)


def front_of(ang, front=math.pi / 2):
    """How far round a tube a point is from its front: 0 at the front, 1 at the back."""
    d = (ang - front + math.pi) % (2 * math.pi) - math.pi
    return abs(d) / math.pi


def scaly(geo, pts, r0, r1, plates, around=8, cap_end=True, cap_start=True, up_hint=Y, knuckles=(),
          tint=1.0, skin=(SKIN, SKIN_PALE)):
    """A bare, scaled part of a leg or toe. plates: how many broad scales run down its front.
    knuckles: places along it (0..1) that swell a little, as joints do."""
    def rad(t, ang):
        r = lerp(r0, r1, t)
        for k in knuckles:
            r *= 1.0 + 0.22 * math.exp(-((t - k) / 0.07) ** 2)
        return r, r

    def col(t, ang, p):
        front = 1.0 - front_of(ang)
        return scale(mix(skin[0], skin[1], front * 0.8), tint)

    geo.tube(pts, rad, col, 'skin', around=around, up_hint=up_hint, cap_start=cap_start, cap_end=cap_end,
             detail_fn=lambda t, ang, p: detail(SCUTES, front_of(ang), t * plates))


def claw(geo, base, direction, down, length, radius, color=CLAW, around=6):
    """A curved, tapering claw of horn."""
    f = Vector(direction).normalized()
    dn = Vector(down).normalized()
    pts = []
    n = 6
    for i in range(n):
        t = i / (n - 1)
        pts.append(Vector(base) + f * (length * t * (1.0 - 0.25 * t)) + dn * (length * 0.55 * t * t))
    geo.tube(pts, lambda t, ang: (radius * (1.0 - t) ** 0.8 * 0.85 + 0.0003, radius * (1.0 - t) ** 0.8 + 0.0003),
             lambda t, ang, p: mix(color, scale(color, 2.2), 0.3 * (1 - t)), 'skin', around=around,
             up_hint=-dn, cap_start=True, cap_end=True,
             detail_fn=lambda t, ang, p: detail(HORNY, 0.0, t))


def leg_joints(fm, side, angles=None):
    angles = angles or fm.rest_leg
    femur, tibia, meta, toe = fm.leg

    def d(a, out=0.0):
        return Vector((side * out, math.sin(a), -math.cos(a))).normalized()

    hip = Vector((side * fm.hip[0], fm.hip[1], fm.hip[2]))
    knee = hip + d(angles[0], 0.12) * femur
    ankle = knee + d(angles[1], 0.06) * tibia
    foot = ankle + d(angles[2], 0.0) * meta
    toe_tip = foot + d(angles[3]) * toe
    return hip, knee, ankle, foot, toe_tip


def arm_joints(fm, side):
    p = Vector((side * fm.shoulder[0], fm.shoulder[1], fm.shoulder[2]))
    out = [p]
    for length, direction in fm.arm:
        dv = Vector((side * direction[0], direction[1], direction[2])).normalized()
        p = p + dv * length
        out.append(p)
    return out  # shoulder, elbow, wrist, fingertip


def leg(geo, rnd, fm, side):
    sfx = 'L' if side < 0 else 'R'
    hip, knee, ankle, foot, toe_tip = leg_joints(fm, side)
    femur, tibia, meta, toe_len = fm.leg
    th = fm.leg_thick
    u = toe_len / 0.076  # the foot's scale against the parent's
    angles = fm.rest_leg
    geo.bind = chain_bind([hip, knee, ankle, foot, toe_tip], ['thigh' + sfx, 'shin' + sfx, 'meta' + sfx, 'toes' + sfx], 0.16)

    def d(a, out=0.0):
        return Vector((side * out, math.sin(a), -math.cos(a))).normalized()

    # One feathered skin from inside the body, over the knee, to the middle of the shin: the
    # thigh is a drumstick that rounds off inside the body, and the knee bends without a seam.
    mid_shin = knee.lerp(ankle, 0.62)
    top = hip + (hip - knee).normalized() * (femur * 0.38)
    r_hip, r_knee, r_shin = 0.06 * th * femur / 0.13, 0.037 * th * femur / 0.13, 0.0125 * th * u
    stations = [(top, r_hip * 0.25), (top.lerp(hip, 0.35), r_hip * 0.72), (top.lerp(hip, 0.7), r_hip * 0.95),
                (hip, r_hip * 1.04)]
    for i in range(1, 6):
        t = i / 5
        stations.append((hip.lerp(knee, t), lerp(r_hip, r_knee, t ** 0.8) * (1.0 + 0.22 * math.sin(math.pi * t) * (1 - t))))
    for i in range(1, 6):
        t = i / 5
        stations.append((knee.lerp(mid_shin, t), lerp(r_knee, r_shin, t ** 0.7)))
    pts = [p for p, _ in stations]
    radii_l = [r for _, r in stations]
    around = 12

    def rad(t, ang):
        r = catmull(radii_l, t)
        return r, r * 1.1

    def col(i, j, p):
        n_ = fbm((p.x * 14.0, p.y * 14.0, p.z * 14.0), 1.0, 2)
        return fm.leg_color(0.3 + 0.3 * math.sin(2 * math.pi * j / around) + n_)

    rings = tube_rings(pts, rad, around, Y)
    plume_skin(geo, rings, col, rows_along(len(pts), lambda i: 1.0, toward_start=False), 0.013 * fm.coat_scale,
               kind=fm.skin_kind, cap_start=pts[0], cap_end=pts[-1])
    # a few real feathers stand off the leg, so its outline stays soft
    fr = frames_along(pts, Y)
    per = 9
    for i in range(4, len(pts)):
        t = (i - 3) / (len(pts) - 4)
        tan, right, up = fr[i]
        for j in range(per):
            if (i * per + j) % 3 and fm.coat != DOWN:
                continue
            ang = 2 * math.pi * (j + 0.5 * (i % 2)) / per
            nd = (right * math.cos(ang) + up * math.sin(ang)).normalized()
            base_c = fm.leg_color(0.3 + rnd.uniform(-0.2, 0.2))
            tuft(geo, rnd, pts[i] + nd * radii_l[i] * 0.96, tan, nd,
                 0.03 * fm.coat_scale * (1.1 - 0.4 * t) * (femur / 0.13) ** 0.5,
                 0.0095 * fm.coat_scale * (femur / 0.13) ** 0.5, scale(base_c, 0.85), lift=0.2 + fm.fluff,
                 tip_gain=1.12, kind=fm.coat)

    scaly(geo, [mid_shin, mid_shin.lerp(ankle, 0.5), ankle], 0.0105 * u * th, 0.0088 * u * th, 6, around=10,
          knuckles=(1.0,), skin=fm.skin)
    scaly(geo, [ankle, ankle.lerp(foot, 0.33), ankle.lerp(foot, 0.66), foot], 0.0092 * u * th, 0.0078 * u * th, 15,
          around=10, knuckles=(0.0, 1.0), skin=fm.skin)

    # three long toes forward (the middle one longest), and a small first toe held off the ground
    # on the inner side. The toes move as one piece.
    geo.bind = [('toes' + sfx, 1.0)]
    toe_a = angles[3]
    fwd = d(toe_a)
    for yaw, length in ((0.40 * side, 0.055), (0.0, 0.076), (-0.40 * side, 0.061)):
        length *= u
        base_dir = (fwd + Vector((math.sin(yaw) * 0.8, 0, 0))).normalized()
        dip = d(toe_a - 0.5)
        p0 = foot
        p1 = p0 + base_dir * (length * 0.34)
        p2 = p1 + base_dir * (length * 0.33)
        p3 = p2 + (base_dir * 0.75 + dip * 0.25).normalized() * (length * 0.33)
        scaly(geo, [p0, p1, p2, p3], 0.0078 * u * th, 0.0052 * u * th, max(4, int(length / u * 150)), around=8,
              cap_end=True, up_hint=Z, knuckles=(0.34, 0.67, 1.0), skin=fm.skin)
        claw(geo, p3 - base_dir * 0.002 * u, (base_dir * 0.9 + dip * 0.1), -Z, 0.017 * u, 0.0045 * u * th, color=fm.claw)
    geo.bind = [('meta' + sfx, 1.0)]
    inner = Vector((-side, 0, 0))
    h0 = foot + Z * 0.012 * u
    h1 = h0 + (inner * 0.75 + d(toe_a + math.pi) * 0.5 - Z * 0.35).normalized() * 0.02 * u
    scaly(geo, [h0, h0.lerp(h1, 0.5), h1], 0.0058 * u * th, 0.0042 * u * th, 3, around=6, up_hint=Z, skin=fm.skin)
    claw(geo, h1, (h1 - h0), -Z, 0.011 * u, 0.0036 * u * th, color=fm.claw)
    geo.bind = None


def arm(geo, rnd, fm, side):
    sfx = 'L' if side < 0 else 'R'
    shoulder, elbow, wrist, tip = arm_joints(fm, side)
    th = fm.arm_thick
    u = fm.arm[2][0] / 0.07  # the hand's scale against the parent's

    def col(t, ang, p):
        return fm.leg_color(0.3 + 0.3 * math.sin(ang))

    geo.bind = chain_bind([shoulder, elbow, wrist, tip], ['arm' + sfx, 'hand' + sfx, 'fan' + sfx], 0.2)
    for a, b, r0, r1 in ((shoulder, elbow, 0.017, 0.012), (elbow, wrist, 0.012, 0.0085)):
        n = 6
        pts = [a.lerp(b, i / (n - 1)) for i in range(n)]
        rings = tube_rings(pts, lambda t, ang, r0=r0, r1=r1: (lerp(r0, r1, t) * u * th,) * 2, 10, Z)
        plume_skin(geo, rings, lambda i, j, p: fm.leg_color(0.3 + 0.3 * math.sin(2 * math.pi * j / 10)),
                   rows_along(n, lambda i: 1.0, toward_start=False), 0.011 * fm.coat_scale, kind=fm.skin_kind,
                   cap_start=pts[0], cap_end=pts[-1])
        fr = frames_along(pts, Z)
        for i in range(1, n):
            tan, right, up = fr[i]
            for j in range(6):
                if (i + j) % 2 and fm.coat != DOWN:
                    continue
                ang = 2 * math.pi * (j + 0.5 * (i % 2)) / 6
                nd = (right * math.cos(ang) + up * math.sin(ang)).normalized()
                r = lerp(r0, r1, i / (n - 1)) * u * th
                tuft(geo, rnd, pts[i] + nd * r * 0.96, tan, nd, 0.026 * u * fm.coat_scale, 0.009 * u * fm.coat_scale,
                     scale(fm.leg_color(0.3 + rnd.uniform(-0.2, 0.2)), 0.85), lift=0.18 + fm.fluff, tip_gain=1.12,
                     kind=fm.coat)

    # the hand: the long second finger carries the fan; the short first finger sits ahead of it.
    # Both end in a claw. (The third finger was a small splint and stays hidden in the feathers.)
    geo.bind = [('fan' + sfx, 1.0)]
    hand_axis = (tip - wrist).normalized()
    fan_n = (Z + X * (side * 0.25))
    fan_n = (fan_n - hand_axis * fan_n.dot(hand_axis)).normalized()
    trail = fan_n.cross(hand_axis) * side   # in the fan's plane, pointing back toward the body
    if trail.y > 0:
        trail = -trail
    lead = -trail
    if fm.arm_fan:
        knuckle = wrist.lerp(tip, 0.62)
        scaly(geo, [wrist, wrist.lerp(tip, 0.3), knuckle, tip], 0.0072 * u * th, 0.0048 * u * th, 9, around=6,
              up_hint=Z, knuckles=(0.62,), skin=fm.skin)
        claw(geo, tip - hand_axis * 0.002 * u, hand_axis * 0.8 + lead * 0.2, -fan_n * 0.6 + lead * 0.4, 0.017 * u, 0.0042 * u * th, color=fm.claw)
        f1 = wrist + hand_axis * 0.006 * u
        f1_dir = (hand_axis * 0.55 + lead * 0.8 - fan_n * 0.25).normalized()
        f1_tip = f1 + f1_dir * 0.024 * u
        scaly(geo, [f1, f1.lerp(f1_tip, 0.5), f1_tip], 0.0058 * u * th, 0.0044 * u * th, 4, around=6, up_hint=Z, skin=fm.skin)
        claw(geo, f1_tip - f1_dir * 0.002 * u, f1_dir * 0.8 + lead * 0.2, -fan_n * 0.6 + lead * 0.4, 0.014 * u, 0.0038 * u * th, color=fm.claw)

    fan = fm.arm_fan
    if fan:
        n = len(fan['lengths'])
        for i in range(n):
            f = i / (n - 1)  # 0 at the wrist, 1 at the fingertip
            base = wrist.lerp(tip, lerp(0.02, 0.9, f)) + fan_n * (0.0016 * (n - i))
            ang = lerp(1.25, 0.2, f ** 0.85)
            direction = (hand_axis * math.cos(ang) + trail * math.sin(ang) - fan_n * 0.04).normalized()
            normal = (fan_n + trail * 0.12).normalized()
            length = fan['lengths'][i]
            # short feathers are narrower, and carry fewer bands
            share = clamp01(length / max(fan['lengths']))
            bands = fan['bands'][:max(3, round(len(fan['bands']) * share))]
            banded_feather(geo, base, direction, normal, length, fan['width'] * lerp(0.6, 1.0, share), bands, rnd,
                           droop=0.28, fold=0.06)
        # small covert feathers over the roots of the fan
        for i in range(18):
            f = rnd.random()
            p = wrist.lerp(tip, f * 0.9) + fan_n * 0.008 * u
            ang = lerp(1.2, 0.3, f)
            dv = (hand_axis * math.cos(ang) + trail * math.sin(ang)).normalized()
            tuft(geo, rnd, p, dv, fan_n, rnd.uniform(0.04, 0.06), 0.013,
                 mix(BLUE_BLACK, DEEP_BLUE, rnd.random()), lift=0.1)
    else:
        # the chick's hand feathers are only a tuft of down
        for i in range(12):
            f = rnd.random()
            p = elbow.lerp(tip, f)
            dv = (hand_axis * 0.6 + trail * 0.8 + fan_n * rnd.uniform(-0.3, 0.3)).normalized()
            tuft(geo, rnd, p, dv, fan_n, 0.085 * u * fm.coat_scale / 0.33, 0.03 * u * fm.coat_scale / 0.33,
                 fm.leg_color(rnd.random()), lift=0.3, kind=fm.coat, segs=3)
    geo.bind = None


def head(geo, rnd, fm):
    """Skull, beak, lower jaw, eyes, lids and the small feathers of the face."""
    H = Head(fm)
    s = H.s
    geo.bind = [('head', 1.0)]

    # ---- skull and upper beak: one skin, feathered behind and horn in front
    around = 28
    xs_f = [lerp(H.x0, fm.beak_from, i / 21) for i in range(22)]
    xs_b = [lerp(fm.beak_from, H.x1, i / 15) for i in range(16)]

    def ring_x(x, ang):
        # Rings near the base of the beak lean forward at the top, so the feathers reach
        # further down the forehead than they do at the corner of the mouth.
        lean = 0.0075 * math.exp(-((x - fm.beak_from) / 0.012) ** 2)
        return min(H.x1, x + lean * (math.sin(ang) - 0.25))

    def rings(xs, fn):
        out = []
        for x in xs:
            ring = []
            for j in range(around):
                ang = 2 * math.pi * j / around
                xa = ring_x(x, ang)
                ring.append(H.at(xa, *fn(xa, ang)))
            out.append(ring)
        return out

    def plain_rings(xs, fn):
        return [[H.at(x, *fn(x, 2 * math.pi * j / around)) for j in range(around)] for x in xs]

    def skull_col(i, j, p):
        ang = 2 * math.pi * j / around
        x = ring_x(xs_f[min(i, len(xs_f) - 1)], ang)
        px, pz = H.upper(x, ang)
        return head_color_of(fm, x, pz, p)

    def beak_col(xs):
        def fn(i, j, p):
            x = xs[min(i, len(xs) - 1)]
            ang = 2 * math.pi * j / around
            sx = math.sin(ang)
            t = (x - fm.beak_from) / (H.x1 - fm.beak_from)
            # darker along the ridge and toward the tip, paler low on the sides
            c = mix(fm.horn[1], fm.horn[0], clamp01(0.1 + 0.8 * t + 0.35 * smoothstep(-0.2, 0.9, sx)))
            # the cutting edge is paler; inside the mouth is dark
            if sx < -0.3 and x > fm.gape:
                c = MOUTH
            return c
        return fn

    plume_skin(geo, rings(xs_f, H.upper), skull_col, rows_along(len(xs_f), lambda i: 0.5), 0.0052 * s * fm.face_feather,
               kind=fm.skin_kind, cap_start=H.at(H.x0 - 0.002, 0, 0.001))
    loft(geo, rings(xs_b, H.upper), beak_col(xs_b), 'skin',
         detail_fn=lambda i, j, p: detail(HORNY, 0.0, i / 15), cap_end=H.at(H.x1 + 0.0008, 0, H.top(H.x1) - 0.002))

    # nostrils: a dark oval low on each side of the beak's base
    for side in (-1, 1):
        nx = fm.beak_from + 0.009
        ang = math.pi / 2 - side * 1.02
        p = H.surface(nx, ang)
        nrm = H.normal(nx, ang)
        along = (H.F - nrm * H.F.dot(nrm)).normalized()
        geo.blade(p + nrm * 0.0003 - along * 0.0024 * s, along, nrm, 0.0048 * s,
                  lambda u: 0.0011 * s * math.sin(math.pi * clamp01(u)) + 0.0001,
                  lambda u, sd: scale(fm.horn[0], 0.18), 'skin', segs=4, sway=(0.0, 0.0))

    # ---- teeth: four small ones each side under the front of the upper jaw. In the fossils they
    # lean forward; here they lean only a little, hang mostly down and hook back at the tip, so
    # they read as teeth and never as tusks.
    for side in (-1, 1):
        for i in range(fm.teeth):
            x = H.x1 - 0.0045 - i * 0.0042
            w = H.width(x) * 0.84
            base = H.at(x, side * w, H.mouth(x) + 0.0009)
            dv = (H.F * 0.34 - H.U * 0.93 + X * side * 0.04).normalized()
            length = (0.0036, 0.0028, 0.0024, 0.0021, 0.002)[min(i, 4)] * s
            tip = base + dv * length - H.F * (0.0007 * s)
            geo.tube([base, base + dv * length * 0.55, tip],
                     lambda t, ang: ((0.0008 * (1 - t) ** 0.8 + 0.0001) * s,) * 2,
                     lambda t, ang, p: TOOTH, 'skin', around=5, up_hint=Z,
                     detail_fn=lambda t, ang, p: detail(HORNY, 0.0, t))

    # ---- lower jaw, on its own bone so the beak can open
    geo.bind = [('jaw', 1.0)]
    x_a = fm.gape - 0.014
    x_m = fm.gape + 0.005
    x_e = fm.head_bottom[-1][0]
    xs_r = [lerp(x_a, x_m, i / 7) for i in range(8)]
    xs_h = [lerp(x_m, x_e, i / 11) for i in range(12)]

    def jaw_feather_col(i, j, p):
        x = xs_r[min(i, len(xs_r) - 1)]
        ang = 2 * math.pi * j / around
        if math.sin(ang) > 0.3:
            return MOUTH
        px, pz = H.lower(x, ang)
        return head_color_of(fm, x, pz, p)

    def jaw_horn_col(i, j, p):
        x = xs_h[min(i, len(xs_h) - 1)]
        ang = 2 * math.pi * j / around
        if math.sin(ang) > 0.3:
            return MOUTH
        t = (x - x_m) / (x_e - x_m)
        return mix(fm.horn[1], fm.horn[0], clamp01(0.05 + 0.7 * t))

    plume_skin(geo, plain_rings(xs_r, H.lower), jaw_feather_col, rows_along(len(xs_r), lambda i: 0.5), 0.0052 * s * fm.face_feather,
               kind=fm.skin_kind, cap_start=H.at(x_a, 0, H.mouth(x_a) - 0.008))
    loft(geo, plain_rings(xs_h, H.lower), jaw_horn_col, 'skin',
         detail_fn=lambda i, j, p: detail(HORNY, 0.0, i / 11),
         cap_end=H.at(x_e + 0.0006, 0, H.mouth(x_e) - 0.0016))
    geo.bind = [('head', 1.0)]

    # ---- eyes: a smooth cap the shader draws the iris on, and a rim of dark skin for the lids
    ex, ez, er = fm.eye
    for side in (-1, 1):
        axis = H.eye_axis(side)
        center = H.eye_center(side) - axis * (er * 0.55 * s)
        fwd = (H.F - axis * H.F.dot(axis)).normalized()
        up = axis.cross(fwd) * side
        if up.dot(H.U) < 0:
            up = -up
        reach = math.radians(64)
        lat, lon = 7, 18
        pts = []
        for i in range(lat + 1):
            a = reach * i / lat
            ring = []
            for j in range(lon):
                b = 2 * math.pi * j / lon
                dv = axis * math.cos(a) + (fwd * math.cos(b) + up * math.sin(b)) * math.sin(a)
                ring.append(center + dv * er * s)
            pts.append(ring)

        def edet(i, j, p, lat=lat, lon=lon, reach=reach):
            a = reach * i / lat
            b = 2 * math.pi * j / lon
            r = math.sin(a) / math.sin(reach)
            return detail(IRIS, r * math.cos(b), 0.5 + 0.5 * r * math.sin(b))

        # the first ring is a single point: the grid's quads there are slivers, which is fine
        geo.add_grid(pts, lambda i, j, p: fm.eye_color, 'eye', close_u=True, flip=(side > 0), detail_fn=edet)

        rim_r = er * s * math.sin(reach)
        loop = []
        n = 20
        for j in range(n + 1):
            b = 2 * math.pi * j / n
            # a touch of almond: the corners sit a little further out than the top and bottom
            rr = rim_r * (1.0 + 0.1 * math.cos(b) ** 2)
            loop.append(center + axis * (er * s * math.cos(reach)) + (fwd * math.cos(b) + up * math.sin(b) * 0.9) * rr)
        geo.tube(loop, lambda t, ang: (0.0017 * s, 0.0017 * s), lambda t, ang, p: fm.lid, 'skin', around=6,
                 up_hint=axis, cap_start=False, cap_end=False)

    # ---- a few real feathers on the crown and nape, so the head's outline is soft
    rows = 12
    for i in range(rows):
        x = lerp(0.0, fm.beak_from - 0.01, (i + 0.5) / rows)
        per = 16
        for j in range(per):
            ang = 2 * math.pi * (j + 0.5 * (i % 2) + rnd.uniform(-0.2, 0.2)) / per
            sx = math.sin(ang)
            crown = smoothstep(0.35, 0.8, sx)
            nape = smoothstep(0.016, 0.004, x)
            if rnd.random() > max(crown * 0.75, nape * 0.9) + fm.fluff * 2.0:
                continue
            xx = x + rnd.uniform(-0.0015, 0.0015)
            px, pz = H.upper(xx, ang)
            p = H.at(xx, px, pz)
            if any((p - H.eye_center(sd)).length < fm.eye[2] * s * 1.25 for sd in (-1, 1)):
                continue
            nrm = H.normal(xx, ang)
            back = (-H.F - nrm * (-H.F).dot(nrm)).normalized()
            tuft(geo, rnd, p - nrm * 0.0008, back, nrm, 0.012 * s * fm.face_feather * rnd.uniform(0.85, 1.2),
                 0.0042 * s * fm.face_feather, head_color_of(fm, xx, pz, p), lift=0.14 + fm.fluff, droop=0.3, segs=3,
                 jitter=0.06, kind=fm.coat, tip_gain=1.1)
    geo.bind = None
    return H


def head_color_of(fm, x, z, p):
    return fm.head_color(fm, x, z, p)


def build(fm=PARENT, seed=5):
    """Returns (geo, bones). bones: name -> (parent, head, tail), parents listed first."""
    rnd = random.Random(seed)
    geo = Geo()
    spine = fm.spine
    nk = len(spine) - 1
    pts_c = [Vector((0, sp[0], sp[1])) for sp in spine]

    def K(k):
        return catmull(pts_c, k / nk)

    def radii(k):
        rx = catmull([sp[2] for sp in spine], k / nk)
        ry = catmull([sp[3] for sp in spine], k / nk)
        return max(rx, 0.003), max(ry, 0.003)

    H = Head(fm)
    joint_pts = [K(k) for k in fm.spine_joints[:-1]] + [H.at(0.06, 0, 0)]
    spine_bind = chain_bind(joint_pts, fm.spine_bones, 0.22)

    # ---- body: one continuous surface from the tail tip to inside the back of the head
    geo.bind = spine_bind
    count = fm.rings
    ks = [nk * i / (count - 1) for i in range(count)]
    path = [K(k) for k in ks]
    t0, t1, t2, t3 = fm.torso

    def rad(t, ang):
        rx, ry = radii(t * nk)
        # a flatter back and a rounder belly on the torso
        k = t * nk
        torso = smoothstep(t0, t1, k) * smoothstep(t2, t3, k)
        ry2 = ry * (1.0 - 0.06 * torso * max(0.0, math.sin(ang)))
        return rx, ry2

    around = 22
    rings = tube_rings(path, rad, around, Z)
    neck_from, neck_to = fm.spine_joints[4] + 0.3, fm.spine_joints[5] - 0.1

    def step(i):
        # feathers shorten up the neck: half a row to each strip on the body, a whole row on the neck
        return fm.row_step if ks[i] < neck_from + 0.4 else min(1.0, fm.row_step * 2)

    plume_skin(geo, rings, lambda i, j, p: fm.body_color(fm, ks[i], math.sin(2 * math.pi * j / around), p),
               rows_along(count, step), 0.014 * fm.coat_scale, kind=fm.skin_kind, cap_start=path[0])
    frames = frames_along(path, Z)

    # ---- real feathers over the drawn ones, where the outline wants to be soft: along the back
    # and belly lines, round the collar, and thinly everywhere else
    for i in range(2 if fm.coat == DOWN else 4, count):
        k = ks[i]
        if k > nk - 0.85:
            break
        tan, right, up = frames[i]
        rx, ry = radii(k)
        neck = smoothstep(neck_from, neck_to, k)
        per = int(lerp(fm.per_ring[0], fm.per_ring[1], neck))
        ruff = fm.ruff(k)
        for j in range(per):
            ang = 2 * math.pi * (j + 0.5 * (i % 2)) / per
            sn = math.sin(ang)
            if sn < -0.86 and t0 + 0.5 < k < t2:
                continue  # the belly between the legs stays smooth
            edge = max(smoothstep(0.55, 0.95, sn), smoothstep(-0.55, -0.9, sn))
            if rnd.random() > fm.tufts + 0.5 * edge * (1.0 - 0.6 * neck) + 0.7 * ruff:
                continue
            nd = (right * math.cos(ang) * ry + up * math.sin(ang) * rx).normalized()
            p = path[i] + right * (math.cos(ang) * rx) + up * (math.sin(ang) * ry)
            base_c = fm.body_color(fm, k, sn, p)
            # where two colors meet, a real feather would lie across the edge as a dark or pale
            # fleck; leave those places to the drawn plumage
            if fm.coat != DOWN:
                other = fm.body_color(fm, k - 0.3, sn - 0.2, p)
                if abs(sum(base_c) - sum(other)) > 0.25:
                    continue
            length = lerp(0.034, 0.016, neck) * (0.75 if k < 2.2 else 1.0) * rnd.uniform(0.85, 1.15) * fm.coat_scale
            tuft(geo, rnd, p - nd * 0.001, -tan, nd, length * (1.0 + 0.5 * ruff), lerp(0.0105, 0.0055, neck) * fm.coat_scale,
                 scale(base_c, 0.92 + 0.06 * ruff), lift=0.16 + 0.22 * ruff + fm.fluff, tip_gain=1.12, kind=fm.coat,
                 segs=3 if fm.coat == DOWN else 4)

    # ---- tail fan: long banded feathers along both sides of the tail tip. They ride on the last tail bone.
    geo.bind = [('tail2', 1.0)]
    tail_tip = K(0.0)
    tail_axis = (K(0.0) - K(1.6)).normalized()  # points backward
    fan_up = (Z + tail_axis * 0.35).normalized()
    fan_right = tail_axis.cross(fan_up).normalized()
    fan_up = fan_right.cross(tail_axis).normalized()
    fan = fm.tail_fan
    if fan:
        per_side = fan['per_side']
        for side in (-1, 1):
            for i in range(per_side):
                f = i / (per_side - 1)  # 0 = nearest the body, 1 = at the tip
                base = K(lerp(1.3, 0.1, f)) + fan_right * (side * lerp(0.02, 0.003, f)) + fan_up * (0.0026 * i)
                ang = lerp(1.38, 0.07, f)
                direction = (tail_axis * math.cos(ang) + fan_right * (side * math.sin(ang)) + fan_up * 0.16).normalized()
                normal = (fan_up + fan_right * (side * 0.22)).normalized()
                length = lerp(fan['length'][0], fan['length'][1], f)
                banded_feather(geo, base, direction, normal, length, fan['width'], fan['bands'], rnd, droop=0.62,
                               fold=0.06, curl=side * 0.06)
        # coverts hiding the roots of the fan
        for i in range(22):
            f = rnd.random()
            side = rnd.choice((-1, 1))
            p = K(lerp(1.5, 0.2, f)) + fan_right * (side * rnd.uniform(0.0, 0.03)) + fan_up * 0.02
            ang = lerp(1.0, 0.2, f)
            dv = (tail_axis * math.cos(ang) + fan_right * (side * math.sin(ang) * rnd.uniform(0.3, 1.0))).normalized()
            tuft(geo, rnd, p, dv, fan_up, 0.07, 0.018, mix(BLUE_BLACK, DEEP_BLUE, rnd.random()), lift=0.12)
    else:
        # the chick's tail is a tuft of down
        for i in range(12):
            side = rnd.choice((-1, 1))
            dv = (tail_axis + fan_right * side * rnd.uniform(0.0, 0.7) + fan_up * rnd.uniform(-0.1, 0.5)).normalized()
            tuft(geo, rnd, tail_tip - tail_axis * 0.004, dv, fan_up, 0.03 * fm.coat_scale, 0.011 * fm.coat_scale,
                 fm.body_color(fm, 0.5, rnd.uniform(-0.5, 1.0), tail_tip), lift=0.2, kind=fm.coat)

    # ---- legs, arms and head, in the rest pose
    for side in (-1, 1):
        leg(geo, rnd, fm, side)
        arm(geo, rnd, fm, side)
    head(geo, rnd, fm)

    # ---- skeleton
    J = fm.spine_joints
    bones = {
        'hips': (None, K(J[2]), K(J[3])),
        'chest': ('hips', K(J[3]), K(J[4])),
        'neck1': ('chest', K(J[4]), K(J[5])),
        'neck2': ('neck1', K(J[5]), K(J[6])),
        'head': ('neck2', K(J[6]), H.at(0.07, 0, 0)),
        'jaw': ('head', H.at(fm.jaw_joint[0], 0, fm.jaw_joint[1]), H.at(0.085, 0, -0.012)),
        'tail1': ('hips', K(J[2]), K(J[1])),
        'tail2': ('tail1', K(J[1]), K(J[0])),
    }
    for side, sfx in ((-1, 'L'), (1, 'R')):
        hip, knee, ankle, foot, toe_tip = leg_joints(fm, side)
        bones['thigh' + sfx] = ('hips', hip, knee)
        bones['shin' + sfx] = ('thigh' + sfx, knee, ankle)
        bones['meta' + sfx] = ('shin' + sfx, ankle, foot)
        bones['toes' + sfx] = ('meta' + sfx, foot, toe_tip)
        shoulder, elbow, wrist, tip = arm_joints(fm, side)
        bones['arm' + sfx] = ('chest', shoulder, elbow)
        bones['hand' + sfx] = ('arm' + sfx, elbow, wrist)
        bones['fan' + sfx] = ('hand' + sfx, wrist, tip)

    # rest the lowest point on the ground
    min_z = min(v.z for v in geo.verts)
    for v in geo.verts:
        v.z -= min_z
    drop = Vector((0, 0, min_z))
    bones = {name: (parent, Vector(head_) - drop, Vector(tail) - drop) for name, (parent, head_, tail) in bones.items()}
    return geo, bones


def parent_leg_color(v):
    return mix(BLUE_BLACK, SLATE, clamp01(v))


def parent_ruff(k):
    # the gold collar stands a little prouder, like a ruff
    return smoothstep(5.95, 6.25, k) * smoothstep(7.05, 6.7, k)


PARENT.body_color = body_color
PARENT.head_color = head_color
PARENT.leg_color = parent_leg_color
PARENT.ruff = parent_ruff
PARENT.fluff = 0.0
PARENT.tufts = 0.07          # the share of body feathers that are real, not drawn
PARENT.skin_kind = PLUMAGE
PARENT.skin = (SKIN, SKIN_PALE)
PARENT.claw = CLAW
PARENT.rings = 72
PARENT.per_ring = (19, 11)
PARENT.row_step = 0.5
PARENT.horn = (HORN, HORN_PALE)
PARENT.lid = LID
PARENT.face_feather = 1.0


# ---------------------------------------------------------------- the chick
# Nothing is known about what a hatchling looked like: no Caudipteryx egg or chick has been
# found. Its relatives' embryos have well-formed bones, so the young were probably up and about
# soon after hatching, like a chicken's or an emu's. So this is a downy, big-eyed, sturdy-legged
# chick, with down in place of the fans. Its colors are a choice: the parent's gone soft (slate
# down, cream below, a first hint of the gold collar). Drew and Aidan picked it from three on
# 2026-11-16; the striped and gold ones are in the repo's history.

SLATE_DOWN = srgb('#56667f')
SLATE_PALE = srgb('#7f8ea4')
SLATE_DARK = srgb('#28324a')
DOWN_CREAM = srgb('#ece2c8')
GOLD_DOWN = srgb('#e2ad45')
CHICK_SKIN = (srgb('#74685f'), srgb('#a8998b'))
CHICK_HORN = (srgb('#4a433d'), srgb('#b7a894'))

CHICK_BASE = dict(
    spine=[
        (-0.050, 0.074, 0.004, 0.004),
        (-0.038, 0.074, 0.010, 0.011),
        (-0.024, 0.072, 0.019, 0.021),
        (-0.006, 0.070, 0.026, 0.028),
        (0.012, 0.069, 0.029, 0.031),
        (0.028, 0.072, 0.027, 0.029),
        (0.039, 0.080, 0.021, 0.023),
        (0.046, 0.091, 0.015, 0.016),
        (0.050, 0.101, 0.012, 0.0125),
        (0.053, 0.110, 0.0115, 0.012),
        (0.058, 0.115, 0.009, 0.009),
    ],
    spine_joints=PARENT.spine_joints,
    spine_bones=PARENT.spine_bones,
    torso=PARENT.torso,
    # the legs are the parent's, 0.145 times the size, so the same poses fit; just stouter
    hip=(0.016, -0.004, 0.0655),
    leg=(FEMUR * 0.145, TIBIA * 0.145, META * 0.145, 0.076 * 0.145),
    leg_thick=1.7,
    rest_leg=REST_LEG,
    shoulder=(0.019, 0.026, 0.079),
    arm=((0.011, (0.42, -0.78, -0.46)), (0.009, (0.55, 0.80, -0.22)), (0.010, (0.66, -0.66, -0.36))),
    arm_thick=1.4,
    # a big round head with a short beak and large eyes
    head_origin=(0.0, 0.050, 0.121),
    head_pitch=math.radians(-4),
    head_scale=0.47,
    head_top=[(-0.004, 0.008), (0.0, 0.020), (0.012, 0.031), (0.028, 0.035), (0.044, 0.031), (0.056, 0.021),
              (0.066, 0.011), (0.074, 0.003), (0.080, -0.005)],
    head_bottom=[(-0.004, -0.004), (0.0, -0.017), (0.014, -0.024), (0.032, -0.024), (0.048, -0.019),
                 (0.062, -0.014), (0.072, -0.011), (0.077, -0.0095)],
    head_mouth=[(0.044, -0.0065), (0.060, -0.0075), (0.072, -0.0085), (0.080, -0.0092)],
    head_width=[(-0.004, 0.009), (0.0, 0.019), (0.013, 0.026), (0.028, 0.027), (0.040, 0.024), (0.052, 0.017),
                (0.062, 0.011), (0.072, 0.006), (0.078, 0.003), (0.080, 0.0015)],
    gape=0.046,
    beak_from=0.054,
    jaw_joint=(0.028, -0.008),
    eye=(0.036, 0.0065, 0.0128),
    teeth=0,
    coat=DOWN,
    coat_scale=0.33,
    tail_fan=None,
    arm_fan=None,
    fluff=0.22,
    tufts=0.75,
    skin_kind=DOWNY,
    skin=CHICK_SKIN,
    claw=srgb('#2a2522'),
    horn=CHICK_HORN,
    face_feather=1.5,
    rings=52,
    per_ring=(16, 10),
    row_step=1.0,
    ruff=lambda k: 0.0,
)


def _down_noise(p, f=60.0):
    return fbm((p.x * f, p.y * f, p.z * f), 1.0, 2)


def _chick_body(fm, k, s, p):
    n = _down_noise(p)
    c = mix(SLATE_DOWN, SLATE_PALE, clamp01(0.4 + n * 2.0))
    c = mix(c, SLATE_DARK, smoothstep(0.55, 1.0, s + n * 0.2) * 0.55)
    c = mix(c, GOLD_DOWN, smoothstep(5.9, 6.3, k) * smoothstep(7.2, 6.8, k) * smoothstep(-0.5, 0.0, s) * 0.8)
    return mix(c, DOWN_CREAM, smoothstep(-0.05, -0.55, s + n * 0.3))


def _chick_head(fm, x, z, p):
    ex, ez, _ = fm.eye
    n = _down_noise(p, 90.0)
    dz = z - ez + n * 0.003
    c = mix(DOWN_CREAM, SLATE_PALE, smoothstep(-0.004, 0.012, dz))
    # a dark line through the eye, like the parent's, and a darker crown
    line = smoothstep(-0.0065, -0.004, dz) * smoothstep(0.006, 0.0035, dz) * smoothstep(0.058, 0.05, x)
    c = mix(c, SLATE_DARK, line * 0.9)
    return mix(c, mix(SLATE_DOWN, SLATE_DARK, 0.5), smoothstep(0.016, 0.021, dz) * 0.8)


CHICK = Form(name='chick', body_color=_chick_body, head_color=_chick_head,
             leg_color=lambda v: mix(SLATE_DOWN, SLATE_PALE, clamp01(v) * 0.5), eye_color=srgb('#3a2414'),
             lid=srgb('#20242c'), **CHICK_BASE)
