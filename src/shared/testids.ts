/**
 * data-testid values shared between the renderer and the Playwright smoke
 * test. Frozen with the contract: renderer must stamp these, the smoke test
 * may rely on them.
 */
export const TESTIDS = {
  homeScreen: 'home-screen',
  deckList: 'deck-list',
  deckRow: 'deck-row',
  importButton: 'import-button',
  trophyShelf: 'trophy-shelf',
  drillScreen: 'drill-screen',
  prompt: 'prompt',
  answerInput: 'answer-input',
  remaining: 'remaining',
  jar: 'jar',
  jarSlot: 'jar-slot',
  feedback: 'feedback',
  statsScreen: 'stats-screen',
} as const;
