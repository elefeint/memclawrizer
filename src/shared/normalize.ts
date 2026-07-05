/**
 * Answer normalization — the ONLY matching rule (DESIGN.md: no fuzzy matching).
 * Used by the backend matcher and by the renderer mock; keeping it here
 * guarantees both agree. Pure function, no imports.
 */
export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isCorrect(response: string, answers: string[]): boolean {
  const r = normalizeAnswer(response);
  return r.length > 0 && answers.some((a) => normalizeAnswer(a) === r);
}
