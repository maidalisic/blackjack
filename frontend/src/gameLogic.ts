import type { Card, Rank, Suit, SplitHand, SideBetResult, SideBetState } from './types';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export function buildDeck(numDecks = 6): Card[] {
  const deck: Card[] = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank });
      }
    }
  }
  return shuffle(deck);
}

export function shuffle(deck: Card[]): Card[] {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function cardValue(rank: Rank): number {
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  if (rank === 'A') return 11;
  return parseInt(rank);
}

export function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.faceDown) continue;
    total += cardValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export function isBust(cards: Card[]): boolean {
  return handValue(cards) > 21;
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards) === 21;
}

export function getHandDisplay(cards: Card[]): string {
  const visible = cards.filter(c => !c.faceDown);
  if (!visible.length) return '';
  const hard = visible.reduce((s, c) => s + (c.rank === 'A' ? 1 : cardValue(c.rank)), 0);
  const soft = handValue(cards);
  // Show "hard / soft" only when ace is usable as 11 and doesn't bust
  if (soft !== hard && soft <= 21) return `${hard} / ${soft}`;
  return `${soft}`;
}

export function isSoft(cards: Card[]): boolean {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  return aces > 0 && total <= 21;
}

export function canSplit(hand: SplitHand, totalSplits: number): boolean {
  return hand.cards.length === 2 &&
    cardValue(hand.cards[0].rank) === cardValue(hand.cards[1].rank) &&
    totalSplits < 3;
}

export function canDouble(hand: SplitHand): boolean {
  return hand.cards.length === 2;
}

// Dealer must hit on soft 17
export function dealerShouldHit(cards: Card[]): boolean {
  const val = handValue(cards);
  if (val < 17) return true;
  if (val === 17 && isSoft(cards)) return true;
  return false;
}

// --- Side Bet Evaluation ---

function rankIndex(rank: Rank): number {
  return RANKS.indexOf(rank);
}

export function evaluatePerfectPairs(card1: Card, card2: Card): { label: string; multiplier: number } | null {
  if (cardValue(card1.rank) !== cardValue(card2.rank)) return null;
  if (card1.suit === card2.suit) return { label: 'Perfect Pair', multiplier: 35 };
  const red: Suit[] = ['hearts', 'diamonds'];
  const bothRed = red.includes(card1.suit) && red.includes(card2.suit);
  const bothBlack = !red.includes(card1.suit) && !red.includes(card2.suit);
  if (bothRed || bothBlack) return { label: 'Coloured Pair', multiplier: 17 };
  return { label: 'Mixed Pair', multiplier: 8 };
}

export function evaluateTwentyOnePlusThree(player1: Card, player2: Card, dealer: Card): { label: string; multiplier: number } | null {
  const cards = [player1, player2, dealer];
  const ranks = cards.map(c => c.rank);
  const suits = cards.map(c => c.suit);
  const values = ranks.map(rankIndex).sort((a, b) => a - b);

  const allSameSuit = suits.every(s => s === suits[0]);
  const allSameRank = ranks.every(r => r === ranks[0]);
  const isStraight = values[2] - values[1] === 1 && values[1] - values[0] === 1;

  if (allSameRank && allSameSuit) return { label: 'Suited Trips', multiplier: 100 };
  if (allSameRank) return { label: 'Three of a Kind', multiplier: 30 };
  if (allSameSuit && isStraight) return { label: 'Straight Flush', multiplier: 40 };
  if (allSameSuit) return { label: 'Flush', multiplier: 5 };
  if (isStraight) return { label: 'Straight', multiplier: 10 };
  return null;
}

export function resolveSideBets(
  playerCards: Card[],
  dealerCards: Card[],
  sideBets: SideBetState,
): SideBetResult {
  const result: SideBetResult = {
    perfectPairs: null,
    twentyOnePlusThree: null,
    insurance: null,
  };

  if (sideBets.perfectPairs > 0 && playerCards.length >= 2) {
    const pp = evaluatePerfectPairs(playerCards[0], playerCards[1]);
    if (pp) {
      result.perfectPairs = {
        win: true,
        payout: sideBets.perfectPairs * pp.multiplier,
        label: pp.label,
      };
    } else {
      result.perfectPairs = { win: false, payout: -sideBets.perfectPairs, label: 'No Pair' };
    }
  }

  if (sideBets.twentyOnePlusThree > 0 && playerCards.length >= 2 && dealerCards.length >= 1) {
    const dealerUpCard = dealerCards.find(c => !c.faceDown) ?? dealerCards[0];
    const t = evaluateTwentyOnePlusThree(playerCards[0], playerCards[1], dealerUpCard);
    if (t) {
      result.twentyOnePlusThree = {
        win: true,
        payout: sideBets.twentyOnePlusThree * t.multiplier,
        label: t.label,
      };
    } else {
      result.twentyOnePlusThree = { win: false, payout: -sideBets.twentyOnePlusThree, label: 'No Win' };
    }
  }

  if (sideBets.insurance > 0) {
    const dealerBJ = isBlackjack(dealerCards);
    result.insurance = {
      win: dealerBJ,
      payout: dealerBJ ? sideBets.insurance * 2 : -sideBets.insurance,
    };
  }

  return result;
}
