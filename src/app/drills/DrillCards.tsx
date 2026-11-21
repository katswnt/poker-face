import { RN, SUIT_NAMES } from "@/lib/poker/cards";
import type { CardObj } from "@/lib/poker/types";
import styles from "./drills.module.css";
const RED_SUITS = new Set(["♥", "♦"]);

export function cardWords(card: CardObj): string {
  const value = card.rank === "10" ? 10 : ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[card.rank] ?? Number(card.rank);
  return `${RN[value].toLowerCase()} of ${SUIT_NAMES[card.suit]}`;
}

export function Cards({ cards }: Readonly<{ cards: readonly CardObj[] }>) {
  return (
    <span className={styles.cards}>
      <span className={styles.srOnly}>{cards.map(cardWords).join(", ")}</span>
      {cards.map(card => (
        <span key={card.rank + card.suit} aria-hidden="true" className={RED_SUITS.has(card.suit) ? styles.playingCardRed : styles.playingCard}>
          {card.rank}{card.suit}
        </span>
      ))}
    </span>
  );
}
