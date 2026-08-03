# memclawrizer

A time-pressured flashcard trainer. An arcade claw sweeps across the screen as
the timer; answer before it reaches the end or a loud ding sends the card back.
Correct answers earn trinkets into a jar — a perfect session seals the jar onto
a permanent trophy shelf; anything less quietly returns the prizes to the pit.
Underneath: a 5-box Leitner scheduler, a full audit log of every attempt, and a
copy-typing calibration that sets the deadline just above your typing floor —
enough time to remember, not enough to calculate.

## Install

Grab an installer from the [releases page](../../releases):

- **Linux** — `.deb` or `.rpm`
- **Windows** — `Setup.exe`
- **macOS** — `.zip` (the app is unsigned: right-click → Open on first launch)

Starter decks (`.deckpack` files) are attached to each release: hiragana and
katakana with spoken syllables, and treble/bass piano notation. On the home
screen, **Import deck…**, pick a pack, hit **Drill**. Your first drill starts
with a short copy-typing warm-up that calibrates the timer to your fingers.

Progress lives in a local database (per machine); decks can be re-imported
after updates without losing your Leitner state.

## Creating your own decks

A deck is a folder (or a zip renamed `.deckpack`) containing `deck.json` and
an optional `media/` directory:

```json
{
  "format_version": 2,
  "id": "french-numbers",
  "name": "French — numbers 0–100",
  "settings": { "base_timer_ms": 6000, "new_cards_per_session": 5 },
  "cards": [
    {
      "id": "fr-17",
      "prompt": { "type": "text", "text": "17" },
      "answers": ["dix-sept", "dix sept"],
      "hint": "the teens switch pattern at 17",
      "tags": ["teens"]
    }
  ]
}
```

The rules that matter:

- **Card ids are forever.** Re-importing a pack updates cards by id and keeps
  your learning progress — rename an id and it becomes a new card.
- **Matching is exact** (after trimming/lowercasing), so list every answer
  variant you'd accept. Answers should be fast to type; there's a claw coming.
- **Write hints.** The hint appears at the moment of failure — connect the
  fact to something already known ("ten-seven"), don't just restate it.
- **Tag generously** — tags power drill-by-tag subsets, so you can start small.
- Prompts can be `text`, `image` (`"media": "media/x.svg"`), or `audio`; a
  card may also carry `"answer_media"` — audio spoken after each attempt.

Import the folder or zip via **Import deck…**. Invalid packs are rejected with
an error naming the exact field. Full format details: [DESIGN.md](DESIGN.md).

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
- Built with [Claude Code](https://claude.com/claude-code) — design, code and
  tests grew out of one long conversation, on and off across a month. Claude
  Fable 5 did the original nine-day build; Claude Opus 5 took over for the
  later work.

Developing or building from source: see [CONTRIBUTING.md](CONTRIBUTING.md).
