# Manual feel checklist

Things tests cannot assert; verified by playing a session (`npm run start:mock`
until B4 lands, then real). Run after F2 and again before any release.

- [ ] Tick is audible and clearly accelerates in the final ~25% of the timer
- [ ] Timeout ding is loud/intrusive (that's the feature), not clipped
- [ ] Seal chime plays ONLY on a perfect session seal — nowhere else
- [ ] Claw travel reads as the timer (position ≈ time left, no lag/jank)
- [ ] Claw grab-and-carry on success lands in the correct jar slot
- [ ] Claw slip on retry-success reads as "acknowledged, but no prize"
- [ ] Pebble drop on first-attempt failure is visible but not theatrical
- [ ] Imperfect end: jar empties quietly back into the pit (no drama)
- [ ] Perfect end: seal animation feels like the peak of the session
- [ ] Failure feedback shows answer + mnemonic long enough to read
- [ ] Keyboard-only flow: whole session without touching the mouse; Esc aborts
- [ ] Audio prompt cards auto-play once and replay on demand (when audio decks exist)
- [ ] Volume slider affects tick/ding/chime; default is intentionally loud

## F10 (2026-08): arcade drill button + Hall of Fame

- [ ] The DRILL dome reads as *mounted* in the cabinet, not as a lollipop
      pasted on the row (the well ring is the tell — check both themes)
- [ ] Pressing it feels like a "thock": the dome sinks into its well and the
      shadow collapses under the finger, at both a click and a keyboard Enter
- [ ] An unlit row (nothing due, nothing new) reads as *a cabinet that's off*,
      not as an error or a disabled-because-broken control
- [ ] The dome is the only heavy thing on the row — the gear stays quiet
- [ ] Hall of Fame reads as the screen INSIDE the cabinet in light theme too
      (dark panel on a light page): legible, not gimmicky; scanlines should be
      almost invisible — if they read as texture on the chart bars, dial down
      `.crt::after`
- [ ] Sealed jars read as THE score at a glance (rank + jars, not the table's
      other numbers); no percentage appears anywhere on the panel
