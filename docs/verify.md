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
