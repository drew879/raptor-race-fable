"""Small modeling toolkit for building Raptor Race models from scripts.

Conventions
- Blender space: X right, Y forward, Z up, meters. Characters face +Y.
- Colors are authored as sRGB hex and stored linear in a per-corner color attribute:
  RGB = painted color, A = baked ambient occlusion.
- UV carries animation data instead of texture coordinates:
  U = sway weight (0 = rigid, 1 = moves freely in wind), V = a random phase per leaf or part.
- A face's material name is its "role" (bark, leaf, feather...). The game picks the shader by role.
"""

import math
import random

import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree


# ---------------------------------------------------------------- color

def srgb(hexstr):
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def scale(c, k):
    return (c[0] * k, c[1] * k, c[2] * k)


def ramp(stops, t):
    """stops: list of (position, color). Linear blend between them."""
    t = max(stops[0][0], min(stops[-1][0], t))
    for i in range(len(stops) - 1):
        a, b = stops[i], stops[i + 1]
        if t <= b[0]:
            k = (t - a[0]) / max(1e-9, b[0] - a[0])
            return mix(a[1], b[1], k)
    return stops[-1][1]


# ---------------------------------------------------------------- math helpers

def clamp01(x):
    return max(0.0, min(1.0, x))


def smoothstep(a, b, x):
    t = clamp01((x - a) / (b - a)) if a != b else (1.0 if x >= b else 0.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def vnoise(p, scale_=1.0):
    """Smooth noise in roughly -1..1."""
    return noise.noise(Vector(p) * scale_)


def fbm(p, scale_=1.0, octaves=3):
    v = Vector(p) * scale_
    total, amp = 0.0, 0.5
    for _ in range(octaves):
        total += noise.noise(v) * amp
        v = v * 2.03
        amp *= 0.5
    return total


def catmull(points, t):
    """Catmull-Rom through a list of Vectors (or floats); t in 0..1 over the whole list."""
    n = len(points)
    if n == 1:
        return points[0]
    x = clamp01(t) * (n - 1)
    i = min(int(x), n - 2)
    f = x - i
    p0 = points[max(i - 1, 0)]
    p1 = points[i]
    p2 = points[i + 1]
    p3 = points[min(i + 2, n - 1)]
    f2, f3 = f * f, f * f * f
    return 0.5 * ((2 * p1) + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 +
                  (3 * p1 - p0 - 3 * p2 + p3) * f3)


def resample(points, count):
    return [catmull(points, i / (count - 1)) for i in range(count)]


def frames_along(path, up_hint=Vector((0, 0, 1))):
    """Tangent, right and up at each point of a path, without twisting."""
    frames = []
    n = len(path)
    prev_right = None
    for i in range(n):
        a = path[max(i - 1, 0)]
        b = path[min(i + 1, n - 1)]
        t = (b - a)
        if t.length < 1e-9:
            t = Vector((0, 1, 0))
        t.normalize()
        if prev_right is None:
            right = t.cross(up_hint)
            if right.length < 1e-6:
                right = t.cross(Vector((1, 0, 0)))
        else:
            right = prev_right - t * prev_right.dot(t)
            if right.length < 1e-6:
                right = t.cross(up_hint)
        right.normalize()
        up = right.cross(t).normalized()
        frames.append((t, right, up))
        prev_right = right
    return frames


def basis(forward, up_hint=Vector((0, 0, 1))):
    f = Vector(forward).normalized()
    r = f.cross(up_hint)
    if r.length < 1e-6:
        r = f.cross(Vector((1, 0, 0)))
    r.normalize()
    u = r.cross(f).normalized()
    return f, r, u


def rot(axis, angle):
    return Matrix.Rotation(angle, 3, Vector(axis))


# ---------------------------------------------------------------- detail coordinates

def detail(kind, across, along):
    """Pack a detail coordinate for the shader. kind is a small whole number, 1 or more, whose
    meaning belongs to the role (on feathers: 1 a vaned feather, 2 a body feather, 3 down).
    across runs -1..1 and along usually 0..1. The kind rides in the first number (kind * 4 +
    across), so a face with no detail, which is all zeros, reads as kind 0."""
    return (kind * 4.0 + across, along)


# ---------------------------------------------------------------- geometry builder

class Geo:
    """Collects polygons with per-corner color and data, then becomes one Blender mesh."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.cols = []     # per face: list of (r, g, b) per corner
        self.uvs = []      # per face: list of (u, v) per corner
        # per face: list of (a, b) per corner, or None. A second set of coordinates the shader
        # draws fine detail from: barbs on a feather, the iris of an eye, scales on a foot.
        # See detail() below for how they are packed.
        self.det = []
        self.mats = []     # per face: role name
        self.smooth = []   # per face: bool
        self.nrm = []      # per face: None, or a normal to use for every corner (soft feather shading)
        # Skinning. Set `bind` to a list of (bone, weight) or to a function of position that
        # returns one; every vertex created while it is set gets those weights.
        self.bind = None
        self.vbind = []    # per vertex: list of (bone, weight), or None

    def face(self, idx, colors, mat, uv=(0.0, 0.0), smooth=True, normal=None, detail=None):
        """colors: one color for the face, or a list with one per corner. uv likewise.
        detail: None, or a list with one packed detail coordinate per corner."""
        if not isinstance(colors, list):
            colors = [colors] * len(idx)
        if not isinstance(uv, list):
            uv = [uv] * len(idx)
        self.faces.append(tuple(idx))
        self.cols.append(colors)
        self.uvs.append(uv)
        self.det.append(detail)
        self.mats.append(mat)
        self.smooth.append(smooth)
        self.nrm.append(normal)

    def vert(self, p):
        v = Vector(p)
        self.verts.append(v)
        b = self.bind
        self.vbind.append(b(v) if callable(b) else b)
        return len(self.verts) - 1

    def add_grid(self, pts, color_fn, mat, uv_fn=None, close_u=False, smooth=True, flip=False,
                 detail_fn=None):
        """pts[i][j] grid of points. color_fn(i, j, p) -> rgb. Makes quads between neighbors.
        close_u wraps j (around) so tubes have no seam.
        detail_fn(i, j, p) -> packed detail coordinate (see detail()). With close_u it is also
        called with j == nj for the last column, so coordinates can run on past the seam."""
        ni = len(pts)
        nj = len(pts[0])
        idx = [[self.vert(pts[i][j]) for j in range(nj)] for i in range(ni)]
        cols = [[color_fn(i, j, pts[i][j]) for j in range(nj)] for i in range(ni)]
        uvs = [[(uv_fn(i, j, pts[i][j]) if uv_fn else (0.0, 0.0)) for j in range(nj)] for i in range(ni)]
        jmax = nj if close_u else nj - 1
        for i in range(ni - 1):
            for j in range(jmax):
                j2 = (j + 1) % nj
                quad = [(i, j), (i, j2), (i + 1, j2), (i + 1, j)]
                det = None
                if detail_fn:
                    det = [detail_fn(a, j + 1 if (b == j2 and j2 != j + 1) else b, pts[a][b]) for a, b in quad]
                if flip:
                    quad.reverse()
                    if det:
                        det.reverse()
                self.face([idx[a][b] for a, b in quad], [cols[a][b] for a, b in quad], mat,
                          [uvs[a][b] for a, b in quad], smooth, detail=det)
        return idx, cols, uvs

    def tube(self, path, radius_fn, color_fn, mat, around=10, uv_fn=None, cap_start=True,
             cap_end=True, up_hint=Vector((0, 0, 1)), smooth=True, twist=0.0, detail_fn=None):
        """Loft a tube along path (list of Vectors).
        radius_fn(t, angle) -> (rx, ry) radii in the right and up directions at t in 0..1.
        color_fn(t, angle, p) -> rgb."""
        n = len(path)
        frames = frames_along(path, up_hint)
        rings = []
        for i in range(n):
            t = i / (n - 1)
            _, right, up = frames[i]
            ring = []
            for j in range(around):
                ang = 2 * math.pi * j / around + twist * t
                rx, ry = radius_fn(t, ang)
                ring.append(path[i] + right * (math.cos(ang) * rx) + up * (math.sin(ang) * ry))
            rings.append(ring)

        def cfn(i, j, p):
            return color_fn(i / (n - 1), 2 * math.pi * j / around, p)

        def ufn(i, j, p):
            return uv_fn(i / (n - 1), 2 * math.pi * j / around, p) if uv_fn else (0.0, 0.0)

        dfn = None
        if detail_fn:
            def dfn(i, j, p):
                return detail_fn(i / (n - 1), 2 * math.pi * j / around, p)

        idx, cols, uvs = self.add_grid(rings, cfn, mat, ufn, close_u=True, smooth=smooth, flip=True,
                                       detail_fn=dfn)
        for end, enabled in ((0, cap_start), (n - 1, cap_end)):
            if not enabled:
                continue
            c = self.vert(path[end])
            cc = color_fn(end / (n - 1), 0.0, path[end])
            cu = ufn(end, 0, path[end])
            for j in range(around):
                j2 = (j + 1) % around
                tri = [idx[end][j], idx[end][j2], c]
                tc = [cols[end][j], cols[end][j2], cc]
                tu = [uvs[end][j], uvs[end][j2], cu]
                if end != 0:  # the end cap faces forward along the path
                    tri.reverse(); tc.reverse(); tu.reverse()
                self.face(tri, tc, mat, tu, smooth)
        return rings

    def blade(self, base, direction, normal, length, width_fn, color_fn, mat, segs=6,
              droop=0.0, fold=0.0, twist=0.0, sway=(0.0, 1.0), phase=0.0, curl=0.0, shade_normal=None,
              kind=0, cup=0.0):
        """A leaf, frond leaflet or feather: a strip with a center spine and two edges.
        width_fn(t) -> half width at t (0 base .. 1 tip). color_fn(t, side) -> rgb, side -1/0/1.
        droop bends the spine toward -normal over its length (radians total),
        fold lifts the edges into a V (radians), curl rolls it sideways.
        sway=(at base, at tip) weights for wind.
        kind: 0 for none, else the detail kind the shader draws on it (see detail()).
        cup: bends the tip back toward the surface it lies on (radians), so a body feather hugs it."""
        f, r, u = basis(direction, normal)
        pos = Vector(base)
        rows = []
        seg_len = length / segs
        for i in range(segs + 1):
            t = i / segs
            ang = -droop * t - cup * t * t
            d = (rot(r, ang) @ f)
            up_i = (rot(r, ang) @ u)
            if twist:
                tw = rot(d, twist * t)
                right_i = tw @ r
                up_i = tw @ up_i
            else:
                right_i = r
            if curl:
                right_i = rot(up_i, curl * t) @ right_i
            w = width_fn(t)
            lift = math.sin(fold) * w
            wx = math.cos(fold) * w
            left = pos - right_i * wx + up_i * lift
            right_p = pos + right_i * wx + up_i * lift
            rows.append((left, Vector(pos), right_p, t))
            pos = pos + d * seg_len
        ids = [(self.vert(a), self.vert(b), self.vert(c)) for a, b, c, _ in rows]
        for i in range(segs):
            t0, t1 = rows[i][3], rows[i + 1][3]
            tm = (t0 + t1) * 0.5
            s0 = lerp(sway[0], sway[1], t0)
            s1 = lerp(sway[0], sway[1], t1)
            for side, (a, b) in ((-1, (0, 1)), (1, (1, 2))):
                quad = [ids[i][a], ids[i][b], ids[i + 1][b], ids[i + 1][a]]
                col = color_fn(tm, side)
                det = None
                if kind:
                    ac = (-1.0, 0.0) if side < 0 else (0.0, 1.0)
                    det = [detail(kind, ac[0], t0), detail(kind, ac[1], t0), detail(kind, ac[1], t1),
                           detail(kind, ac[0], t1)]
                self.face(quad, col, mat, [(s0, phase), (s0, phase), (s1, phase), (s1, phase)], True,
                          normal=shade_normal, detail=det)

    def merge(self, other):
        off = len(self.verts)
        self.verts.extend(other.verts)
        self.vbind.extend(other.vbind)
        for f in other.faces:
            self.faces.append(tuple(i + off for i in f))
        self.cols.extend(other.cols)
        self.uvs.extend(other.uvs)
        self.det.extend(other.det)
        self.mats.extend(other.mats)
        self.smooth.extend(other.smooth)
        self.nrm.extend(other.nrm)

    def transform(self, matrix):
        self.verts = [matrix @ v for v in self.verts]
        return self

    # ------------------------------------------------------------ output

    def to_object(self, name, ao=True, ao_dist=0.6, ao_strength=1.0, ao_samples=24,
                  ground_ao=0.0, sharp_angle=None, weld=None):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        mesh.update()

        roles = []
        for m in self.mats:
            if m not in roles:
                roles.append(m)
        for role in roles:
            mat = bpy.data.materials.get(role) or make_preview_material(role)
            mesh.materials.append(mat)
        mesh.polygons.foreach_set('material_index', [roles.index(m) for m in self.mats])
        mesh.polygons.foreach_set('use_smooth', self.smooth)

        col = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        uv = mesh.uv_layers.new(name='UVMap')
        flat_c, flat_uv = [], []
        for fc, fu in zip(self.cols, self.uvs):
            for c in fc:
                flat_c.extend((c[0], c[1], c[2], 1.0))
            for t in fu:
                flat_uv.extend(t)
        col.data.foreach_set('color', flat_c)
        uv.data.foreach_set('uv', flat_uv)
        if any(d is not None for d in self.det):
            # a second UV layer; it exports as TEXCOORD_1, which the game reads as `uv1`
            layer = mesh.uv_layers.new(name='Detail')
            flat_d = []
            for f, d in zip(self.faces, self.det):
                for k in range(len(f)):
                    flat_d.extend(d[k] if d is not None else (0.0, 0.0))
            layer.data.foreach_set('uv', flat_d)
        mesh.color_attributes.active_color = col
        mesh.color_attributes.render_color_index = 0

        if sharp_angle is not None:
            mesh.set_sharp_from_angle(angle=sharp_angle)
        mesh.update()
        if any(n is not None for n in self.nrm):
            normals = [tuple(n.vector) for n in mesh.corner_normals]
            li = 0
            for fi, f in enumerate(self.faces):
                n = self.nrm[fi]
                for _ in f:
                    if n is not None:
                        normals[li] = tuple(Vector(n).normalized())
                    li += 1
            mesh.normals_split_custom_set(normals)
            mesh.update()

        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        if any(b for b in self.vbind):
            groups = {}
            for i, b in enumerate(self.vbind):
                for bone, w in (b or []):
                    if w <= 0.0:
                        continue
                    g = groups.get(bone) or obj.vertex_groups.new(name=bone)
                    groups[bone] = g
                    g.add([i], w, 'REPLACE')
        if ao:
            bake_ao(obj, dist=ao_dist, strength=ao_strength, samples=ao_samples, ground=ground_ao)
        return obj


# ---------------------------------------------------------------- ambient occlusion

def _hemisphere_dirs(count, seed=7):
    rnd = random.Random(seed)
    dirs = []
    for _ in range(count):
        u, v = rnd.random(), rnd.random()
        r = math.sqrt(u)
        th = 2 * math.pi * v
        dirs.append((r * math.cos(th), r * math.sin(th), math.sqrt(max(0.0, 1 - u))))
    return dirs


def bake_ao(obj, dist=0.6, strength=1.0, samples=24, ground=0.0):
    """Per-corner ambient occlusion by ray casting, stored in the color alpha.
    ground > 0 also darkens near z = 0 over that height, as if resting on soil."""
    mesh = obj.data
    verts = [v.co.copy() for v in mesh.vertices]
    polys = [tuple(p.vertices) for p in mesh.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    dirs = _hemisphere_dirs(samples)
    normals = [n.vector.copy() for n in mesh.corner_normals]
    col = mesh.color_attributes['Col']
    data = [0.0] * (len(mesh.loops) * 4)
    col.data.foreach_get('color', data)
    cache = {}
    for li, loop in enumerate(mesh.loops):
        n = normals[li]
        key = (loop.vertex_index, round(n.x, 2), round(n.y, 2), round(n.z, 2))
        occ = cache.get(key)
        if occ is None:
            p = verts[loop.vertex_index]
            f, r, u = basis(n)
            origin = p + n * 0.004
            hit = 0.0
            for dx, dy, dz in dirs:
                d = (r * dx + u * dy + f * dz)
                res = tree.ray_cast(origin, d, dist)
                if res[0] is not None:
                    hit += 1.0 - (res[3] / dist) ** 1.5
            occ = 1.0 - strength * hit / samples
            if ground > 0.0:
                g = clamp01(p.z / ground)
                occ *= 0.55 + 0.45 * g
            occ = clamp01(occ)
            cache[key] = occ
        data[li * 4 + 3] = occ
    col.data.foreach_set('color', data)
    mesh.update()


# ---------------------------------------------------------------- preview + export

def make_preview_material(role):
    """Blender-side material that just shows the painted colors times AO, for preview renders."""
    mat = bpy.data.materials.new(role)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'Col'
    mul = nt.nodes.new('ShaderNodeMixRGB')
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    nt.links.new(attr.outputs['Color'], mul.inputs[1])
    nt.links.new(attr.outputs['Alpha'], mul.inputs[2])
    nt.links.new(mul.outputs[0], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    mat.use_backface_culling = False
    return mat


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            block.remove(item)


def chain_bind(points, names, blend=0.14):
    """Weights for a limb or spine: points are the joints in order, names the bone for each
    segment between them. Vertices near a joint blend between the two bones that meet there."""
    pts = [Vector(p) for p in points]

    def bind(p):
        best = None
        for i in range(len(names)):
            a, b = pts[i], pts[i + 1]
            ab = b - a
            t = clamp01((p - a).dot(ab) / max(ab.length_squared, 1e-9))
            d = (a + ab * t - p).length
            if best is None or d < best[0]:
                best = (d, i, t)
        _, i, t = best
        if t < blend and i > 0:
            w = 0.5 + 0.5 * t / blend
            return [(names[i], w), (names[i - 1], 1.0 - w)]
        if t > 1.0 - blend and i < len(names) - 1:
            w = 0.5 + 0.5 * (1.0 - t) / blend
            return [(names[i], w), (names[i + 1], 1.0 - w)]
        return [(names[i], 1.0)]

    return bind


def make_armature(name, bones, mesh_obj):
    """bones: dict of bone name -> (parent name or None, head, tail), in order parents first.
    Creates the armature and binds mesh_obj to it using the vertex groups it already has."""
    arm_data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    for bone_name, (parent, head, tail) in bones.items():
        eb = arm_data.edit_bones.new(bone_name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        eb.roll = 0.0
        if parent:
            eb.parent = arm_data.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh_obj.parent = arm
    mod = mesh_obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    return arm


def export_glb(objects, path, skins=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=True,
        export_materials='EXPORT',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=True,
        export_animations=False,
        export_skins=skins,
        export_image_format='NONE',
    )


def render_preview(path, objects=None, eye=(2.2, -3.0, 1.6), target=(0, 0, 0.5), lens=50,
                   size=(900, 900), bg=(0.42, 0.5, 0.48)):
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new('PreviewCam')
    cam_data.lens = lens
    cam = bpy.data.objects.new('PreviewCam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = eye
    direction = Vector(target) - Vector(eye)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam

    sun_data = bpy.data.lights.new('PreviewSun', 'SUN')
    sun_data.energy = 3.2
    sun_data.angle = math.radians(8)
    sun = bpy.data.objects.new('PreviewSun', sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), math.radians(8), math.radians(-40))

    world = bpy.data.worlds.new('PreviewWorld')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (*bg, 1.0)
    world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
    scene.world = world

    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(sun)
