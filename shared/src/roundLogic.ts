import type { Player } from "./types";

export function maskWord(word: string, guessed: boolean): string {
  if (guessed) return word;
  return word
    .split("")
    .map((char) => (char === " " ? " " : "_"))
    .join(" ");
}

export function eligibleArtists(players: Player[]): Player[] {
  return players.filter((player) => !player.isSpectator && player.connected);
}

export function createArtistOrder(players: Player[], random = Math.random): string[] {
  const order = eligibleArtists(players).map((player) => player.id);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

export function selectNextArtist(players: Player[], currentArtistId: string | null): Player | null {
  const eligible = eligibleArtists(players);
  if (eligible.length === 0) return null;
  if (!currentArtistId) return eligible[0];
  const currentIndex = eligible.findIndex((player) => player.id === currentArtistId);
  return eligible[(currentIndex + 1 + eligible.length) % eligible.length];
}

export function selectNextArtistFromOrder(
  players: Player[],
  artistOrder: string[],
  currentOrderIndex: number
): { artistId: string; orderIndex: number } | null {
  if (artistOrder.length === 0) return null;

  for (let offset = 1; offset <= artistOrder.length; offset += 1) {
    const orderIndex = (currentOrderIndex + offset + artistOrder.length) % artistOrder.length;
    const artistId = artistOrder[orderIndex];
    const player = players.find((candidate) => candidate.id === artistId);
    if (player && player.connected && !player.isSpectator) {
      return { artistId, orderIndex };
    }
  }

  return null;
}

export function shouldEndRound(players: Player[], artistId: string | null, guessedPlayerIds: Set<string>): boolean {
  return players
    .filter((player) => !player.isSpectator && player.connected && player.id !== artistId)
    .every((player) => guessedPlayerIds.has(player.id));
}

export function shouldEndGame(completedRounds: number, configuredRounds: number): boolean {
  return completedRounds >= configuredRounds;
}

export function finalRankings(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
