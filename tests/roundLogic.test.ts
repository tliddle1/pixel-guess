import { describe, expect, it } from "vitest";
import { createArtistOrder, finalRankings, maskWord, selectNextArtist, selectNextArtistFromOrder, shouldEndGame, shouldEndRound } from "../shared/src/roundLogic";
import type { Player } from "../shared/src/types";

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    clientId: `client-${id}`,
    name: id,
    score: 0,
    connected: true,
    isSpectator: false,
    ...overrides
  };
}

describe("round logic", () => {
  it("masks words for guessers", () => {
    expect(maskWord("ice cream", false)).toBe("_ _ _   _ _ _ _ _");
    expect(maskWord("ice cream", true)).toBe("ice cream");
  });

  it("rotates artists and skips spectators", () => {
    const players = [player("a"), player("b", { isSpectator: true }), player("c")];
    expect(selectNextArtist(players, null)?.id).toBe("a");
    expect(selectNextArtist(players, "a")?.id).toBe("c");
    expect(selectNextArtist(players, "c")?.id).toBe("a");
  });

  it("creates a shuffled artist order from eligible lobby players", () => {
    const players = [player("a"), player("b"), player("c", { isSpectator: true })];
    expect(createArtistOrder(players, () => 0)).toEqual(["b", "a"]);
  });

  it("cycles through the stored artist order", () => {
    const players = [player("a"), player("b"), player("c")];
    expect(selectNextArtistFromOrder(players, ["b", "c", "a"], -1)).toEqual({ artistId: "b", orderIndex: 0 });
    expect(selectNextArtistFromOrder(players, ["b", "c", "a"], 0)).toEqual({ artistId: "c", orderIndex: 1 });
    expect(selectNextArtistFromOrder(players, ["b", "c", "a"], 2)).toEqual({ artistId: "b", orderIndex: 0 });
  });

  it("skips disconnected players while preserving the stored order", () => {
    const players = [player("a"), player("b", { connected: false }), player("c")];
    expect(selectNextArtistFromOrder(players, ["a", "b", "c"], 0)).toEqual({ artistId: "c", orderIndex: 2 });
  });

  it("ends a round when all eligible guessers are correct", () => {
    const players = [player("artist"), player("a"), player("b"), player("spectator", { isSpectator: true })];
    expect(shouldEndRound(players, "artist", new Set(["a"]))).toBe(false);
    expect(shouldEndRound(players, "artist", new Set(["a", "b"]))).toBe(true);
  });

  it("detects game over after configured rounds", () => {
    expect(shouldEndGame(2, 3)).toBe(false);
    expect(shouldEndGame(3, 3)).toBe(true);
  });

  it("sorts final rankings by score", () => {
    const rankings = finalRankings([player("a", { score: 10 }), player("b", { score: 40 })]);
    expect(rankings.map((ranked) => ranked.id)).toEqual(["b", "a"]);
  });
});
