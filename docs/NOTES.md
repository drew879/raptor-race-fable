# Raptor Race: working notes

Decisions and progress. Read `raptor-race-brief.md` first; it's the source of truth for what the game is and how Drew likes to work. The brief is committed at the repo root (Drew OK'd that on 2026-11-16). Anything in `docs/local/` stays off the repo.

## Where things stand

- **Milestone 1 (style): waiting on Drew's pick between A and A+.** A is his favorite of the first three; he asked to see A+ ("Golden Journal": A's ink and paper under B's light) before deciding. Both are in the concept viewer at the root URL.
- **Milestone 2 (rough playable run): first version is live** at `?mode=run` (there's a "Try the rough run" button in the concept viewer). Waiting on playtest feedback.
- Live build: https://drew879.github.io/raptor-race-fable/
- Hero colors are approved. All seven obstacle kinds are approved (they are kinds, to be repeated and combined).

### What the rough run has
- A 530 m test course (about 73 s at 7 m/s) in `src/game/course.ts`: 25 decision points, never closer than 12 m (1.7 s). Order: lanes, jumps, slides, a steep clear drop with a view, a mixed section, a second drop, a short finish. This is a feel test, not the Level 1 layout.
- The hero is rigged (19 bones) and posed in code: run cycle tied to distance, jump, slide, lane lean, stumble (`src/hero/rig.ts`). `?mode=hero&cam=side&state=run|jump|slide|stand&phase=0.25` is a test view.
- Swipe and arrow-key controls, jump buffering, fast-fall into slide.
- Four obstacle kinds so far: boulder and lane tree (go around), log (jump), propped trunk arch (slide). Creek, hollow log and Psittacosaurus are still to build.
- The egg bounces ahead; clean running closes the gap (down to 4.8 m), a hit adds 3.2 m, capped at 17 m with a warning. Losing the egg is not in yet.
- Amber lines and arcs, a count, first-time hints, a pause sheet (resume, start over, look A/A+/B/C, speed 4 to 11 m/s), a finish sheet with "Run again" that resets everything.
- The camera ducks under arches a moment after the hero.
- Forest streams in 13 m chunks at three levels of detail (`src/game/flora.ts`). About 0.75 to 0.9 million triangles and 6.5 to 9.5 ms a frame on the M1 Pro.

### Not yet verified on the real phone
- Full-screen fit in the Home Screen app, the blur band under the status bar, frame rate (the pause sheet shows build, fps and how it was opened).
- Swipe feel on a touch screen. The run was tested here with a scripted bot at fixed time steps and with keys: the course can be finished with no hits, hits register and slow you, and "Run again" restores every piece of state.
- How the ink outlines hold up at running speed.

### Next
- Fold in feedback on speed, camera, the downhill and controls.
- Hero up close (milestone 3), then a course map for sign-off before building the real level (milestone 4).

## How the code is laid out

- `art/` Blender scripts. `art/lib/geo.py` is the modeling toolkit (lofted tubes, leaf and feather blades, painted vertex color, baked occlusion). `art/hero.py`, `art/plants.py` build the models; `art/build_all.py` exports them to `src/assets/models/` (`npm run art`, or `npm run art -- -- flora` for one kit). `art/icon.py` renders the app icon (a placeholder for now).
- `src/render/paint.ts` the one shader family for the whole world. Models carry painted color and occlusion in a vertex attribute and wind data in UV; each face's material name is a "role" (bark, foliage_fern, feather...) that picks a shader variant.
- `src/render/styles.ts` a style direction is a full set of values for the paint shader, sky, soft effects and finishing pass. Geometry never changes between styles.
- `src/render/post.ts` finishing pass: ink outlines found from depth, paper grain, the ragged wash edge, final grade.
- `src/render/shadow.ts` sun shadow map. Trunks, tree ferns and everything low cast real shadows; the high canopy's shade is painted as dappled light so it can be art-directed.
- `src/world/` track (the trail's centerline from segments of length, turn and slope), terrain (a hillside ribbon in trail space: s along, u across), assets (model kits, instancing), sky (ridges, volcano), fx (mist, shafts, glows, contact shadows).
- `src/game/` the run: `course.ts` (the test course), `run.ts` (state, rules, camera), `flora.ts` (forest streaming), `input.ts` (swipes), `hud.ts` (controls and sheets).
- `src/hero/rig.ts` poses the hero's skeleton in code. `src/herolab/` is its test view.
- `src/lookdev/` the concept viewer scene and its controls. This goes away or moves behind a debug flag once the game proper starts.
- `src/app/` build number and self-update, full-screen sizing.

## Things learned so far

- Downhill reads when (1) the trail tips over a crest and drops out of sight, (2) a slot is kept clear of tall trees so the valley, stacked ridges and volcano show beyond, and (3) trunks rise from below the crest. A camera 1.45 m up and 2.6 m behind the hero, looking 14 m ahead, puts the horizon about a third of the way down the screen.
- A crest hides what is behind it. For gameplay, keep hidden stretches at least 3 seconds ahead of the runner, or flatten the crest (brief rule: nothing hides behind a crest).
- Solid canopy shadows made the trail and hero muddy. Dappled light with a coverage dial reads better and stays controllable.
- The hero, egg and obstacles get less shade than the scenery on purpose, so they never get lost.
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

- Which style direction (A, B or C)? My pick is A with B's golden light, with B as the fallback if the ink lines shimmer in motion.
- Hero colors: keep or change?
- Whether the brief and family details can live in the public repo.
- Obstacle ideas for Level 1 (pitched in chat, waiting on a yes or no per idea).
