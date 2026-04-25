export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  faceDown?: boolean;
}

export type GamePhase =
  | 'betting'
  | 'playerTurn'
  | 'dealerTurn'
  | 'result';

export interface SideBetState {
  perfectPairs: number;
  twentyOnePlusThree: number;
  insurance: number;
}

export interface SideBetResult {
  perfectPairs: { win: boolean; payout: number; label: string } | null;
  twentyOnePlusThree: { win: boolean; payout: number; label: string } | null;
  insurance: { win: boolean; payout: number } | null;
}

export type HandResult = 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | null;

export interface SplitHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  stood: boolean;
  result: HandResult;
}

export interface GameState {
  phase: GamePhase;
  deck: Card[];
  playerHands: SplitHand[];
  activeHandIndex: number;
  dealerHand: Card[];
  balance: number;
  currentBet: number;
  sideBets: SideBetState;
  sideBetResults: SideBetResult;
  message: string;
}
