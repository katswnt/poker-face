/**
 * Leak detection for private cards in serialized data (the P0 no-leak invariant). Pure.
 *
 * Serialized text is split into alphanumeric tokens; a card leaks if a token is that card
 * ("Ah") or a two-card combo holding it at a card boundary ("AhKd"). Token matching avoids
 * false alarms from hex hashes, where "2c" or "9d" can occur by chance inside a longer token.
 */
import { parseBridgeCombo } from "../solver/bridge/contract";
import type { RiverCard } from "../solver/river/cards";

export function leakedCards(value: unknown, cards: readonly RiverCard[]): RiverCard[] {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const found = new Set<RiverCard>();
  for (const token of text.split(/[^A-Za-z0-9]+/)) {
    for (const card of cards) {
      if (token === card || (token.length === 4 && (token.slice(0, 2) === card || token.slice(2) === card))) found.add(card);
    }
  }
  return [...found];
}

export function assertNoCards(value: unknown, combo: string, label: string): void {
  const leaked = leakedCards(value, parseBridgeCombo(combo));
  if (leaked.length) throw new Error(`Leak guard: ${leaked.join(", ")} reached ${label}`);
}
