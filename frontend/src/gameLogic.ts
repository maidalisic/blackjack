import type { Card, Rank, SplitHand } from './types';

export function cardValue(rank: Rank): number {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank);
}

export function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.face_down) continue;
    total += cardValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function getHandDisplay(cards: Card[]): string {
  const visible = cards.filter(c => !c.face_down);
  if (!visible.length) return '';
  const hard = visible.reduce((s, c) => s + (c.rank === 'A' ? 1 : cardValue(c.rank)), 0);
  const soft = handValue(cards);
  if (soft !== hard && soft <= 21) return `${hard} / ${soft}`;
  return `${soft}`;
}

function splitValue(rank: string): number {
  return ['10', 'J', 'Q', 'K'].includes(rank) ? 10 : -1;
}

export function canSplit(hand: SplitHand, totalSplits: number): boolean {
  if (hand.cards.length !== 2 || totalSplits >= 3) return false;
  const [r0, r1] = [hand.cards[0].rank, hand.cards[1].rank];
  if (r0 === r1) return true;
  // 10, J, Q, K all count as equal for splitting purposes
  return splitValue(r0) === 10 && splitValue(r1) === 10;
}

export function canDouble(hand: SplitHand): boolean {
  return hand.cards.length === 2;
}
