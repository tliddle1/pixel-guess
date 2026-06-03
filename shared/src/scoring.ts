export function calculateGuesserScore(remainingSeconds: number, roundSeconds: number): number {
  if (roundSeconds <= 0) return 50;
  const ratio = Math.max(0, Math.min(1, remainingSeconds / roundSeconds));
  return Math.round(100 * ratio) + 50;
}

export function calculateArtistBonus(correctGuessCount: number): number {
  return correctGuessCount * 25;
}

export function normalizeGuess(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function isCorrectGuess(guess: string, answer: string): boolean {
  return normalizeGuess(guess) === normalizeGuess(answer);
}
