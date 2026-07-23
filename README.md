# memclawrizer

A time-pressured flashcard trainer. An arcade claw sweeps across the screen as
the timer; answer before it reaches the end or a loud ding sends the card back.
Correct answers earn trinkets into a jar — a perfect session seals the jar onto
a permanent trophy shelf; anything less quietly returns the prizes to the pit.
Underneath: a 5-box Leitner scheduler, a full audit log of every attempt, and a
copy-typing calibration that sets the deadline just above your typing floor —
enough time to remember, not enough to calculate.

Built for memorizing piano notation and Japanese kana (starter decks included,
with spoken syllables), but content is pluggable: a deck is a zip of
`deck.json` + media. Design rationale lives in **DESIGN.md**.

## Run

    npm install
    npm start

Import a deck from `decks/` on the home screen and drill. Electron + TypeScript
+ DuckDB; installers for Linux/Windows/macOS via `npm run make` or the
[releases page](../../releases).

## Develop

    npm test            # unit + DB tests (real in-memory DuckDB)
    npm run start:mock  # renderer against a deterministic mock backend
    npm run test:e2e    # Playwright smoke test against the packaged app

New decks: see `.claude/skills/deckpack/SKILL.md` for the format, or the
generators in `scripts/`.

## License & attribution

MIT © [Elena Felder](https://github.com/elefeint)

- Clef glyphs extracted from [Bravura](https://github.com/steinbergmedia/bravura)
  © Steinberg Media Technologies, SIL Open Font License 1.1.
- Kana audio synthesized with [Open JTalk](https://open-jtalk.sourceforge.net)
  using the nitech-jp-atr503-m001 voice © Nagoya Institute of Technology,
  CC-BY-3.0.
- Pacing mechanic inspired by the vocabulary drill in "Bridge to English", a
  1990s English-learning CD (its gun is now a claw).
- Leitner scheduling as explained in Chris Walker's
  ["The Leitner Box — How to Remember Anything Forever"](https://www.youtube.com/watch?v=uvF1XuseZFE).
- Built with [Claude Code](https://claude.com/claude-code) running Claude
  Fable 5 — design, code, and tests grew out of one long conversation, over
  the course of nine days.
