# Raptor Race: working notes

Decisions and progress. Read `raptor-race-brief.md` first; it's the source of truth for what the game is and how Drew likes to work. The brief is committed at the repo root (Drew OK'd that on 2026-11-16). Anything in `docs/local/` stays off the repo.

## Where things stand

- **Milestone 1 (style): done. The look is B, the Painted Diorama.** Drew, 2026-11-16, after trying B+ (B with ink on the animals): "Let's just go with B... it just looks the best." Aidan had picked B too. AB and B+ are out of the code (they are in the history); the pickers are gone.
- **Milestone 2 (rough playable run): done.**
- **Milestone 3 (runner, egg and chick up close): approved.** Drew: "Looks excellent overall." Runner from behind in the run: good. Egg: good. Sit pose: reads. Chick: **Slate** (the other two are deleted). Teeth: keep, but they "strangely" pointed straight ahead; they now hang down under the front of the upper jaw with a slight forward lean. The opening nest will hold a **clutch**, not one egg. The turntable stays at `?mode=close`.
- **Solid obstacles: built in the rough run (build 20), waiting on Drew and Aidan's playtest.** Aidan had noticed the runner and the egg passed straight through obstacles. See "Solid obstacles" below. The course map for Level 1 comes after they are happy with this.
- **Frame rate: holding 60 on the phone** (build 18, Home Screen, late in a long session: 60 fps, 2% late, full sharpness). See "Frame rate".
- Live build: https://drew879.github.io/raptor-race-fable/ now opens the rough run. Close-up: `?mode=close`. Speed test: `?mode=bench`. The old concept frame: `?mode=concept`.
- Hero colors are approved. All seven obstacle kinds are approved (they are kinds, to be repeated and combined).

### Solid obstacles (asked for and built 2026-11-16)
Aidan pointed out that the runner slowed on a hit but slid through the obstacle, and the egg rolled through everything. Drew's instinct: the runner bumps, takes the time penalty, then gets past in a natural way; the egg avoids obstacles altogether. He approved my plan with no changes ("truly indifferent" on which side the runner steps to; yes to the chick's kick).

**The runner** (`startBump`, `stepBump`, `sideBump` in `src/game/run.ts`):
- A head-on bump stops it where its body meets the obstacle (`FACE`: its hips stop 0.5 to 0.74 m short of the obstacle's middle, because its chest and head reach ahead of its hips). It recoils for 0.18 s with a flinch (rears back, arms and fans thrown wide, eyes shut), a puff of dust, a short shake, and the view running on a little before settling.
- Then it gets past in 0.5 s by the move it should have made: scrambles over a log, ducks under an arch, steps round a tree or boulder to the nearest open lane (with one open on each side, the one the egg took).
- Swiping into a tree or boulder that is already alongside is a sideways knock: it bounces back to the lane it came from and runs slow for half a second.
- A swipe made mid-bump is kept and happens the moment the runner can act.
- **Nobody is bumped who would have made it under the old rules.** The old test (inside the obstacle without having jumped, slid or moved over) still decides late moves. The early stop at the face only applies when no move has been made at all, and at each kind's distance a move begun there could not have succeeded anyway.
- Every bump lets the egg get 3.2 m further ahead, the same as a stumble did. The runner itself loses about 0.6 s.

**The egg** (planned from the course, per row of obstacles):
- Round trees and boulders it swings into an open lane from 7.5 m out (`eggUAt`). Of two open lanes it takes the one without amber, so it never hides the line worth following.
- Over logs it hops: 0.85 m high, covering 2.3 m either side, with a quick swell and a faster spin as the chick "kicks" (`HOP_*`).
- Under arches it stays on the ground and turns to roll like a barrel, long way across the trail, then is tipped back into its tumble.
- For 7.5 m before a log or an arch it stops bouncing, so it arrives on the ground.
- It keeps its own steady pace now (`eggV`, following a smoothed copy of the runner's speed), so it rolls on when the runner stops dead.

**Checked by simulated runs** at speeds 8 and 11: a runner that never swipes (22 head-on bumps, finishes in 78.8 s against 65.4 s clean), one that plays perfectly (no bumps), and one that swipes into every tree and boulder from the side. In none of them is the runner or the egg ever inside an obstacle, apart from the single frame in which a sideways knock is detected.

**Not built yet:** sounds for the bump and the kick; a creek (a miss there is a splash and a slow wade, nothing to bump); the chick showing in the egg's hole when it kicks.

**The body turns into a lane change** (asked for the same day): the runner's body yaws toward its real heading, up to 17 degrees, on top of the lean it already had. `st.heading` in `run.ts`.

### What the rough run has
- A 530 m test course (about 66 s at 8 m/s) in `src/game/course.ts`: 25 decision points, never closer than 12 m (1.5 s). Order: lanes, jumps, slides, a steep clear drop with a view, a mixed section, a second drop, a short finish. This is a feel test, not the Level 1 layout.
- The hero is rigged (19 bones) and posed in code: run cycle tied to distance, jump, slide, lane lean, stumble (`src/hero/rig.ts`). Stride length grows with speed (see Round 2). `?mode=hero&cam=side&state=run|jump|slide|stand&phase=0.25&speed=8` is a test view; without `phase` the hero now travels over the ground (`travel=0` runs on the spot).
- Swipe and arrow-key controls, jump buffering, fast-fall into slide. One touch makes one move.
- Four obstacle kinds so far: boulder and lane tree (go around), log (jump), propped trunk arch (slide). Creek, hollow log and Psittacosaurus are still to build.
- The egg tumbles ahead; clean running closes the gap (down to 4.8 m), a hit adds 3.2 m, capped at 17 m with a warning. Losing the egg is not in yet.
- Amber lines and arcs, a count, first-time hints, a pause sheet (resume, start over, speed 4 to 11 m/s, egg Steady/Wobbly/Lively), a finish sheet with "Run again" that resets everything.
- The camera ducks under arches a moment after the hero.
- Lane hints: each lane is a slightly paler worn track, with a thin broken seam of moss and litter between lanes. Drawn in the ground shader from trail coordinates (no grass: it had not evolved yet).
- Forest is laid out in 13 m chunks at four levels of detail (`src/game/flora.ts`) and drawn with one call per model part for the whole view. Ground is one mesh showing only the stretch near the runner; amber, mist and sun shafts are one call each. About 50 draw calls and 0.4 to 0.6 million triangles a frame.

### Round 2 (2026-11-16), from Drew's playtest of build 8
- Default speed 8 (he first thought 10, settled on 8 for an introductory level). The saved speed was reset (`rr-speed2`).
- One swipe changes one lane, however long the swipe.
- He is on the fence about holding a slide by swiping down again and again. Left as is for now.
- The egg rolled backwards and at a fixed 45 degrees. It now always turns forward. Three ways of rolling are on the pause sheet so he can compare: Steady (end over end), Wobbly (the axis swings with its path), Lively (wobbly, and each bounce depends on how it lands: on an end it kicks up high, on its side it skips low). Lively is the default and my pick. It is a few lines of rules, not a physics engine.
- The torn-paper edge around the screen is gone from play: he wants the world to reach the edges. It could come back on pages that are pages (Field Journal, results).
- Top row moved down 14 points in the Home Screen app, out of the blur band.
- Bottom strip in the Home Screen app: see "Things learned". Drew confirmed on build 13 that the strip is gone and the top row is clear ("Both perfect!"). The pause sheet read view 440x956, window 440x956, top 62, bottom 34.
- Lanes: "great, and if anything could be slightly more subtle". Softened a little; on build 15 he called them "perfect".
- Sun rays: on build 15 they were "much more noticeable (and looked better, if perhaps a bit too intense at points)". They got stronger because all the mist is now drawn before all the shafts, so mist no longer veils a shaft behind it. Kept that, turned the amount down about a sixth, and made shafts far down the trail thin out so a row of them can't stack into a glare.
- Egg: he loves Lively. The other two ways stay on the pause sheet for now.
- **For the real level, from Drew:** in the test run he caught up to the egg quickly, so it felt like being stuck behind it, not chasing it. In the level, the egg should get well ahead after the opening scene and the runner should close on it slowly across the whole run.
- **Longer stride (build 13).** Drew said the legs moved "impossibly fast, almost like a hummingbird's wings" and asked for slightly longer strides at a slightly lower step rate. Built in a side session, shown to him as a before and after clip, and approved ("Yes, use it"). Stride length now follows the rule used to read speed from fossil trackways (stride / hip height = 2.3 x (speed squared / (g x hip height)) to the 0.3, hip height 0.45 m), times 1.15. At speed 8 that is 2.65 m a stride and 6.0 steps a second, down from 1.9 m and 8.4. Each foot is planted for about 0.57 m of ground at any speed and the rest is float, so a planted foot barely slides. `STRIDE_STRETCH` in `src/hero/rig.ts` is the one number to turn if he wants it longer or shorter.
- Part of the hummingbird look was the frame rate, not the gait: at 22 fps and 8.4 steps a second the phone drew fewer than 3 frames per step. Judge the stride again once the phone runs smoothly.

### Frame rate
Build numbers here are the ones shown on the phone.
- **Build 8: 22 fps on the phone.** The paint shader worked noise out per pixel, and the phone was bound by that. Moving noise to a texture (build 12) fixed it.
- **Build 13 speed test (iPhone 16 Pro Max, Chrome, 880 by 1530, about 250 draw calls):** as played 10.8 ms; no edge smoothing 10.8; no ink and paper pass 12.3; three quarters sharp 12.7; half sharp 10.6; no forest 7.9; no sun shadows 12.5; half sharp and no forest 7.7; half sharp and no smoothing 11.3.
- **Build 15 speed test (same phone, Home Screen app, 880 by 1912, 47 draw calls):** as played 8.5 ms; no edge smoothing 6.6; no ink and paper pass 8.2; three quarters sharp 5.9; half sharp 7.6; no forest 5.2; no sun shadows 8.9; half sharp and no forest 5.4; half sharp and no smoothing 8.2.
- Readings wobble by one or two milliseconds, so only big gaps mean anything.
- **What the two tests say together:**
  - Pixels are not what costs on this phone. Sharpness, the ink pass and shadows make no clear difference in either test.
  - Cutting draw calls from about 250 to about 50 helped, but less than I expected: the frame went from 10.8 to 8.5 ms on a taller picture, and the floor with no forest from 7.7 to 5.4 ms.
  - The forest still costs about 3 ms with a quarter of the draw calls it had. So the forest's cost is its triangles (about 0.4 million), not its draw count. My draw-call reading after build 13 was only partly right.
  - The speed test itself adds something to every reading (it waits on the graphics chip every six frames), so the floor is lower than it looks.
- **In play (build 15, pause sheet late in a run):** 60 fps, late frames 2%, longest 33 ms, 51 draws. That is the number that matters, and it is good.
- **What changed between 13 and 15:** each plant model drawn once for the whole view; ground, ridges, amber, mist and sun shafts one call each; shadow map redrawn every 2.5 m of trail, not every fifth frame.
- **The sharpness governor** (`src/app/quality.ts`) has been wrong on this phone four times. Build 12's version walked sharpness to 50% for nothing. Build 15's ran a trial after a burst of late frames, saw the next second was calm, took that as proof and sat at 70%. Build 16's waited for three slow seconds first and still ended a run at 70%. The current one (build 18) is built to doubt:
  - It only judges frames during play (`view.steady()`), never while the start, pause or finish sheet is up. The sheets blur the picture behind them, and whatever that costs says nothing about how fast the forest draws. This is my best guess at what fooled build 16, not a proven cause.
  - After three slow seconds it tries half sharpness for a second. If that looks better, it goes back to the old sharpness for a second; only if the slowness comes back does it settle low and climb. A hitch that passes on its own ends at full sharpness.
  - It keeps a short history, printed in the pause sheet's small print as "sharpness log: ...", so the next screenshot says what it did and why. No more guessing.
  - Simulated on made-up phones (healthy, short and long hitches, slow under a sheet, always slow, truly bound by pixels): all end where they should.
  - The saved setting's key is `rr-scale4`, so the phone starts at full sharpness.
- **What build 18's log said** (Drew's pause sheet, 14 minutes into a session at speed 11): "143s half: 0% late, checking · 144s 80%: 2% late, it passed · 263s up to 90% · 856s up to 100%", and full sharpness at the end. So the hitch check worked as designed at 143 s. But the picture was already at 80% by then, which means an earlier check, in the first two minutes, did find slowness that came back at full sharpness. Its lines had scrolled off (only four were shown).
- **A likely cause, measured on the Mac:** the first 40 m of the test course has the most forest in view of anywhere, 600 to 640 thousand triangles against 400 to 500 thousand for the rest (the speed test's two spots are at 405 and 435). Every run starts there. Not proven on the phone.
- **Changes after that:** play is not judged for six seconds after any sheet (the heavy stretch passes in five at speed 8); the log shows eight lines; a failed step up waits 30 s, doubling to two minutes at most (it was 45 s to ten minutes), so a dip can't linger; and the speed test has two new lines, "start of the run" and "start of the run, half sharp", so the phone can say whether the start is really slower.
- **For the real level:** keep the opening stretch's forest no heavier than the rest.
- **Build 19 on the phone settled part of this.** Speed test: as played 8.6 ms, half sharp 7.5; start of the run 9.1 ms, start of the run half sharp 5.9. So the start is the one place where pixels clearly cost. Pause sheet, 6 minutes into a session at speed 11: "359s 3 slow seconds (57% late), trying half · 360s half: 2% late, checking · 362s 100%: 68% late again, staying at half · 378s up to 60%". That is no false alarm: at full sharpness more than half the frames were late, at half almost none, and it came straight back. The governor did the right thing.
- **So why does play struggle when the speed test says a frame takes 8.6 ms?** The speed test hides the on-screen buttons. In play, the amber count and the pause button each blurred the 3D picture behind them (`backdrop-filter`), which makes the phone's compositor redo that blur over the full-size picture every frame, a cost the speed test never saw and one that shrinks with sharpness. That is my best explanation, not yet proven. Build 20 removes the blur from everything that is on screen during play (the sheets keep theirs; they are not judged). The other suspect is the phone slowing its graphics chip when it is warm or when the load looks light.
- If build 20 still drops sharpness in play, next tries: 2x edge smoothing in place of 4x (the speed test puts 4x at 1.6 ms), then drawing at 1.75 pixels per point in place of 2.
- **Headroom:** about 8 ms of a 16.7 ms budget by the speed test. If the real level needs more, the lever is forest triangles (lighter middle-distance models, fewer far plants).

### The close-up (milestone 3, built 2026-11-16)
`?mode=close` is a turntable: drag to spin, pinch to zoom. Subjects: Runner (Stand, Run, Sit), Egg, Chick (Stand, Hatched), Family (all three at true size). The animals blink, breathe, glance at the camera and call now and then. Code in `src/closeup/scene.ts`.

**The runner was rebuilt for close range** (`art/hero.py`). What changed, and where it comes from:
- A real head: short and deep with a large eye (the skull is 76 mm in the first skeleton found; ours is about 86 mm with feathers and beak, a small stylization). Upper beak and a lower jaw on its own bone, so the beak opens. A drawn gold eye with pupil, iris, a catchlight and lids that blink.
- Four small teeth on each side under the front of the upper jaw, the first the largest; the lower jaw had none. In the fossils they lean forward. Modeled that way they looked like tusks (Drew: "strangely pointing straight ahead"), so they hang mostly down with a slight forward lean and a hooked tip. The horny beak itself is inferred, not preserved.
- Fourteen feathers on each hand, on the second finger, shortest at the fingertip (about 30, 64 and 95 mm from the tip inward in the fossils; the longest known is 182 mm). Three fingers, claws on the first two; the third was a small splint and is hidden.
- Eleven tail feathers a side (eleven are preserved on one side of the first skeleton). They are 20 to 26 cm here, a little shorter than before; the fossils' own lengths are not well published (15 to 20 cm in popular sources).
- Toes: third longest, then second, then fourth, with a small first toe held off the ground on the inner side (whether it pointed backward is debated).
- Body feathers in the fossils are short and downy, up to 14 mm. So the coat is now mostly drawn by the shader as rows of small feathers, with a thin scatter of real ones to keep the outline soft. This replaced the big feather cards, which looked like cut paper up close. The model went from 15,000 triangles to about 20,000 even with the new head, hands and feet.
- The blue-black body has some support: pigment studies found black feathers across the body, plus the banded tail. Not a full color map.
- Two new bones: `jaw`, and `fanL`/`fanR` (the hand that carries the fan). 22 in all.

**The rig** (`src/hero/rig.ts`) gained: `sit` (folded legs like a bird on a nest, arms and fans spread), `lookYaw` / `lookPitch`, `beak`, `blink` (with `blinkAt(time)` for a natural rhythm), `idle` (breathing). `new HeroRig(model, scale)` takes the legs' size against the parent's, so the chick uses the same poses.

**The chick** is the same script with a different `Form` (proportions, down in place of fans, colors), so it shares the skeleton. Nothing is known about a real hatchling: no Caudipteryx egg or chick has been found. Its relatives' embryos have well-formed bones, so chicks were probably up and walking soon after hatching; the down and colors are our choice. Its colors are the parent's gone soft: slate down, cream below, a first hint of the gold collar ("Slate", picked by Drew and Aidan from three; I had favored a striped one). The model is `chick.glb`, 1.9 MB, fetched the first time it is shown.

**The egg up close** is its own model (`egg_true`, 2.2 times as long as wide, about 8 cm), matte and finely speckled with a faint lengthwise grain, plus two broken shell pieces. Size and shape come from oviraptorosaur eggs (always at least twice as long as wide; the smallest well-known kind is 9 to 11 cm; one kind has blue-green pigment). The chase egg stays short, fat and oversized so it reads from far away.

**For the story scenes later** (from the same fact check): oviraptorosaur nests held many eggs in pairs, in rings, blunt ends up; adults have been found sitting on them with arms spread round the edge; which parent sat is unknown (possibly the father). The game says "parent", which is right. Drew chose a clutch for the opening nest (2026-11-16), with ours the one that rolls away.

### Not yet verified on the real phone
- Solid obstacles and the body turn (they work on the Mac and pass the simulated runs).
- Whether removing the blur behind the in-play buttons keeps sharpness at full.
- The re-angled teeth.

### Next
- Drew and Aidan's playtest of bumps and the egg's dodges. Then the course map for sign-off (milestone 4).
- Known rough spots on the runner: the sitting pose is a first pass; the chick's down is made of flat cards (fine at its size, visible zoomed right in).

## How the code is laid out

- `art/` Blender scripts. `art/lib/geo.py` is the modeling toolkit (lofted tubes, leaf and feather blades, painted vertex color, baked occlusion, and a second set of "detail" coordinates the shader draws fine detail from). `art/hero.py` (the runner and the chick), `art/plants.py` (plants, props, eggs) build the models; `art/build_all.py` exports them to `src/assets/models/` (`npm run art`, or `npm run art -- -- flora` for one kit). `art/icon.py` renders the app icon (a placeholder for now).
- `src/render/paint.ts` the one shader family for the whole world. Models carry painted color and occlusion in a vertex attribute and wind data in UV; each face's material name is a "role" (bark, foliage_fern, feather...) that picks a shader variant. Feather, skin and eye roles also read `uv1` (detail coordinates) and draw barbs and shafts, rows of plumage, foot scales, and the eye from them, so that detail costs no triangles and stays crisp at any distance.
- `src/render/styles.ts` a style direction is a full set of values for the paint shader, sky, soft effects and finishing pass. Geometry never changes between styles.
- `src/render/post.ts` finishing pass: ink outlines found from depth, paper grain, final grade.
- `src/render/noisetex.ts` one small tiling noise texture, read by the paint shader, the finishing pass, mist and shafts.
- `src/render/shadow.ts` sun shadow map. Trunks, tree ferns and everything low cast real shadows; the high canopy's shade is painted as dappled light so it can be art-directed.
- `src/world/` track (the trail's centerline from segments of length, turn and slope), terrain (a hillside ribbon in trail space: s along, u across), assets (model kits, instancing), sky (ridges, volcano), fx (mist, shafts, glows, contact shadows).
- `src/game/` the run: `course.ts` (the test course), `run.ts` (state, rules, camera), `flora.ts` (forest streaming), `input.ts` (swipes), `hud.ts` (controls and sheets).
- `src/hero/rig.ts` poses the hero's skeleton in code. `src/herolab/` is its test view. `src/closeup/` is the turntable for the runner, egg and chick.
- `src/lookdev/` the concept viewer scene and its controls. This goes away or moves behind a debug flag once the game proper starts.
- `src/app/` build number and self-update, full-screen sizing, the sharpness governor (`quality.ts`) and the on-device speed test (`bench.ts`).

## Things learned so far

- Downhill reads when (1) the trail tips over a crest and drops out of sight, (2) a slot is kept clear of tall trees so the valley, stacked ridges and volcano show beyond, and (3) trunks rise from below the crest. A camera 1.45 m up and 2.6 m behind the hero, looking 14 m ahead, puts the horizon about a third of the way down the screen.
- A crest hides what is behind it. For gameplay, keep hidden stretches at least 3 seconds ahead of the runner, or flatten the crest (brief rule: nothing hides behind a crest).
- Solid canopy shadows made the trail and hero muddy. Dappled light with a coverage dial reads better and stays controllable.
- The hero, egg and obstacles get less shade than the scenery on purpose, so they never get lost.
- **The Home Screen strip.** On iOS 26 and later, a Home Screen app that draws under the status bar gets a viewport short by the status bar's height (62 points on this phone) and paints nothing below it, however tall you make a fixed element (WebKit bug 301108). Forcing the 3D view to the screen's height, which build 8 did, only cut the picture's bottom off. The viewport is short only while the page is shorter than the screen, so the fix other projects use is a page-level rule in standalone mode: `html { min-height: min(100lvh, calc(100% + env(safe-area-inset-top))) }`. That is in `style.css`; the 3D view is now plain `position: fixed; inset: 0` and `viewport.ts` just reads its size. Confirmed on Drew's phone (iOS 27.2). There is no simulator on this Mac (Xcode is not installed), so Home Screen layout can't be tested here.
- The blur band under the status bar comes with drawing under it; it can't be turned off. The only way to lose it is the opaque status bar style, which gives up the top 62 points. We keep drawing under it and start the top row 14 points lower.
- Procedural noise in a fragment shader is expensive on a phone. Read it from a texture.
- **Keep draw calls low, but don't expect miracles from it.** Going from about 250 draws to about 50 took the phone's frame from 10.8 to 8.5 ms. Draw each model once for the whole view (shared instance lists, refilled when a chunk changes level), and give soft effects one instanced mesh each. Never one mesh per chunk per model. The forest's own cost turned out to be its triangles.
- One changed thing per test. Build 15 changed draw calls, shadow timing and the governor together, so the phone's better result can't be pinned on any one of them.
- Measure on the phone before tuning for it. The Mac said edge smoothing was the biggest cost left; the phone said it was free.
- Noise baked on a grid peaks on the grid, so a threshold through it (dapples, pebbles) shows dots in rows. The baked texture is read through a gentle wrapping warp, with each layer offset by part of a cell.
- A sharpness governor must check that fewer pixels actually helps before keeping a lower setting, and a calm second after a hitch is not proof.
- Drawing all the mist before all the sun shafts makes the shafts read much stronger than sorting them together did.
- Timing frames: `requestAnimationFrame` can't see anything faster than the screen. To time drawing, draw N frames then read one pixel back (that waits for the graphics chip) and divide. Reading back after every frame adds several milliseconds and misleads. Short bursts also read slow because the chip speeds up under load: warm up for a third of a second first.
- Thin outlines on far trees made the distant forest scratchy on the phone. In AB the scenery's lines fade out between 14 and 46 m, while the runner, egg, amber and obstacles keep theirs at any distance, so ink also marks what matters.
- **Draw fine detail, don't model it.** Feather cards big enough to see read as cut paper up close, and enough small ones would cost tens of thousands of triangles. Rows of feathers drawn by the shader on a smooth skin look finer and cost nothing; a thin scatter of real feathers keeps the outline soft. Each drawn row needs a whole number of feathers round it, so the model passes that count per strip of the mesh.
- Blender's glTF export flips the second number of every UV pair (v becomes 1 - v), including the second UV layer. The shader flips it back.
- An eye drawn in the shader (pupil, iris, catchlight, lids) gives a blink for one number and stays round at any zoom.
- Editing Python from a shell here-document: never nest the same triple quotes inside the script's own strings. It fails before anything is written.
- Triangle budget matters: the first pass drew about 4.7 million triangles a frame. With light models for the distance and planting only what the frame sees, it's about 0.9 million and 6 ms a frame on the M1 Pro. The real game needs chunked streaming and the same light models.
- The Browser pane used for testing throttles animation when the Claude window isn't in view. Test the run with fixed time steps instead (stop the animation loop, call `rr.view.update(t, rr.renderer)` in a loop, then `rr.post.render(...)`); `?nopause=1` keeps the run from pausing itself when the page is hidden. `window.rrGame` exposes state, `act()`, `reset()`.
- In a slide the camera has to duck too, or the arch fills the screen as it passes.
- The egg should not roll down a lane's center: it hides amber. It weaves between lanes instead.
- Rig pitch convention: positive swings a hanging leg forward, which is the same turn that lifts the nose. Nose-down and tail-up are negative.
- The egg is drawn much larger than life during the chase so it reads from a distance. Bring it back to a believable size for the nest and hatching scenes.
- In round 1 the egg read as "a little puddle": it lay flat on the trail with a round glow under it. It now sits mid-bounce, tipped up, with its own soft top light, speckles, a pecked hole and a tight shadow beneath. Lesson: the egg needs a clear egg silhouette and air under it; never let it rest flat with a glow.

## Decisions

- **Platform:** a web app (Three.js, TypeScript, Vite), played in Chrome on iPhone and from the Home Screen. Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. Native was considered and set aside: slower loop, needs Xcode and a paid developer account.
- **Art:** every model is built by Blender scripts in `art/` and exported to glTF. No store-bought or generated art, so the whole world shares one hand. Run `npm run art` to rebuild models.
- **Concept art:** shown as live 3D frames in the real engine (same frozen moment, three styles), so what gets picked is what ships.
- **Hero colors (approved 2026-11-16, "keep, they're beautiful"):** blue-black body, cream and dark banded tail and arm fans (banding is preserved in the fossils), a gold collar and gold eye. With forest green, amber gold and the blue-green egg, the game's palette lands on the player's four favorite colors without forcing it.
- **Music:** written as MIDI in code, rendered through Ableton Live 12 (LABS and Kontakt 7 are installed). To start, I deliver and Drew reacts. Drew may get hands-on later, and may bring riffs of his own for future levels.
- **Build number** = number of commits, shown on screen. `version.json` is checked at launch and on return to the foreground; a newer build triggers a reload (`src/app/build.ts`). The service worker (`src/sw.js`) fetches the page fresh every launch and caches the rest per build.
- **Commits:** small, pushed often, with no AI model names or attribution lines.
- **Controls:** one touch makes one move. Speed 8 m/s for Level 1.
- **No paper edge during play.** The world reaches the screen's edges.

## Obstacles approved for Level 1 (2026-11-16)

These are the kinds, not a count. They repeat and combine along the course; expect roughly 30 decision moments in about 70 seconds.

1. Go around: a standing conifer with root flare and low dead branches.
2. Go around: a mossy boulder.
3. Jump: a fallen log.
4. Jump: a narrow creek with bright water.
5. Slide: a hollow log seen end-on as a big round opening.
6. Slide: a giant fallen trunk propped on boulders, with a clean, roomy arch.
7. Go around (optional): a dozing Psittacosaurus, played calm.

## About the player and the hardware

- The main player is 6 1/2 and reads at about a 2nd or 3rd grade level. Hints and journal pages can be short real sentences he reads himself.
- He likes a challenge, but struggled when an earlier level asked for quick back-to-back moves. Keep decisions spaced out (about 1.4 s or more in the tutorial) and let difficulty come from choices, not from speed of input.
- His favorite colors: blue, black, green and gold. Worth echoing in the game's palette where it stays natural.
- Phone: iPhone 16 Pro Max (440 by 956 points), iOS 27.2.
- Each level has a different runner. Planned: Velociraptor (Level 2, Gobi), and others like Acheroraptor, Utahraptor, Deinonychus. Keep hero, level and palette code per level.
- Budget: small spends are fine if they clearly help, under $100 total, and closer to that only for things useful beyond this game.

## Mac setup

- MacBook Pro, M1 Pro, 16 GB, macOS 15.7. Node, git, GitHub CLI, Blender 5.3 and ffmpeg are installed (the last two through Homebrew).
- Audio: Ableton Live 12 Standard, Spitfire LABS, Kontakt 7. It's fine to control Live on this laptop.
- Xcode 26.3 is installed and selected (`xcode-select -p` gives the Xcode path). The simulator runtime is iOS 26.3, one version behind Drew's phone (iOS 27.2), so it is a first check and the phone is the final word. It is no use for judging speed. To test: `xcrun simctl boot <id>` (the iPhone 17 Pro Max is 440 by 956 points, same as the phone), wait for `xcrun simctl bootstatus <id>`, then open `http://localhost:5173/...` in it with the dev server running.

## Open questions

- Do bumps and the egg's dodges feel right to Drew and Aidan (length of the bump, the hop, the barrel roll)?
- Does sharpness now stay at full through a session?
- Should a slide be holdable by swiping down again? Drew is on the fence.
