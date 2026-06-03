export const WORDS = [
  "castle",
  "dragon",
  "rocket",
  "pizza",
  "guitar",
  "wizard",
  "robot",
  "pirate",
  "island",
  "camera",
  "bicycle",
  "rainbow",
  "pumpkin",
  "spaceship",
  "snowman",
  "treasure",
  "volcano",
  "sandwich",
  "computer",
  "butterfly",
  "lighthouse",
  "dinosaur",
  "mermaid",
  "telescope",
  "helicopter",
  "keyboard",
  "mountain",
  "cupcake",
  "octopus",
  "backpack"
];

export function pickWordChoices(words = WORDS, count = 3): string[] {
  return [...words].sort(() => Math.random() - 0.5).slice(0, count);
}
