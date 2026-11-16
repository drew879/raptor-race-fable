"""Jehol forest plants and props, first pass.

Everything here existed in the Early Cretaceous of Liaoning: conifers, ginkgos, tree ferns,
ferns and horsetails. No grass and no flowers on land.
"""

import math
import random

from mathutils import Vector

from mathutils import Matrix

from lib.geo import (Geo, basis, clamp01, fbm, lerp, mix, ramp, resample, rot, scale, smoothstep,
                     srgb, vnoise)

Z = Vector((0, 0, 1))

# ---------------------------------------------------------------- palette (reference colors)

BARK_DARK = srgb('#3b2a22')
BARK_MID = srgb('#6a4a37')
BARK_WARM = srgb('#8a5f42')
BARK_GREY = srgb('#6f665b')
MOSS_DARK = srgb('#3f5a22')
MOSS_LIGHT = srgb('#8fae3a')
LICHEN = srgb('#b9c3a0')
WOOD_PALE = srgb('#c9a777')
WOOD_DARK = srgb('#7a5a3a')

CONIFER_DARK = srgb('#1d4436')
CONIFER_MID = srgb('#2f6a4a')
CONIFER_LIGHT = srgb('#6fa458')

GINKGO_DARK = srgb('#5c8f2e')
GINKGO_MID = srgb('#93bd3c')
GINKGO_LIGHT = srgb('#cfdc5c')

FERN_DARK = srgb('#24552c')
FERN_MID = srgb('#4b8a3a')
FERN_LIGHT = srgb('#9cc552')
FERN_DEAD = srgb('#8a6a3c')

HORSETAIL_DARK = srgb('#2c5b3a')
HORSETAIL_LIGHT = srgb('#7fb46a')
HORSETAIL_NODE = srgb('#2a2a22')
HORSETAIL_SHEATH = srgb('#d6cf9a')

ROCK_DARK = srgb('#3d3f42')
ROCK_MID = srgb('#6b6a66')
ROCK_LIGHT = srgb('#9a968c')


# ---------------------------------------------------------------- trunks

def trunk(geo, base, height, r_base, r_top, seed, lean=(0.0, 0.0), wobble=0.25, flare=0.5,
          lobes=5, moss=0.6, rings=16, around=12, bark=(BARK_DARK, BARK_MID, BARK_WARM),
          cap_end=True):
    """A tapering trunk with root flare, bark streaks and moss creeping up from the ground.
    Returns the path so branches can attach to it."""
    rnd = random.Random(seed)
    base = Vector(base)
    ph = rnd.uniform(0, 100)
    lobe_phase = rnd.uniform(0, 6.28)
    path = []
    for i in range(rings):
        t = (i / (rings - 1)) ** 1.7  # more rings near the ground, where the flare is
        z = height * t
        off = Vector((vnoise((ph, z * 0.11, 0.0)), vnoise((ph + 31.0, z * 0.11, 5.0)), 0.0)) * wobble * t
        path.append(base + Vector((lean[0] * z, lean[1] * z, z)) + off)

    def radius(t, ang):
        tt = t ** 1.7
        z = height * tt
        r = lerp(r_base, r_top, tt ** 0.85)
        fl = flare * r_base * math.exp(-z / (r_base * 2.4))
        r += fl * (0.55 + 0.45 * math.cos(lobes * ang + lobe_phase))
        r *= 1.0 + 0.05 * math.sin(ang * 9 + ph + z * 0.6) + 0.04 * vnoise((ang * 2.0, z * 0.5, ph))
        return r, r

    def color(t, ang, p):
        z = p.z - base.z
        streak = fbm((math.cos(ang) * 3.0 + ph, math.sin(ang) * 3.0, z * 0.35), 1.0, 3)
        c = ramp([(-0.35, bark[0]), (0.0, bark[1]), (0.35, bark[2])], streak)
        groove = math.sin(ang * 9 + ph + z * 0.6)
        c = scale(c, 0.86 + 0.14 * groove)
        # moss: thick at the base, thinning with height, heavier on one side
        side = 0.5 + 0.5 * math.cos(ang - 2.2)
        m = moss * (smoothstep(r_base * 9.0, 0.0, z) * 0.9 + side * smoothstep(height * 0.5, 0.0, z) * 0.5)
        m *= smoothstep(-0.25, 0.25, fbm((p.x * 2.2, p.y * 2.2, p.z * 1.4 + ph), 1.0, 2) + m - 0.45)
        c = mix(c, mix(MOSS_DARK, MOSS_LIGHT, clamp01(0.5 + streak * 1.6)), clamp01(m))
        # pale lichen freckles higher up
        lich = smoothstep(0.42, 0.55, vnoise((p.x * 5.0 + ph, p.y * 5.0, p.z * 3.0)))
        c = mix(c, LICHEN, lich * 0.45 * smoothstep(0.3, 1.5, z))
        return c

    geo.tube(path, radius, color, 'bark', around=around, cap_start=False, cap_end=cap_end)
    return path


def path_at(path, t):
    x = clamp01(t) * (len(path) - 1)
    i = min(int(x), len(path) - 2)
    return path[i].lerp(path[i + 1], x - i)


# ---------------------------------------------------------------- leaves and fronds

def frond(geo, base, heading, pitch, length, half_width, pairs, droop, rnd, dark, light, mat,
          sway_base=0.15, pinna_droop=0.5, dead=0.0, sweep=0.5, pinna_segs=2, rib=True):
    """A pinnate frond: an arching midrib with paired leaflets, widest about a third along.
    rib=False leaves the midrib out, for models only ever seen from far away."""
    out = Vector((math.cos(heading), math.sin(heading), 0.0))
    side = Z.cross(out).normalized()
    phase = rnd.random()
    n = pairs + 1
    pos = Vector(base)
    step = length / n
    pts = [pos.copy()]
    dirs = []
    for i in range(n):
        t = i / n
        ang = pitch - droop * (t ** 1.3)
        d = (out * math.cos(ang) + Z * math.sin(ang)).normalized()
        dirs.append(d)
        pos = pos + d * step
        pts.append(pos.copy())
    dirs.append(dirs[-1])

    rib_col = mix(dark, srgb('#5a4a2a'), 0.5 + 0.5 * dead)
    if rib:
        geo.tube(pts, lambda t, a: ((0.012 + 0.006 * (1 - t)) * (length / 1.6),) * 2,
                 lambda t, a, p: rib_col, mat, around=3,
                 uv_fn=lambda t, a, p: (lerp(sway_base, 1.0, t), phase), cap_start=False, cap_end=False)

    tint = rnd.uniform(-0.12, 0.12)
    for i in range(1, n + 1):
        t = i / n
        prof = math.sin(math.pi * min(1.0, t ** 0.72)) ** 0.75
        w = half_width * max(prof, 0.08)
        d = dirs[i]
        up = side.cross(d).normalized()
        sway = lerp(sway_base, 1.0, t)
        for s in (-1, 1):
            pdir = (side * s + d * sweep).normalized()
            pw = step * 0.62

            def width(u, pw=pw):
                return pw * (0.35 + 0.65 * math.sin(math.pi * min(1.0, 0.15 + u * 0.85))) * (1.0 - u * 0.25)

            def col(u, sd, t=t):
                c = mix(dark, light, clamp01(0.25 + 0.55 * u + 0.35 * t + tint))
                if dead:
                    c = mix(c, FERN_DEAD, dead)
                return c

            geo.blade(pts[i], pdir, up, w, width, col, mat, segs=pinna_segs,
                      droop=pinna_droop * rnd.uniform(0.7, 1.2), fold=0.18,
                      sway=(sway, min(1.0, sway + 0.25)), phase=phase)


def fern_clump(seed, size=1.0, lod=0):
    """lod 0 is the close-up model, lod 1 a light version for the middle distance,
    lod 2 a handful of broad leaflets for far away."""
    rnd = random.Random(seed)
    geo = Geo()
    count = rnd.randint(7, 10) if lod == 0 else (6, 6, 5)[lod]
    for i in range(count):
        heading = 2 * math.pi * i / count + rnd.uniform(-0.3, 0.3)
        pitch = rnd.uniform(0.75, 1.15)
        length = rnd.uniform(0.55, 0.85) * size
        frond(geo, (rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), 0.0), heading, pitch, length,
              length * (0.2, 0.23, 0.3)[lod], (9, 5, 3)[lod], rnd.uniform(1.5, 2.1), rnd,
              FERN_DARK, FERN_LIGHT, 'foliage_fern', sway_base=0.1, pinna_droop=0.4,
              pinna_segs=2 if lod == 0 else 1, rib=lod < 2)
    # a couple of young upright fronds in the middle
    for i in range(2 if lod == 0 else 0):
        frond(geo, (0, 0, 0), rnd.uniform(0, 6.28), 1.35, 0.4 * size, 0.07 * size, 7, 0.5, rnd,
              FERN_MID, FERN_LIGHT, 'foliage_fern', sway_base=0.1)
    return geo


def tree_fern(seed, height=3.0, lod=0):
    rnd = random.Random(seed)
    geo = Geo()
    r = 0.11 * (height / 3.0) ** 0.5
    fibre = (srgb('#2a1f1a'), srgb('#4a3626'), srgb('#6b4a30'))
    path = trunk(geo, (0, 0, 0), height, r * 1.25, r * 1.1, seed, wobble=0.12, flare=0.35, lobes=7,
                 moss=0.35, rings=(10, 6, 4)[lod], around=(9, 6, 5)[lod], bark=fibre)
    top = path[-1]
    count = rnd.randint(11, 13) if lod == 0 else (9, 9, 7)[lod]
    for i in range(count):
        heading = 2 * math.pi * i / count + rnd.uniform(-0.2, 0.2)
        length = rnd.uniform(1.7, 2.2) * (height / 3.0) ** 0.4
        frond(geo, top + Vector((0, 0, -0.05)), heading, rnd.uniform(0.55, 0.95), length,
              length * (0.2, 0.23, 0.3)[lod], (13, 7, 4)[lod], rnd.uniform(1.25, 1.75), rnd,
              FERN_DARK, FERN_LIGHT, 'foliage_fern', sway_base=0.05, pinna_droop=0.45,
              pinna_segs=2 if lod == 0 else 1, rib=lod < 2)
    # young fronds standing up in the crown
    for i in range(3 if lod == 0 else 0):
        frond(geo, top, rnd.uniform(0, 6.28), 1.3, 0.8, 0.14, 8, 0.45, rnd, FERN_MID, FERN_LIGHT,
              'foliage_fern', sway_base=0.05)
    # a skirt of old brown fronds hanging against the trunk
    for i in range((5, 3, 2)[lod]):
        heading = rnd.uniform(0, 6.28)
        frond(geo, top + Vector((0, 0, -0.18)), heading, -0.5, rnd.uniform(1.0, 1.4), (0.2, 0.2, 0.28)[lod],
              (9, 5, 3)[lod], 0.9, rnd, FERN_DARK, FERN_MID, 'foliage_fern', sway_base=0.05,
              dead=rnd.uniform(0.75, 0.95), pinna_segs=2 if lod == 0 else 1, rib=lod < 2)
    return geo


# ---------------------------------------------------------------- conifer

def conifer_branch(geo, base, heading, length, rnd, droop, phase_seed, lod=0):
    out = Vector((math.cos(heading), math.sin(heading), 0.0))
    side = Z.cross(out).normalized()
    pitch0 = rnd.uniform(0.05, 0.3)
    n = (5, 3, 2, 1)[lod]
    pos = Vector(base)
    step = length / n
    pts = [pos.copy()]
    dirs = []
    for i in range(n):
        t = i / n
        # droop in the middle, then lift again at the tip like a monkey puzzle
        ang = pitch0 - droop * math.sin(math.pi * min(1.0, t * 1.15)) + 0.35 * t * t
        d = (out * math.cos(ang) + Z * math.sin(ang)).normalized()
        dirs.append(d)
        pos = pos + d * step
        pts.append(pos.copy())
    dirs.append(dirs[-1])
    phase = rnd.random()
    wood = mix(BARK_DARK, BARK_MID, 0.4)
    if lod < 3:  # from very far away the branch itself is hidden by its foliage
        geo.tube(pts, lambda t, a: ((0.035 * (1 - t) + 0.008) * (length / 2.5),) * 2,
                 lambda t, a, p: wood, 'bark', around=4 if lod == 0 else 3,
                 uv_fn=lambda t, a, p: (0.5 * t * t, phase), cap_start=False, cap_end=False)
    tint = rnd.uniform(-0.1, 0.1)

    def spray(at, direction, up, ln, sway0):
        def width(u):
            wide = (0.17, 0.24, 0.34, 0.5)[lod]
            return ln * wide * (0.5 + 0.5 * math.sin(math.pi * min(1.0, 0.1 + 0.9 * u))) * (1.0 - 0.35 * u)

        def col(u, sd):
            return ramp([(0.0, CONIFER_DARK), (0.5, CONIFER_MID), (1.0, CONIFER_LIGHT)],
                        clamp01(0.15 + 0.75 * u + tint + (0.08 if sd > 0 else 0.0)))

        geo.blade(at, direction, up, ln, width, col, 'foliage_conifer', segs=(3, 2, 2, 1)[lod],
                  droop=rnd.uniform(0.25, 0.6), fold=0.3, sway=(sway0, min(1.0, sway0 + 0.5)), phase=phase)

    for i in range(1, n + 1):
        t = i / n
        d = dirs[i]
        up = side.cross(d).normalized()
        ln = length * (0.36, 0.5, 0.62, 0.85)[lod] * (0.55 + 0.6 * math.sin(math.pi * min(1.0, t * 0.9 + 0.05)))
        for s in (-1, 1):
            pdir = (side * s * 0.9 + d * 0.75 + Z * -0.12).normalized()
            spray(pts[i], pdir, up, ln * rnd.uniform(0.85, 1.15), 0.25 + 0.5 * t)
    spray(pts[-1], dirs[-1], side.cross(dirs[-1]).normalized(), length * 0.3, 0.7)


def conifer(seed, height=17.0, crown_start=0.42, lod=0):
    rnd = random.Random(seed)
    geo = Geo()
    r = 0.34 * (height / 17.0)
    path = trunk(geo, (0, 0, 0), height, r, r * 0.12, seed, wobble=0.5, flare=0.75, lobes=5, moss=0.7,
                 rings=(18, 9, 6, 4)[lod], around=(12, 7, 5, 4)[lod],
                 bark=(srgb('#3a2620'), srgb('#6e4532'), srgb('#96603f')))
    # a few dead stubs on the bare lower trunk
    for i in range(4 if lod == 0 else 0):
        t = rnd.uniform(0.3, 0.6) ** 1.0 * crown_start + 0.08
        p = path_at(path, t ** (1 / 1.7))
        heading = rnd.uniform(0, 6.28)
        out = Vector((math.cos(heading), math.sin(heading), 0.15))
        ln = rnd.uniform(0.35, 0.8)
        pts = [p + out * (ln * k / 3) + Vector((0, 0, -0.04 * k * k)) for k in range(4)]
        geo.tube(pts, lambda tt, a: ((0.05 * (1 - tt) + 0.012),) * 2,
                 lambda tt, a, pp: mix(BARK_DARK, BARK_GREY, 0.5 + 0.3 * tt), 'bark', around=5,
                 cap_start=False)
    whorls = (13, 8, 6, 5)[lod]
    golden = 2.39996
    for k in range(whorls):
        f = k / (whorls - 1)
        t = lerp(crown_start, 0.97, f)
        p = path_at(path, t ** (1 / 1.7))
        span = math.sin(math.pi * min(1.0, 0.18 + 0.82 * (1 - f) ** 0.8))  # widest low in the crown
        length = (0.9 + 3.0 * span) * (height / 17.0) * rnd.uniform(0.85, 1.1)
        per = ((5 if f < 0.75 else 4), 4, 3, 3)[lod]
        for j in range(per):
            heading = k * golden + 2 * math.pi * j / per + rnd.uniform(-0.2, 0.2)
            conifer_branch(geo, p + Vector((0, 0, rnd.uniform(-0.25, 0.25))), heading, length, rnd,
                           droop=lerp(0.75, 0.25, f), phase_seed=k, lod=lod)
    # leader
    top = path[-1]
    for j in range(4 if lod < 3 else 2):
        heading = j * (1.57 if lod < 3 else 3.14) + 0.4
        d = Vector((math.cos(heading) * 0.35, math.sin(heading) * 0.35, 1.0)).normalized()
        geo.blade(top + Vector((0, 0, -0.3)), d, Vector((math.cos(heading), math.sin(heading), 0.2)), 1.1,
                  lambda u: 0.16 * math.sin(math.pi * min(1.0, 0.15 + u * 0.85)),
                  lambda u, sd: mix(CONIFER_MID, CONIFER_LIGHT, u), 'foliage_conifer', segs=3 if lod < 3 else 1, droop=-0.2,
                  fold=0.3, sway=(0.6, 1.0), phase=0.3)
    return geo


# ---------------------------------------------------------------- ginkgo

def ginkgo_leaf(geo, base, direction, normal, size, rnd, phase, sway):
    """One fan-shaped leaf with the notch that gives Ginkgo biloba its name."""
    f, r, u = basis(direction, normal)
    c0 = mix(GINKGO_DARK, GINKGO_MID, rnd.uniform(0.2, 1.0))
    c1 = mix(GINKGO_MID, GINKGO_LIGHT, rnd.uniform(0.3, 1.0))
    b = geo.vert(Vector(base))
    rim = []
    spread = 1.05
    steps = 4
    cup = rnd.uniform(0.05, 0.25)
    for i in range(steps + 1):
        a = lerp(-spread, spread, i / steps)
        rad = size * (1.0 - (0.16 if i == steps // 2 else 0.0)) * (0.92 + 0.08 * math.cos(a * 2))
        p = Vector(base) + f * (math.cos(a) * rad) + r * (math.sin(a) * rad) + u * (cup * size * abs(math.sin(a)))
        rim.append(geo.vert(p))
    for i in range(steps):
        geo.face([b, rim[i + 1], rim[i]], [c0, c1, c1], 'foliage_ginkgo',
                 [(sway * 0.8, phase), (sway, phase), (sway, phase)], True)


def ginkgo_cluster(geo, center, radius, count, rnd, sway):
    phase = rnd.random()
    for _ in range(count):
        # leaves hang around short shoots, tips outward and a little down
        th = rnd.uniform(0, 6.28)
        el = rnd.uniform(-0.6, 0.9)
        out = Vector((math.cos(th) * math.cos(el), math.sin(th) * math.cos(el), math.sin(el)))
        start = Vector(center) + out * radius * rnd.uniform(0.15, 0.75)
        direction = (out + Vector((0, 0, -0.55))).normalized()
        normal = (out + Vector((0, 0, 0.6))).normalized()
        ginkgo_leaf(geo, start, direction, normal, radius * rnd.uniform(0.34, 0.5), rnd, phase,
                    sway * rnd.uniform(0.8, 1.0))


def limb(geo, start, end, r0, r1, rnd, bark, sag=0.0, segs=6):
    pts = []
    ph = rnd.uniform(0, 50)
    for i in range(segs + 1):
        t = i / segs
        p = Vector(start).lerp(Vector(end), t)
        p += Vector((vnoise((ph, t * 2.0, 0.0)), vnoise((ph, t * 2.0, 9.0)), 0.0)) * 0.12 * math.sin(math.pi * t) * (Vector(end) - Vector(start)).length * 0.5
        p.z += sag * math.sin(math.pi * t)
        pts.append(p)
    geo.tube(pts, lambda t, a: (lerp(r0, r1, t),) * 2,
             lambda t, a, p: ramp([(-0.3, bark[0]), (0.0, bark[1]), (0.3, bark[2])], fbm((p.x, p.y, p.z * 0.5), 1.3, 2)),
             'bark', around=6, uv_fn=lambda t, a, p: (0.25 * t * t, ph % 1.0), cap_start=False)
    return pts


def ginkgo(seed, height=9.0, lod=0):
    rnd = random.Random(seed)
    geo = Geo()
    bark = (srgb('#4a4038'), srgb('#7a6a58'), srgb('#9c8a70'))
    split = height * rnd.uniform(0.36, 0.44)
    r = 0.26 * (height / 9.0)
    leaves = (1.0, 0.36, 0.16)[lod]  # fewer, larger leaves in the distance
    grow = (1.0, 1.45, 2.0)[lod]
    path = trunk(geo, (0, 0, 0), split, r, r * 0.62, seed, wobble=0.3, flare=0.6, lobes=4, moss=0.55,
                 rings=(11, 6, 4)[lod], around=(10, 6, 5)[lod], bark=bark, cap_end=False)
    top = path[-1]
    n_limbs = rnd.randint(4, 5)
    for i in range(n_limbs):
        heading = 2 * math.pi * i / n_limbs + rnd.uniform(-0.35, 0.35)
        reach = rnd.uniform(0.28, 0.5) * height
        rise = rnd.uniform(0.38, 0.58) * height * (1.15 if i == 0 else 1.0)
        end = top + Vector((math.cos(heading) * reach, math.sin(heading) * reach, rise))
        pts = limb(geo, top + Vector((0, 0, -0.15)), end, r * 0.55, r * 0.12, rnd, bark, sag=-0.25,
                   segs=6 if lod < 2 else 3)
        # leaf clusters along the outer two thirds of each limb, plus side twigs
        for k in range(7):
            t = lerp(0.3, 1.0, k / 6)
            p = pts[min(len(pts) - 1, int(round(t * (len(pts) - 1))))]
            jitter = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.5, 0.8))) * height * 0.07
            if k % 2 == 0 and lod < 2:
                twig_end = p + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.1, 0.8))) * height * 0.13
                limb(geo, p, twig_end, r * 0.14, r * 0.05, rnd, bark, segs=3)
                ginkgo_cluster(geo, twig_end, height * rnd.uniform(0.085, 0.11) * grow, int(15 * leaves), rnd, 0.9)
            ginkgo_cluster(geo, p + jitter, height * rnd.uniform(0.09, 0.125) * grow, max(2, int(17 * leaves)), rnd, 0.5 + 0.5 * t)
    return geo


# ---------------------------------------------------------------- horsetails

def horsetail_clump(seed, size=1.0):
    rnd = random.Random(seed)
    geo = Geo()
    stems = rnd.randint(5, 6)
    for s in range(stems):
        a = rnd.uniform(0, 6.28)
        rad = rnd.uniform(0.0, 0.22) * size
        base = Vector((math.cos(a) * rad, math.sin(a) * rad, 0.0))
        h = rnd.uniform(0.6, 1.25) * size
        lean = Vector((math.cos(a), math.sin(a), 0.0)) * rnd.uniform(0.0, 0.16)
        nodes = int(h / (0.11 * size)) + 2
        phase = rnd.random()
        pts = [base + lean * (h * (i / nodes) ** 1.5) + Z * (h * i / nodes) for i in range(nodes + 1)]
        r0 = 0.02 * size

        def col(t, ang, p, nodes=nodes):
            x = (t * nodes) % 1.0
            c = mix(HORSETAIL_DARK, HORSETAIL_LIGHT, clamp01(0.2 + 0.7 * t))
            if x < 0.1 or x > 0.94:
                c = HORSETAIL_NODE
            elif x < 0.3:
                c = mix(HORSETAIL_SHEATH, c, 0.35 + 2.0 * (x - 0.1))
            return c

        # two rings per node so the dark joint bands stay crisp
        dense = []
        for i in range(nodes):
            for f in (0.0, 0.1, 0.94):
                dense.append(pts[i].lerp(pts[i + 1], f))
        dense.append(pts[-1])
        geo.tube(dense, lambda t, ang: (r0 * (1.0 - 0.6 * t),) * 2, col, 'foliage_horsetail', around=4,
                 uv_fn=lambda t, ang, p: (t * t, phase), cap_start=False)
        fertile = rnd.random() < 0.3
        if fertile:
            tip = pts[-1]
            cone = [tip + Z * (0.07 * size * k / 3) for k in range(4)]
            geo.tube(cone, lambda t, ang: (r0 * 1.5 * math.sin(math.pi * (0.2 + 0.75 * t)),) * 2,
                     lambda t, ang, p: mix(srgb('#6a4a2a'), srgb('#b08a4a'), t), 'foliage_horsetail',
                     around=5, uv_fn=lambda t, ang, p: (1.0, phase))
        else:
            for i in range(2, nodes):
                t = i / nodes
                needles = 5
                ln = (0.2 * size) * math.sin(math.pi * min(1.0, t * 0.95)) + 0.03
                for k in range(needles):
                    th = 2 * math.pi * k / needles + i * 0.7
                    d = Vector((math.cos(th), math.sin(th), 0.75)).normalized()
                    c = mix(HORSETAIL_DARK, HORSETAIL_LIGHT, clamp01(0.35 + 0.6 * t))
                    p0 = pts[i]
                    side = Z.cross(d).normalized() * (0.007 * size)
                    v0, v1, v2 = geo.vert(p0 - side), geo.vert(p0 + side), geo.vert(p0 + d * ln)
                    sw = t * t
                    geo.face([v0, v1, v2], [c, c, mix(c, HORSETAIL_LIGHT, 0.6)], 'foliage_horsetail',
                             [(sw, phase), (sw, phase), (min(1.0, sw + 0.3), phase)], True)
    return geo


# ---------------------------------------------------------------- rocks, log

def rock(seed, size=1.0, moss=0.7, shape=None, role='rock', faceted=False, lumpy=1.0):
    rnd = random.Random(seed)
    geo = Geo()
    ph = rnd.uniform(0, 100)
    sx, sy, sz = rnd.uniform(0.8, 1.3), rnd.uniform(0.7, 1.1), rnd.uniform(0.45, 0.75)
    if shape:
        sx, sy, sz = shape
    lat, lon = 9, 14
    rings = []
    for i in range(lat + 1):
        v = i / lat
        phi = math.pi * v
        ring = []
        for j in range(lon):
            th = 2 * math.pi * j / lon
            d = Vector((math.sin(phi) * math.cos(th), math.sin(phi) * math.sin(th), math.cos(phi)))
            rr = 1.0 + lumpy * (0.32 * fbm((d.x + ph, d.y, d.z), 1.3, 3) + 0.1 * vnoise((d.x * 4 + ph, d.y * 4, d.z * 4)))
            p = Vector((d.x * sx, d.y * sy, d.z * sz)) * rr * size * 0.5
            p.z += size * sz * 0.28
            ring.append(p)
        rings.append(ring)

    def col(i, j, p):
        nz = math.cos(math.pi * i / lat)
        n = fbm((p.x * 2.0 + ph, p.y * 2.0, p.z * 2.0), 1.0, 3)
        c = ramp([(-0.3, ROCK_DARK), (0.0, ROCK_MID), (0.35, ROCK_LIGHT)], n)
        m = smoothstep(0.1, 0.6, nz + n * 0.9) * moss
        return mix(c, mix(MOSS_DARK, MOSS_LIGHT, clamp01(0.5 + n * 2.0)), m)

    geo.add_grid(rings, col, role, close_u=True, flip=True, smooth=not faceted)
    return geo


def fallen_log(seed, length=3.8, radius=0.2, height=None, extras=True):
    """Lies along X, across the trail. Low and wide: it has to say 'jump' at a glance.
    height lifts its center off the ground (used by the slide-under arch)."""
    rnd = random.Random(seed)
    geo = Geo()
    ph = rnd.uniform(0, 100)
    n = 18
    zc = radius * 0.92 if height is None else height
    path = [Vector((lerp(-length / 2, length / 2, i / (n - 1)), 0.03 * math.sin(i * 0.7),
                    zc + 0.025 * math.sin(i * 0.5 + 1.0))) for i in range(n)]

    def rad(t, ang):
        r = radius * (1.0 - 0.14 * t) * (1.0 + 0.05 * math.sin(ang * 7 + t * 9) + 0.05 * vnoise((ang, t * 6.0, ph)))
        # splintered ends
        edge = min(t, 1 - t)
        r *= 1.0 - 0.25 * smoothstep(0.03, 0.0, edge) * (0.5 + 0.5 * math.sin(ang * 5 + ph))
        return r, r

    def col(t, ang, p):
        streak = fbm((t * 7.0 + ph, math.cos(ang) * 2.0, math.sin(ang) * 2.0), 1.0, 3)
        c = ramp([(-0.3, BARK_DARK), (0.0, BARK_MID), (0.3, BARK_WARM)], streak)
        up = math.sin(ang)  # ring 'up' is world up for a path along X
        m = smoothstep(0.15, 0.75, up + fbm((p.x * 2.5, p.y * 3.0, ph), 1.0, 2) * 1.2)
        c = mix(c, mix(MOSS_DARK, MOSS_LIGHT, clamp01(0.45 + streak * 2.0)), m * 0.92)
        return c

    geo.tube(path, rad, col, 'prop', around=14, cap_start=False, cap_end=False)
    # pale heartwood showing at each broken end
    for end, sign in ((0, -1), (n - 1, 1)):
        c = path[end]
        rings = []
        for k in range(4):
            f = 1.0 - k / 3
            ring = []
            for j in range(14):
                ang = 2 * math.pi * j / 14
                r0 = rad(end / (n - 1), ang)[0] * f
                spike = 0.09 * (1 - f) * (0.5 + 0.5 * math.sin(ang * 5 + ph)) + 0.03 * (1 - f)
                ring.append(c + Vector((sign * spike, math.cos(ang) * r0 * -sign, math.sin(ang) * r0)))
            rings.append(ring)
        geo.add_grid(rings, lambda i, j, p: mix(WOOD_DARK, WOOD_PALE, clamp01(i / 3 + 0.15 * math.sin(j * 2.1))),
                     'prop', close_u=True, flip=True)
    if not extras:
        return geo
    # two broken branch stubs
    for sx, ang in ((-0.9, 1.0), (0.75, 2.2)):
        b = Vector((sx, 0, radius * 0.9))
        d = Vector((0.15, math.cos(ang), math.sin(ang))).normalized()
        pts = [b + d * (0.1 + 0.3 * k / 3) for k in range(4)]
        geo.tube(pts, lambda t, a: (0.055 * (1 - 0.5 * t),) * 2,
                 lambda t, a, p: mix(BARK_DARK, BARK_MID, 0.3 + 0.5 * t), 'prop', around=6, cap_start=False)
    # bracket fungi stepping up one side
    for k in range(4):
        x = 1.15 + 0.16 * k + rnd.uniform(-0.03, 0.03)
        ang0 = math.radians(205 - 16 * k)
        r0 = radius * 0.93
        c = Vector((x, math.cos(ang0) * r0 * -1, radius * 0.92 + math.sin(ang0) * r0 * -1))
        c = Vector((x, -r0 * 0.92, radius * (0.55 + 0.2 * k)))
        size = rnd.uniform(0.07, 0.11)
        rim = []
        ctr = geo.vert(c + Vector((0, 0.02, 0.012)))
        for j in range(7):
            a = math.pi * j / 6
            rim.append(geo.vert(c + Vector((math.cos(a) * size, -math.sin(a) * size * 0.9, -0.012))))
        for j in range(6):
            geo.face([ctr, rim[j], rim[j + 1]], [srgb('#d9c7a0'), srgb('#8f6a44'), srgb('#8f6a44')], 'prop')
    return geo


def arch_log(seed=81):
    """A giant fallen trunk propped on two boulders: far too tall to jump, with a clean,
    roomy opening underneath that says 'slide' at a glance."""
    geo = fallen_log(seed, length=5.0, radius=0.36, height=0.6 + 0.36, extras=False)
    for side, sd in ((-1, 82), (1, 83)):
        r = rock(sd, 1.0, moss=0.5, shape=(1.15, 1.2, 1.02), role='prop')
        r.transform(Matrix.Translation(Vector((side * 1.95, 0.0, 0.0))))
        geo.merge(r)
    # a short broken limb on top, so the trunk reads as a tree and not a pipe
    for sx, ang in ((-0.6, 1.3), (1.0, 1.9)):
        b = Vector((sx, 0, 0.96 + 0.3))
        d = Vector((0.2, math.cos(ang), math.sin(ang))).normalized()
        pts = [b + d * (0.45 * k / 3) for k in range(4)]
        geo.tube(pts, lambda t, a: (0.08 * (1 - 0.5 * t),) * 2,
                 lambda t, a, p: mix(BARK_DARK, BARK_MID, 0.3 + 0.5 * t), 'prop', around=6, cap_start=False)
    return geo


def boulder(seed=84):
    """Fills a lane and stands taller than the hero can jump: go around."""
    return rock(seed, 1.0, moss=0.5, shape=(0.86, 0.95, 1.12), role='prop', faceted=True, lumpy=1.7)


def lane_tree(seed=85, height=7.0):
    """A conifer standing in a lane. Root flare, moss and a few low dead branches,
    so it reads as a tree and never as a bare pole."""
    rnd = random.Random(seed)
    geo = Geo()
    path = trunk(geo, (0, 0, 0), height, 0.19, 0.13, seed, wobble=0.1, flare=1.0, lobes=5, moss=0.85,
                 rings=14, around=10, bark=(srgb('#3a2620'), srgb('#6e4532'), srgb('#96603f')))
    for z, heading, ln in ((0.95, 2.4, 0.42), (1.45, -0.7, 0.5), (2.05, 1.2, 0.46), (2.7, -2.2, 0.55)):
        p = path_at(path, (z / height) ** (1 / 1.7))
        out = Vector((math.cos(heading), math.sin(heading), 0.25))
        pts = [p + out * (ln * k / 3) + Vector((0, 0, -0.03 * k * k)) for k in range(4)]
        geo.tube(pts, lambda tt, a: ((0.04 * (1 - tt) + 0.01),) * 2,
                 lambda tt, a, pp: mix(BARK_DARK, BARK_GREY, 0.4 + 0.4 * tt), 'bark', around=5, cap_start=False)
    # living branches start well above head height and droop
    for k in range(4):
        zb = 3.2 + k * 0.9
        p = path_at(path, (zb / height) ** (1 / 1.7))
        for j in range(3):
            conifer_branch(geo, p, k * 2.4 + j * 2.09, 1.5 - 0.15 * k, rnd, droop=0.7, phase_seed=k, lod=1)
    geo2 = Geo()
    geo2.merge(geo)
    for i in range(len(geo2.mats)):
        if geo2.mats[i] == 'bark':
            geo2.mats[i] = 'prop'
    return geo2


# ---------------------------------------------------------------- collectibles and the egg

def amber_drop(seed=1):
    """A drop of fossil tree resin. Shader does the glow; this is just the shape."""
    geo = Geo()
    n, around = 12, 14
    path = [Vector((0, 0, lerp(-0.5, 0.62, i / (n - 1)))) for i in range(n)]

    def rad(t, ang):
        # round and heavy at the bottom, drawn up to a blunt point
        r = 0.42 * math.sin(math.pi * min(1.0, t * 0.62) ** 0.9) if t < 0.62 else 0.42 * (1 - (t - 0.62) / 0.38) ** 0.75 * 0.985
        r = 0.42 * (math.sin(math.pi * t / 1.24) if t <= 0.62 else math.cos((t - 0.62) / 0.38 * math.pi / 2) ** 0.8)
        r *= 1.0 + 0.05 * math.sin(ang * 3 + t * 5)
        return max(r, 0.004), max(r, 0.004)

    geo.tube(path, rad, lambda t, ang, p: srgb('#f2a23a'), 'amber', around=around,
             uv_fn=lambda t, ang, p: (ang / (2 * math.pi), t))
    return geo


def egg():
    """Oviraptorosaur eggs were long ovals. UV = (around, along) so the shader can draw
    speckles and the growing crack."""
    geo = Geo()
    n, around = 22, 28
    half = 0.5
    path = [Vector((0, 0, lerp(-half, half, i / (n - 1)))) for i in range(n)]

    def rad(t, ang):
        x = t * 2 - 1
        # a long oval, fuller toward the lower end so it reads as an egg from far away
        r = 0.275 * math.sqrt(max(0.0, 1 - abs(x) ** 2.2)) * (1.0 - 0.13 * x)
        return max(r, 0.002), max(r, 0.002)

    geo.tube(path, rad, lambda t, ang, p: srgb('#7fd3c4'), 'egg', around=around,
             uv_fn=lambda t, ang, p: (ang / (2 * math.pi), t))
    return geo


EGG_BLUE = srgb('#7fd3c4')
EGG_INSIDE = srgb('#e9efe2')


def _true_egg_radius(x):
    """Half width of the close-up egg at x (-1 at the narrow end .. 1 at the blunt end), for a
    shell one unit long. Its cousins' eggs were long: at least twice as long as wide."""
    return 0.226 * math.sqrt(max(0.0, 1 - abs(x) ** 2.3)) * (1.0 + 0.09 * x)


def egg_true():
    """The egg for close-ups, at the proportions of an oviraptorosaur egg (2.2 to 1), one unit
    long. The chase egg above is shorter and fatter on purpose, so it reads from far away."""
    geo = Geo()
    n, around = 30, 36
    path = [Vector((0, 0, lerp(-0.5, 0.5, i / (n - 1)))) for i in range(n)]

    def rad(t, ang):
        r = max(_true_egg_radius(t * 2 - 1), 0.002)
        return r, r

    geo.tube(path, rad, lambda t, ang, p: EGG_BLUE, 'egg', around=around,
             uv_fn=lambda t, ang, p: (ang / (2 * math.pi), t))
    return geo


def eggshell(seed=3, upper=False):
    """Part of the close-up egg after hatching, with a broken, toothed rim and a pale inside.
    upper=False: the narrow end, a cup the chick can sit in. upper=True: the blunt end, a cap."""
    rnd = random.Random(seed)
    geo = Geo()
    around = 44
    rows = 16
    cut = 0.12  # where it broke, in the egg's own -1..1
    teeth = []
    for j in range(around):
        big = 0.16 * abs(math.sin(j * 0.9 + seed)) * (1.0 if j % 5 < 3 else 0.3)
        teeth.append(cut + (big + rnd.uniform(-0.04, 0.04)) * (-1 if upper else 1))

    def ring(x, shrink, j):
        ang = 2 * math.pi * j / around
        r = max(_true_egg_radius(x), 0.002) * shrink
        return Vector((math.cos(ang) * r, math.sin(ang) * r, x * 0.5))

    end = 1.0 if upper else -1.0
    for shrink, color, flip in ((1.0, EGG_BLUE, not upper), (0.93, EGG_INSIDE, upper)):
        grid = []
        for i in range(rows + 1):
            t = i / rows
            row = []
            for j in range(around):
                # rows run from the closed end to the broken rim, which follows the teeth
                x = lerp(end * 0.985, teeth[j], t ** 0.8)
                row.append(ring(x, shrink, j))
            grid.append(row)
        idx, cols, _ = geo.add_grid(grid, lambda i, j, p, c=color: c, 'egg', close_u=True, flip=flip)
        tip = geo.vert(Vector((0, 0, end * 0.5 * (1.0 if shrink == 1.0 else 0.94))))
        for j in range(around):
            tri = [idx[0][j], idx[0][(j + 1) % around], tip]
            if not flip:
                tri.reverse()
            geo.face(tri, color, 'egg')
    return geo
