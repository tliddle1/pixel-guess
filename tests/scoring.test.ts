import { describe, expect, it } from "vitest";
import { calculateArtistBonus, calculateGuesserScore, isCorrectGuess, normalizeGuess } from "../shared/src/scoring";

describe("scoring", () => {
  it("awards more points for faster guesses", () => {
    expect(calculateGuesserScore(70, 80)).toBeGreaterThan(calculateGuesserScore(10, 80));
  });

  it("keeps guesser points inside the expected range", () => {
    expect(calculateGuesserScore(80, 80)).toBe(150);
    expect(calculateGuesserScore(0, 80)).toBe(50);
  });

  it("awards artist bonus per correct guess", () => {
    expect(calculateArtistBonus(3)).toBe(75);
  });

  it("normalizes guesses before comparing", () => {
    expect(normalizeGuess("  Space   Ship ")).toBe("space ship");
    expect(isCorrectGuess("SPACE ship", "space ship")).toBe(true);
  });
});
