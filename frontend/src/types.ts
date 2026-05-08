export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
  face_down?: boolean;
}

export type GamePhase = 'waiting' | 'betting' | 'insurance' | 'playing' | 'result';

export type HandResult = 'win' | 'lose' | 'push' | 'blackjack' | 'bust' | null;

export interface SplitHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  stood: boolean;
  result: HandResult;
}

export interface SideBets {
  perfect_pairs: number;
  twenty_one_plus_three: number;
  insurance: number;
}

export interface SideBetEntry {
  win: boolean;
  payout: number;
  label?: string;
}

export interface SideBetResults {
  perfect_pairs: SideBetEntry | null;
  twenty_one_plus_three: SideBetEntry | null;
  insurance: SideBetEntry | null;
}

export type PlayerStatus = 'waiting' | 'betting' | 'waiting_turn' | 'playing' | 'done' | 'result' | 'spectating';

export interface PlayerState {
  player_id: string;
  name: string;
  balance: number;
  current_bet: number;
  side_bets: SideBets;
  player_hands: SplitHand[];
  active_hand_index: number;
  side_bet_results: SideBetResults;
  status: PlayerStatus;
  ready: boolean;
  insurance_done: boolean;
}

export interface RoomState {
  room_id: string;
  host_id: string;
  max_players?: number;
  starting_balance?: number;
  players: Record<string, PlayerState>;
  player_order: string[];
  dealer_hand: Card[];
  phase: GamePhase;
  active_player_id: string | null;
  message: string;
  betting_started_at: number;
}

export interface WsMessage {
  type: string;
  state?: RoomState;
  your_id?: string;
  room_id?: string;
  player_id?: string;
  message?: string;
  player_name?: string;
  player_count?: number;
}
