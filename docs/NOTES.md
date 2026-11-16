# Raptor Race: working notes

Decisions and progress. Read `raptor-race-brief.md` first; it's the source of truth for what the game is and how Drew likes to work. The brief is committed at the repo root (Drew OK'd that on 2026-11-16). Anything in `docs/local/` stays off the repo.

## Where things stand

- **Milestone 1 (style): close.** Drew ruled out plain A ("A+ is definitely better") and asked for something between A+ and B. That is now "AB, Painted Journal": B's deeper paint and mist, with A's ink kept for what is near and for the things you play with. Waiting on his pick between A+, AB and B. The old A and C are gone from the code (they are in git history and in `docs/concept-round-1/`).
- **Milestone 2 (rough playable run): second version.** Drew played build 8 on his phone on 2026-11-16: camera, hero size, the downhill, jump, slide and obstacle reads all passed. His fixes are in (see "Round 2" below). Waiting on a second playtest and on a screenshot of the speed test.
- **Frame rate is the open risk.** Build 8 ran at 22 fps on the iPhone 16 Pro Max (in Chrome). See "Frame rate" below.
- Live build: https://drew879.github.io/raptor-race-fable/
- Hero colors are approved. All seven obstacle kinds are approved (they are kinds, to be repeated and combined).

### What the rough run has
- A 530 m test course (about 66 s at 8 m/s) in `src/game/course.ts`: 25 decision points, never closer than 12 m (1.5 s). Order: lanes, jumps, slides, a steep clear drop with a view, a mixed section, a second drop, a short finish. This is a feel test, not the Level 1 layout.
- The hero is rigged (19 bones) and posed in code: run cycle tied to distance, jump, slide, lane lean, stumble (`src/hero/rig.ts`). `?mode=hero&cam=side&state=run|jump|slide|stand&phase=0.25` is a test view.
- Swipe and arrow-key controls, jump buffering, fast-fall into slide. One touch makes one move.
- Four obstacle kinds so far: boulder and lane tree (go around), log (jump), propped trunk arch (slide). Creek, hollow log and Psittacosaurus are still to build.
- The egg tumbles ahead; clean running closes the gap (down to 4.8 m), a hit adds 3.2 m, capped at 17 m with a warning. Losing the egg is not in yet.
- Amber lines and arcs, a count, first-time hints, a pause sheet (resume, start over, look A+/AB/B, speed 4 to 11 m/s, egg Steady/Wobbly/Lively), a finish sheet with "Run again" that resets everything.
- The camera ducks under arches a moment after the hero.
- Lane hints: each lane is a slightly paler worn track, with a thin broken seam of moss and litter between lanes. Drawn in the ground shader from trail coordinates (no grass: it had not evolved yet).
- Forest streams in 13 m chunks at four levels of detail (`src/game/flora.ts`); ground is cut into 26 m sections and amber into 40 m batches, so only what is near is drawn. About 0.36 to 0.55 million triangles a frame.

### Round 2 (2026-11-16), from Drew's playtest of build 8
- Default speed 8 (he first thought 10, settled on 8 for an introductory level). The saved speed was reset (`rr-speed2`).
- One swipe changes one lane, however long the swipe.
- He is on the fence about holding a slide by swiping down again and again. Left as is for now.
- The egg rolled backwards and at a fixed 45 degrees. It now always turns forward. Three ways of rolling are on the pause sheet so he can compare: Steady (end over end), Wobbly (the axis swings with its path), Lively (wobbly, and each bounce depends on how it lands: on an end it kicks up high, on its side it skips low). Lively is the default and my pick. It is a few lines of rules, not a physics engine.
- The torn-paper edge around the screen is gone from play: he wants the world to reach the edges. It could come back on pages that are pages (Field Journal, results).
- Top row moved down 14 points in the Home Screen app, out of the blur band.
- Bottom strip in the Home Screen app: see "Things learned".

### Frame rate
- Build 8: 22 fps on the phone. On the M1 Pro the same frame took 5.7 ms at the phone's size (880 by 1912), so the phone was roughly 8 times slower than this Mac, more than its chip alone explains. Cause not yet known.
- Done so far: shader noise now comes from a small tiling texture instead of being worked out per pixel (paint shader, ink pass, mist, shafts); sun shadows take 4 filtered taps, not 9; lighter far-distance models; ground and amber drawn only near the runner. The Mac frame is now about 3.4 ms, with the same look.
- On the Mac what is left is mostly edge smoothing (4x MSAA, about 1 ms) and the extra full-screen pass (about 0.5 ms). Triangle count barely matters on the Mac. Whether that holds on the phone is unknown.
- `src/app/quality.ts` watches for late frames and lowers render sharpness in steps (down to half), raising it again when there is room. The pause sheet's small print shows the current sharpness.
- `?mode=bench` (the "Speed test" link on the pause sheet) times the frame nine ways on the device itself. **Next step: get Drew's screenshot of it and decide from real numbers** (drop or change smoothing, cut more geometry, or lower the sharpness cap).
- Known gap: with the phone in Low Power Mode (30 frames a second at most) the governor will walk down to half sharpness for nothing. It climbs back once the cap is gone.

### Not yet verified on the real phone
- The Home Screen bottom-strip fix and the new top-row position.
- Frame rate after this round's work.
- The lane hints, the egg's three ways of rolling and the AB look in motion.
- The run was tested here with a scripted bot at fixed time steps and with real clicks on the sheets: the course can be finished with no hits at speed 8, hits register and slow you, and "Run again" restores every piece of state.

### Next
- Read the speed test numbers and get to a steady 60 on the phone.
- Lock the look.
- Hero up close (milestone 3), then a course map for sign-off before building the real level (milestone 4).

## How the code is laid out

- `art/` Blender scripts. `art/lib/geo.py` is the modeling toolkit (lofted tubes, leaf and feather blades, painted vertex color, baked occlusion). `art/hero.py`, `art/plants.py` build the models; `art/build_all.py` exports them to `src/assets/models/` (`npm run art`, or `npm run art -- -- flora` for one kit). `art/icon.py` renders the app icon (a placeholder for now).
- `src/render/paint.ts` the one shader family for the whole world. Models carry painted color and occlusion in a vertex attribute and wind data in UV; each face's material name is a "role" (bark, foliage_fern, feather...) that picks a shader variant.
- `src/render/styles.ts` a style direction is a full set of values for the paint shader, sky, soft effects and finishing pass. Geometry never changes between styles.
- `src/render/post.ts` finishing pass: ink outlines found from depth, paper grain, final grade.
- `src/render/noisetex.ts` one small tiling noise texture, read by the paint shader, the finishing pass, mist and shafts.
- `src/render/shadow.ts` sun shadow map. Trunks, tree ferns and everything low cast real shadows; the high canopy's shade is painted as dappled light so it can be art-directed.
- `src/world/` track (the trail's centerline from segments of length, turn and slope), terrain (a hillside ribbon in trail space: s along, u across), assets (model kits, instancing), sky (ridges, volcano), fx (mist, shafts, glows, contact shadows).
- `src/game/` the run: `course.ts` (the test course), `run.ts` (state, rules, camera), `flora.ts` (forest streaming), `input.ts` (swipes), `hud.ts` (controls and sheets).
- `src/hero/rig.ts` poses the hero's skeleton in code. `src/herolab/` is its test view.
- `src/lookdev/` the concept viewer scene and its controls. This goes away or moves behind a debug flag once the game proper starts.
- `src/app/` build number and self-update, full-screen sizing, the sharpness governor (`quality.ts`) and the on-device speed test (`bench.ts`).

## Things learned so far

- Downhill reads when (1) the trail tips over a crest and drops out of sight, (2) a slot is kept clear of tall trees so the valley, stacked ridges and volcano show beyond, and (3) trunks rise from below the crest. A camera 1.45 m up and 2.6 m behind the hero, looking 14 m ahead, puts the horizon about a third of the way down the screen.
- A crest hides what is behind it. For gameplay, keep hidden stretches at least 3 seconds ahead of the runner, or flatten the crest (brief rule: nothing hides behind a crest).
- Solid canopy shadows made the trail and hero muddy. Dappled light with a coverage dial reads better and stays controllable.
- The hero, egg and obstacles get less shade than the scenery on purpose, so they never get lost.
- **The Home Screen strip.** On iOS 26 and later, a Home Screen app that draws under the status bar gets a viewport short by the status bar's height (62 points on this phone) and paints nothing below it, however tall you make a fixed element (WebKit bug 301108). Forcing the 3D view to the screen's height, which build 8 did, only cut the picture's bottom off. The viewport is short only while the page is shorter than the screen, so the fix other projects use is a page-level rule in standalone mode: `html { min-height: min(100lvh, calc(100% + env(safe-area-inset-top))) }`. That is in `style.css`; the 3D view is now plain `position: fixed; inset: 0` and `viewport.ts` just reads its size. Not yet confirmed on Drew's phone. There is no simulator on this Mac (Xcode is not installed), so Home Screen layout can't be tested here.
- The blur band under the status bar comes with drawing under it; it can't be turned off. The only way to lose it is the opaque status bar style, which gives up the top 62 points. We keep drawing under it and start the top row 14 points lower.
- Procedural noise in a fragment shader is expensive on a phone. Read it from a texture.
- Timing frames: `requestAnimationFrame` can't see anything faster than the screen. To time drawing, draw N frames then read one pixel back (that waits for the graphics chip) and divide. Reading back after every frame adds several milliseconds and misleads. Short bursts also read slow because the chip speeds up under load: warm up for a third of a second first.
- Thin outlines on far trees made the distant forest scratchy on the phone. In AB the scenery's lines fade out between 14 and 46 m, while the runner, egg, amber and obstacles keep theirs at any distance, so ink also marks what matters.
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

- MacBook Pro, M1 Pro, 16 GB. Node, git, GitHub CLI, Blender 5.3 and ffmpeg are installed (the last two through Homebrew).
- Audio: Ableton Live 12 Standard, Spitfire LABS, Kontakt 7. It's fine to control Live on this laptop.

## Open questions

- Which look: A+, AB or B? (My pick is AB.)
- Which way should the egg roll: Steady, Wobbly or Lively? (My pick is Lively.)
- Are the lane hints right: too strong, about right, too faint?
- Should a slide be holdable by swiping down again? Drew is on the fence.
- Would Drew install Xcode (free, about 12 GB) so Home Screen layout can be tested here in a simulator?
