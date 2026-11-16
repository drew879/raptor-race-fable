"""Caudipteryx zoui, first pass, built standing in a rest pose with a skeleton.
The game poses the skeleton in code (run, jump, slide), so there are no baked animations.

What the fossils tell us and this model keeps:
- about the size of a peacock, long legs built for running, short arms, short tail
- a small head with a short beak-like snout
- a fan of long feathers at the tip of the tail and on each hand, with dark and light banding
  preserved on the tail feathers
- a coat of short downy feathers over the body
Colors beyond the banding are not known, so the palette is a choice: blue-black with
cream bands and a gold collar.
"""

import math
import random

from mathutils import Vector

from lib.geo import (Geo, basis, catmull, chain_bind, clamp01, fbm, frames_along, lerp, mix, ramp,
                     scale, smoothstep, srgb, vnoise)

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
HORN = srgb('#57534c')
HORN_PALE = srgb('#9a9382')
SKIN = srgb('#4a4f58')
SKIN_PALE = srgb('#7c7b73')
CLAW = srgb('#1a1a1c')

# Spine from tail tip to beak tip: (y, z, half width, half height)
SPINE = [
    (-0.300, 0.548, 0.010, 0.010),
    (-0.215, 0.528, 0.026, 0.029),
    (-0.125, 0.503, 0.050, 0.055),
    (-0.030, 0.487, 0.083, 0.089),
    (0.075, 0.478, 0.098, 0.106),
    (0.175, 0.497, 0.089, 0.097),
    (0.240, 0.542, 0.060, 0.068),
    (0.283, 0.605, 0.038, 0.044),
    (0.318, 0.675, 0.029, 0.033),
    (0.352, 0.738, 0.027, 0.030),
    (0.382, 0.772, 0.034, 0.036),
    (0.424, 0.784, 0.036, 0.037),
    (0.468, 0.772, 0.021, 0.023),
    (0.502, 0.760, 0.005, 0.006),
]
NK = len(SPINE) - 1

# Leg segment lengths and the rest pose: angles from straight down, positive = forward.
FEMUR, TIBIA, META = 0.13, 0.20, 0.13
REST_LEG = (math.radians(26), math.radians(-34), math.radians(18), math.radians(88))


def spine_point(k):
    """k in key units, 0 = tail tip .. NK = beak tip."""
    pts = [Vector((0, s[0], s[1])) for s in SPINE]
    return catmull(pts, k / NK)


def spine_radii(k):
    rx = catmull([s[2] for s in SPINE], k / NK)
    ry = catmull([s[3] for s in SPINE], k / NK)
    return max(rx, 0.003), max(ry, 0.003)


# Spine joints (in key units) and the bone that owns each stretch between them.
SPINE_JOINTS = [0.0, 1.7, 3.0, 4.5, 6.0, 7.5, 9.0, 13.0]
SPINE_BONES = ['tail2', 'tail1', 'hips', 'chest', 'neck1', 'neck2', 'head']


def leg_joints(side, angles=REST_LEG):
    def d(a, out=0.0):
        return Vector((side * out, math.sin(a), -math.cos(a))).normalized()

    hip = Vector((side * 0.064, -0.02, 0.452))
    knee = hip + d(angles[0], 0.12) * FEMUR
    ankle = knee + d(angles[1], 0.06) * TIBIA
    foot = ankle + d(angles[2], 0.0) * META
    toe = foot + d(angles[3]) * 0.076
    return hip, knee, ankle, foot, toe


def arm_joints(side):
    shoulder = Vector((side * 0.072, 0.185, 0.535))
    elbow = Vector((side * 0.118, 0.115, 0.497))
    hand = Vector((side * 0.165, 0.145, 0.487))
    return shoulder, elbow, hand


def body_color(k, s, p):
    """k: position along the spine in key units. s: sin of the ring angle (1 = back, -1 = belly)."""
    n = fbm((p.x * 14.0, p.y * 14.0, p.z * 14.0), 1.0, 2)
    c = mix(BLUE_BLACK, DEEP_BLUE, smoothstep(0.1, 0.95, s) * 0.75 + n * 0.5)
    c = mix(c, SLATE, smoothstep(0.35, -0.2, s) * 0.55)
    # pale underside from the throat to under the tail
    under = smoothstep(-0.2, -0.62, s + n * 0.25)
    under *= smoothstep(1.2, 2.6, k) * smoothstep(9.9, 8.8, k) + smoothstep(9.3, 10.2, k) * smoothstep(-0.05, -0.5, s)
    c = mix(c, mix(CREAM_SHADE, CREAM, 0.5 + n), clamp01(under))
    # gold collar where the neck meets the shoulders
    collar = smoothstep(5.95, 6.25, k) * smoothstep(7.05, 6.7, k) * smoothstep(-0.55, -0.1, s)
    c = mix(c, mix(GOLD_DEEP, GOLD, 0.6 + n * 1.5), clamp01(collar * (0.85 + n)))
    # head: dark cap, cream brow line, dark stripe through the eye
    if k > 9.6:
        cap = smoothstep(0.25, 0.5, s)
        brow = smoothstep(0.05, 0.22, s) * (1 - cap)
        c = mix(mix(CREAM_SHADE, CREAM, 0.6), INK, clamp01(cap + smoothstep(-0.15, 0.02, s) * (1 - brow) * smoothstep(-0.55, -0.25, s)))
        c = mix(c, CREAM, brow * 0.9)
    # beak
    beak = smoothstep(11.55, 11.95, k)
    c = mix(c, mix(HORN_PALE, HORN, smoothstep(11.8, 13.0, k) * 0.7 + (0.3 if s > 0 else 0.0)), beak)
    return c


def tuft(geo, rnd, p, t_dir, n_dir, length, width, base_col, tip_gain=1.25, lift=0.14, droop=0.45):
    """A short body feather lying back along the surface. It borrows the body's normal for
    shading, so the coat reads as soft plumage with a broken edge instead of separate scales.
    The whole feather moves with the bone under its root."""
    d = (t_dir + n_dir * lift + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.1).normalized()
    tip = mix(scale(base_col, tip_gain), base_col, 0.45)

    def w(u):
        return width * math.sqrt(max(0.0, math.sin(math.pi * min(1.0, 0.12 + 0.86 * u))))

    outer = geo.bind
    if callable(outer):
        geo.bind = outer(Vector(p))
    geo.blade(p + n_dir * 0.0015, d, n_dir, length, w, lambda u, sd: mix(base_col, tip, u * u), 'feather',
              segs=3, droop=droop, fold=0.22, sway=(0.0, 0.25), phase=rnd.random(),
              shade_normal=(n_dir * 0.85 + d * 0.15))
    geo.bind = outer


def banded_feather(geo, base, direction, normal, length, width, bands, rnd, droop=0.18, fold=0.1,
                   curl=0.0):
    segs = len(bands)

    def w(u):
        root = smoothstep(0.0, 0.22, u)
        tip = math.sqrt(max(0.0, 1.0 - max(0.0, (u - 0.72) / 0.28) ** 2))
        return width * (0.28 + 0.72 * root) * tip + 0.0015

    def col(u, sd):
        c = bands[min(segs - 1, int(u * segs))]
        return scale(c, 0.93 if sd < 0 else 1.0)

    geo.blade(base, direction, normal, length, w, col, 'feather', segs=segs, droop=droop, fold=fold,
              curl=curl, sway=(0.0, 0.5), phase=rnd.random())
    # pale shaft down the middle
    f, r, u_ = basis(direction, normal)
    geo.blade(Vector(base) + u_ * 0.0015, direction, normal, length * 0.9, lambda u: 0.0022 * (1 - u * 0.6),
              lambda u, sd: mix(CREAM, CREAM_SHADE, u), 'feather', segs=4, droop=droop * 0.9, fold=0.0,
              sway=(0.0, 0.5), phase=0.0)


D, C, B = INK, CREAM, SPECULUM
TAIL_BANDS = [BLUE_BLACK, D, C, C, D, D, C, C, D, D, C, D]
ARM_BANDS = [BLUE_BLACK, B, B, C, D, D, C, C, D, D]


def leg(geo, rnd, side, angles=REST_LEG):
    sfx = 'L' if side < 0 else 'R'
    hip, knee, ankle, foot, toe_tip = leg_joints(side, angles)
    geo.bind = chain_bind([hip, knee, ankle, foot, toe_tip], ['thigh' + sfx, 'shin' + sfx, 'meta' + sfx, 'toes' + sfx], 0.16)

    def d(a, out=0.0):
        return Vector((side * out, math.sin(a), -math.cos(a))).normalized()

    def feathered(a, b, r0, r1, around=10, n=8, tufts=True):
        pts = [a.lerp(b, i / (n - 1)) for i in range(n)]

        def rad(t, ang):
            r = lerp(r0, r1, t ** 0.8) * (1.0 + 0.25 * math.sin(math.pi * t) * (1 - t))
            return r, r * 1.12

        def col(t, ang, p):
            n_ = fbm((p.x * 14.0, p.y * 14.0, p.z * 14.0), 1.0, 2)
            return mix(BLUE_BLACK, SLATE, 0.3 + 0.3 * math.sin(ang) + n_)

        geo.tube(pts, rad, col, 'feather', around=around, cap_start=True, cap_end=True, up_hint=Y)
        if tufts:
            fr = frames_along(pts, Y)
            for i in range(1, n):
                t = i / (n - 1)
                tan, right, up = fr[i]
                for j in range(9):
                    ang = 2 * math.pi * (j + 0.5 * (i % 2)) / 9
                    nd = (right * math.cos(ang) + up * math.sin(ang)).normalized()
                    r = lerp(r0, r1, t ** 0.8)
                    base_c = mix(BLUE_BLACK, SLATE, 0.35 + rnd.uniform(-0.2, 0.25))
                    tuft(geo, rnd, pts[i] + nd * r, tan, nd, 0.045 * (1.1 - 0.5 * t), 0.013, base_c, lift=0.14)

    feathered(hip, knee, 0.062, 0.04)
    mid_shin = knee.lerp(ankle, 0.55)
    feathered(knee, mid_shin, 0.04, 0.017, n=6)

    def bare(pts, r0, r1, around=6, cap_end=True):
        def col(t, ang, p):
            front = 0.5 + 0.5 * math.sin(ang)
            return mix(SKIN, SKIN_PALE, front * 0.8)
        geo.tube(pts, lambda t, ang: (lerp(r0, r1, t),) * 2, col, 'skin', around=around, up_hint=Y,
                 cap_start=True, cap_end=cap_end)

    bare([mid_shin, mid_shin.lerp(ankle, 0.5), ankle], 0.014, 0.0115)
    bare([ankle + Vector((0, 0, 0.004)), ankle - Vector((0, 0, 0.004))], 0.0155, 0.0155)  # ankle knuckle
    bare([ankle, ankle.lerp(foot, 0.5), foot], 0.0115, 0.0105)

    # three long toes forward, one small toe behind; the toes move as one piece
    geo.bind = [('toes' + sfx, 1.0)]
    toe_a = angles[3]
    for yaw, length in ((-0.42, 0.058), (0.0, 0.076), (0.42, 0.06)):
        dirv = d(toe_a)
        base_dir = (dirv + Vector((math.sin(yaw) * 0.75, 0, 0))).normalized()
        curl_dir = d(toe_a - 0.55)
        p0 = foot
        p1 = p0 + base_dir * (length * 0.55)
        p2 = p1 + (base_dir * 0.6 + curl_dir * 0.4).normalized() * (length * 0.45)
        bare([p0, p1, p2], 0.0095, 0.0055, around=5, cap_end=False)
        claw_tip = p2 + (base_dir * 0.4 + curl_dir * 0.6).normalized() * 0.02
        geo.tube([p2, p2.lerp(claw_tip, 0.5), claw_tip], lambda t, ang: (0.0052 * (1 - t) + 0.0006,) * 2,
                 lambda t, ang, p: CLAW, 'skin', around=5, up_hint=Y, cap_start=False)
    back = foot + d(toe_a + math.pi * 0.9) * 0.022
    geo.bind = [('meta' + sfx, 1.0)]
    bare([foot, back], 0.007, 0.004, around=5)
    geo.bind = None


def arm(geo, rnd, side):
    sfx = 'L' if side < 0 else 'R'
    shoulder, elbow, hand = arm_joints(side)

    def col(t, ang, p):
        return mix(BLUE_BLACK, SLATE, 0.3 + 0.3 * math.sin(ang))

    geo.bind = chain_bind([shoulder, elbow, hand], ['arm' + sfx, 'hand' + sfx], 0.2)
    geo.tube([shoulder, shoulder.lerp(elbow, 0.5), elbow], lambda t, a: (lerp(0.026, 0.017, t),) * 2, col,
             'feather', around=7)
    geo.tube([elbow, elbow.lerp(hand, 0.5), hand], lambda t, a: (lerp(0.017, 0.011, t),) * 2, col,
             'feather', around=7)
    # hand feathers: a fan sweeping from sideways round to straight back. They ride on the hand.
    geo.bind = [('hand' + sfx, 1.0)]
    n = 8
    for i in range(n):
        f = i / (n - 1)
        ang = lerp(0.25, 1.5, f)  # from mostly outward to mostly backward
        base = elbow.lerp(hand, lerp(0.15, 1.0, 1 - f * 0.85))
        direction = Vector((side * math.cos(ang), -math.sin(ang), -0.12 - 0.1 * f)).normalized()
        normal = (Z + Vector((side * 0.25, 0, 0))).normalized()
        length = lerp(0.19, 0.145, f)
        banded_feather(geo, base + Z * (0.003 * (n - i)), direction, normal, length, 0.026, ARM_BANDS, rnd,
                       droop=0.4, fold=0.06)
    # small covert tufts over the base of the fan
    for i in range(10):
        f = rnd.random()
        p = elbow.lerp(hand, f) + Z * 0.012
        tuft(geo, rnd, p, Vector((side * 0.6, -0.8, 0)).normalized(), Z, 0.05, 0.014,
             mix(BLUE_BLACK, DEEP_BLUE, rnd.random()), lift=0.15)
    geo.bind = None


def build(seed=5):
    """Returns (geo, bones). bones: name -> (parent, head, tail), parents listed first."""
    rnd = random.Random(seed)
    geo = Geo()
    spine_bind = chain_bind([spine_point(k) for k in SPINE_JOINTS], SPINE_BONES, 0.22)

    # ---- body: one continuous surface from tail tip to beak tip
    geo.bind = spine_bind
    count = 64
    ks = [NK * i / (count - 1) for i in range(count)]
    path = [spine_point(k) for k in ks]

    def rad(t, ang):
        rx, ry = spine_radii(t * NK)
        # a flatter back and a rounder belly on the torso
        k = t * NK
        torso = smoothstep(2.0, 3.2, k) * smoothstep(6.5, 5.5, k)
        ry2 = ry * (1.0 - 0.06 * torso * max(0.0, math.sin(ang)))
        return rx, ry2

    def col(t, ang, p):
        return body_color(t * NK, math.sin(ang), p)

    geo.tube(path, rad, col, 'feather', around=18, up_hint=Z)
    frames = frames_along(path, Z)

    # ---- coat: short overlapping feathers lying back along the body
    for i in range(4, count - 12):
        k = ks[i]
        if k > 9.3:
            break
        tan, right, up = frames[i]
        rx, ry = spine_radii(k)
        neck = smoothstep(6.3, 7.4, k)
        per = int(lerp(17, 10, neck))
        for j in range(per):
            ang = 2 * math.pi * (j + 0.5 * (i % 2)) / per
            s = math.sin(ang)
            if s < -0.86 and k > 2.5:
                continue
            nd = (right * math.cos(ang) * ry + up * math.sin(ang) * rx).normalized()
            p = path[i] + right * (math.cos(ang) * rx) + up * (math.sin(ang) * ry)
            base_c = body_color(k, s, p)
            length = lerp(0.05, 0.026, neck) * (0.75 if k < 2.2 else 1.0) * rnd.uniform(0.85, 1.15)
            # the gold collar stands a little prouder, like a ruff
            ruff = smoothstep(5.95, 6.25, k) * smoothstep(7.05, 6.7, k)
            tuft(geo, rnd, p, -tan, nd, length * (1.0 + 0.4 * ruff), lerp(0.017, 0.01, neck), base_c,
                 lift=0.12 + 0.22 * ruff, tip_gain=1.3)

    # ---- tail fan: long banded feathers along both sides of the tail tip. They ride on the last tail bone.
    geo.bind = [('tail2', 1.0)]
    tail_tip = spine_point(0.0)
    tail_axis = (spine_point(0.0) - spine_point(1.6)).normalized()  # points backward
    fan_up = (Z + tail_axis * 0.35).normalized()
    fan_right = tail_axis.cross(fan_up).normalized()
    fan_up = fan_right.cross(tail_axis).normalized()
    per_side = 8
    for side in (-1, 1):
        for i in range(per_side):
            f = i / (per_side - 1)  # 0 = nearest the body, 1 = at the tip
            base = spine_point(lerp(1.3, 0.1, f)) + fan_right * (side * lerp(0.02, 0.004, f)) + fan_up * (0.0035 * i)
            ang = lerp(1.38, 0.16, f)
            direction = (tail_axis * math.cos(ang) + fan_right * (side * math.sin(ang)) + fan_up * 0.16).normalized()
            normal = (fan_up + fan_right * (side * 0.22)).normalized()
            length = lerp(0.225, 0.3, f)
            banded_feather(geo, base, direction, normal, length, 0.034, TAIL_BANDS, rnd, droop=0.62,
                           fold=0.06, curl=side * 0.06)
    banded_feather(geo, tail_tip + fan_up * 0.032, (tail_axis + fan_up * 0.16).normalized(), fan_up, 0.31, 0.035,
                   TAIL_BANDS, rnd, droop=0.62, fold=0.08)
    # coverts hiding the roots of the fan
    for i in range(16):
        f = rnd.random()
        side = rnd.choice((-1, 1))
        p = spine_point(lerp(1.5, 0.2, f)) + fan_right * (side * rnd.uniform(0.0, 0.03)) + fan_up * 0.02
        ang = lerp(1.0, 0.2, f)
        d = (tail_axis * math.cos(ang) + fan_right * (side * math.sin(ang) * rnd.uniform(0.3, 1.0))).normalized()
        tuft(geo, rnd, p, d, fan_up, 0.07, 0.018, mix(BLUE_BLACK, DEEP_BLUE, rnd.random()), lift=0.12)

    # ---- legs and arms, in the rest pose
    leg(geo, rnd, -1)
    leg(geo, rnd, 1)
    arm(geo, rnd, -1)
    arm(geo, rnd, 1)

    # ---- eyes: gold iris, dark pupil
    geo.bind = [('head', 1.0)]
    for side in (-1, 1):
        c = spine_point(11.05) + Vector((side * 0.031, 0, 0.008))
        lat, lon = 6, 10
        rings = []
        for i in range(lat + 1):
            phi = math.pi * i / lat
            ring = []
            for j in range(lon):
                th = 2 * math.pi * j / lon
                dvec = Vector((math.cos(phi) * side, math.sin(phi) * math.cos(th), math.sin(phi) * math.sin(th)))
                ring.append(c + dvec * 0.0105)
            rings.append(ring)

        def ecol(i, j, p):
            if i <= 1:
                return srgb('#0b0b0d')
            if i <= 3:
                return GOLD
            return INK

        geo.add_grid(rings, ecol, 'eye', close_u=True, flip=(side < 0))
    geo.bind = None

    # ---- skeleton
    K = spine_point
    bones = {
        'hips': (None, K(3.0), K(4.5)),
        'chest': ('hips', K(4.5), K(6.0)),
        'neck1': ('chest', K(6.0), K(7.5)),
        'neck2': ('neck1', K(7.5), K(9.0)),
        'head': ('neck2', K(9.0), K(12.5)),
        'tail1': ('hips', K(3.0), K(1.7)),
        'tail2': ('tail1', K(1.7), K(0.0)),
    }
    for side, sfx in ((-1, 'L'), (1, 'R')):
        hip, knee, ankle, foot, toe_tip = leg_joints(side)
        bones['thigh' + sfx] = ('hips', hip, knee)
        bones['shin' + sfx] = ('thigh' + sfx, knee, ankle)
        bones['meta' + sfx] = ('shin' + sfx, ankle, foot)
        bones['toes' + sfx] = ('meta' + sfx, foot, toe_tip)
        shoulder, elbow, hand = arm_joints(side)
        bones['arm' + sfx] = ('chest', shoulder, elbow)
        bones['hand' + sfx] = ('arm' + sfx, elbow, hand)

    # rest the lowest point on the ground
    min_z = min(v.z for v in geo.verts)
    for v in geo.verts:
        v.z -= min_z
    drop = Vector((0, 0, min_z))
    bones = {name: (parent, Vector(head) - drop, Vector(tail) - drop) for name, (parent, head, tail) in bones.items()}
    return geo, bones
