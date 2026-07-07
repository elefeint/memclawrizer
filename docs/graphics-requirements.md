# Graphics upgrade — asset requirements

Requirements for replacing the current programmer-art with real art: a
slightly-3D jar, a lifelike claw, and the rest of the drawn inventory. Written
so the assets can be produced by an artist, an image-generation model, or a
future Claude session without reading the codebase first.

## 0. Current inventory (what is drawn, and how)

| Artifact | Today | File |
|---|---|---|
| Claw head | 4 stroked paths in a 40×34 inline SVG (3 static fingers) | `src/renderer/screens/drill.ts` (~line 60) |
| Claw cable/trolley | plain CSS divs (gradient rail, 3px cable) | `src/renderer/index.css` `.rail`, `.claw-*` |
| Jar (drill screen) | CSS divs: bordered rounded box, gradient lid, inset shadow; slots are absolutely-positioned circles computed in code | `drill.ts` `buildJar()`, `index.css` `.jar*` |
| Jar (trophy shelf minis) | same CSS approach, smaller | `home.ts`, `index.css` |
| Pebble | a text glyph in the slot | `drill.ts` `setSlot()` |
| Prize pit | emoji `<span>`s scattered over a CSS gradient + `.pit-glass` overlay | `drill.ts` `addPitItem()` |
| Prizes | emoji from a weighted pool (~345 entries) | `prize-pool.ts` |
| Box mini-bar (home) | CSS segments | `home.ts` |
| Stats charts | programmatic SVG (dataviz) | `stats.ts` |
| Piano staff cards | generated SVGs with stylized clef paths | `scripts/gen-piano.ts` → `decks/*.deckpack` |

## 1. Hard constraints — every asset

1. **Self-contained.** CSP is `default-src 'self'`: no external URLs, fonts,
   or CDN anything. Assets live in `src/renderer/assets/` and are bundled by
   Vite.
2. **Inline-injectable SVG is the required format** (so CSS custom properties
   apply): single root `<svg>` with a `viewBox`, **no** `width`/`height`
   attributes, no XML prolog/doctype, no `<script>`, no embedded raster, no
   font-dependent `<text>`. Target ≤ 30 KB per file.
3. **Theme-aware.** Must read on both cabinet surfaces (light `#efe6d6`-ish,
   dark `#201c26`-ish). Use the existing CSS variables for strokes/fills where
   semantically right — `--steel`, `--rail`, `--glass`, `--jar-line`,
   `--good`, `--accent` (see `index.css` `:root`) — and self-contained
   gradients elsewhere. Nothing may depend on a white page background.
4. **Animation-ready.** Everything that moves must be a **named group**
   (`id` on a `<g>`) so code can target it, and all motion will be
   `transform`/`opacity` only (compositor-friendly; the claw travel IS the
   timer, it cannot jank). Declare every pivot point in the asset as a
   comment (`<!-- pivot: 20,6 -->`). Filters at most one soft blur ≤ 2px;
   prefer gradients over filters.
5. **Don't break the harness.** `data-testid` hooks (`jar`, `jar-slot`, …)
   stay on the code-owned DOM; art must not require restructuring them. The
   Playwright smoke test must still pass unchanged.

## 2. Asset A — slightly-3D jar

The jar is built at runtime for **2–7 columns × 1–15 rows** of 30 px slots
(sessions range from 1 card to 100+). Art must therefore be **sliced, not
fixed**: three vertical slices (rim/neck cap, vertically tileable glass body,
bottom bowl) that code stretches to the computed width/height — or a single
SVG whose named groups code scales independently. No baked-in slot holes:
slot contents (emoji / pebble) remain code-positioned DOM on top.

Layer order (back → front), each a named group:

1. `#jar-back` — interior back wall: vertical gradient (darker at edges),
   elliptical floor hint. Sits **behind** the trinket layer.
2. *(code-owned trinket/slot layer renders here)*
3. `#jar-front` — the glass illusion: curvature shading at left/right edges,
   one broad specular highlight band (top-left convention), subtle horizontal
   ellipse at the neck. **Semi-transparent everywhere** (≲ 15% opacity
   mid-tones) — prizes must stay clearly legible through it.
4. `#jar-rim` — neck ring + screw threads (2–3 thread lines).
5. `#jar-lid` — separate group, hidden until seal; metallic top with knurled
   edge. The seal animation is code-driven (drop + ~20° screw rotation), so
   the lid must look right mid-rotation (no baked perspective).
6. `#jar-label-plate` — small plate/paper area for the sealed label; declare
   a safe text box (code renders deck/date/size as HTML on top).

States: empty / filling (no art change) / **sealed** (lid on, `--good` glow —
may stay a CSS box-shadow) / **shelf-mini** (see Asset E).

## 3. Asset B — lifelike claw

Replaces the 40×34 head; new head may grow to ~64×56 (rail band is 96 px
tall; the carry anchor sits ~44 px below rail top — keep or declare a new
anchor). Groups and pivots:

1. `#trolley` — carriage riding the rail: body + 2 small wheels (wheels as
   own groups if they should spin during travel — optional, nice).
2. `#cable` — must stretch during the drop: either a 1×N vertically tileable
   segment code repeats/scales, or accept code's `scaleY` on the group
   (declare which; braided texture must survive the chosen method).
3. `#hub` — wrist block where cable meets fingers; prize anchor point
   declared here (`<!-- carry-anchor: x,y -->`, prize glyph is ~20 px em).
4. Fingers, **three separate groups** for depth: `#finger-left`,
   `#finger-right` (front pair), `#finger-back` (behind the carried prize).
   Each authored in the **open** pose with a declared pivot at the hub; code
   closes them by rotating ±15–20° about the pivots. Front fingers must
   overlap a carried prize; back finger passes behind it — that overlap is
   what sells "grabbed".
5. Metallic rendering: 2–3-stop steel gradients keyed to `--steel`/`--rail`,
   one specular line per finger, soft self-shadow under the hub. Optional
   charm: `#lamp` indicator that code can tint `--accent` during the final
   25% tick acceleration.

Motion states the art must survive (all code-driven transforms): travel
(translate X, the timer), drop (translate Y + cable stretch), grab (finger
rotation), hoist + carry (closed pose, prize at anchor), **slip** (fingers
re-open mid-hoist — the retry heartbreak), release over jar.

## 4. Asset C — pebble

A drawn matte-gray pebble replacing the text glyph: reads clearly at
**17–26 px**, slight top-light so it feels physical, deliberately duller than
any emoji prize (it must feel like an absence, not a different reward), fine
on both themes (use a mid-gray with `--jar-line` outline, not pure black or
white). One SVG, no states — sinking/dropping is code-side opacity/translate.

## 5. Asset D — prize pit set dressing

Trinkets stay emoji (the pool is 345 entries and variable — no art per
prize). Wanted: `#pit-back` (cabinet interior back wall with radial depth
shadow), `#pit-floor` (surface the emoji "sit" on; a subtle contact-shadow
strip code can place under items), and a redrawn `#pit-glass` front
reflection (diagonal streaks, ≲ 8% opacity). Must tile/stretch to full window
width; emoji scatter positions remain code-random.

## 6. Asset E — trophy-shelf mini jar + shelf

Simplified jar variant legible at **~40–56 px wide** (drop threads/specular,
keep silhouette + lid + glow), showing up to 9 prize glyphs inside (code
renders them; art leaves the interior clear). Optional `#shelf` wood strip
(low-contrast grain, both themes) the minis sit on, tileable horizontally.

## 7. Asset F — engraved clefs (deck images, not renderer)

Replace the two stylized path constants in `scripts/gen-piano.ts` with real
engraved outlines (e.g. extracted from Bravura/SMuFL — OFL-licensed, keep the
license note in the script):

- Coordinate system 220×168; staff lines y = 60/72/84/96/108.
- **Treble:** spiral centered on the G line (y = 96); tail below y = 108; top
  above y = 60; fits x ≈ 28–70.
- **Bass:** head dot on the F line (y = 72), the two dots straddling y = 72
  to the right; fits x ≈ 28–70.
- Single-color filled paths only (`fill="black"`, no strokes, no fonts) —
  these SVGs ship inside deckpacks and render in an `<img>`, so no CSS vars.
- After swapping: `npm run gen:decks` regenerates packs + golden fixtures;
  re-import updates cards in place (Leitner state preserved).

## 8. Non-goals

- Stats charts stay minimal programmatic dataviz (they're information, not
  theater).
- No canvas/WebGL/Lottie/GIF, no new runtime dependencies, no sprite-sheet
  raster pipelines — SVG + CSS transforms only.
- Prize emoji stay emoji.

## 9. Acceptance checklist (per asset)

- [ ] Valid for inline injection (constraint 1–2), ≤ 30 KB
- [ ] Legible on both themes at its real size (jar also at shelf-mini size)
- [ ] All named groups + declared pivots/anchors present
- [ ] Claw travel at 60 fps with the asset in place (transform-only motion)
- [ ] `npm test` and `npm run test:e2e` pass unchanged
- [ ] Screenshot pair (light/dark) attached to the PR/commit
