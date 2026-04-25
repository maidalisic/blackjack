import { useReducer } from 'react';
import type { GameState, SideBetState, SplitHand, HandResult } from './types';
import {
  buildDeck,
  handValue,
  isBlackjack,
  isBust,
  canSplit,
  canDouble,
  dealerShouldHit,
  resolveSideBets,
} from './gameLogic';

const STARTING_BALANCE = 10000;

function emptyHand(bet: number): SplitHand {
  return { cards: [], bet, doubled: false, stood: false, result: null };
}

const initial: GameState = {
  phase: 'betting',
  deck: buildDeck(),
  playerHands: [emptyHand(0)],
  activeHandIndex: 0,
  dealerHand: [],
  balance: STARTING_BALANCE,
  currentBet: 0,
  sideBets: { perfectPairs: 0, twentyOnePlusThree: 0, insurance: 0 },
  sideBetResults: { perfectPairs: null, twentyOnePlusThree: null, insurance: null },
  message: 'Place your bet to start.',
};

type Action =
  | { type: 'SET_BET'; amount: number }
  | { type: 'SET_SIDEBET'; bet: keyof SideBetState; amount: number }
  | { type: 'DEAL' }
  | { type: 'HIT' }
  | { type: 'STAND' }
  | { type: 'DOUBLE' }
  | { type: 'SPLIT' }
  | { type: 'NEW_ROUND' };

function draw(deck: GameState['deck']): [import('./types').Card, GameState['deck']] {
  const [card, ...rest] = deck.length < 15 ? buildDeck() : deck;
  return [card, rest];
}

function resolveHand(playerCards: import('./types').Card[], dealerCards: import('./types').Card[]): HandResult {
  const pv = handValue(playerCards);
  const dv = handValue(dealerCards);
  if (isBust(playerCards)) return 'bust';
  if (isBlackjack(playerCards) && !isBlackjack(dealerCards)) return 'blackjack';
  if (isBlackjack(dealerCards) && !isBlackjack(playerCards)) return 'lose';
  if (isBust(dealerCards)) return 'win';
  if (pv > dv) return 'win';
  if (pv < dv) return 'lose';
  return 'push';
}

function resultMessage(hands: SplitHand[], dealerCards: import('./types').Card[]): string {
  if (hands.length === 1) {
    const r = hands[0].result;
    if (r === 'blackjack') return 'Blackjack! You win 3:2!';
    if (r === 'win') return 'You win!';
    if (r === 'lose') return isBust(dealerCards) ? 'Dealer busts — you win!' : 'Dealer wins.';
    if (r === 'push') return 'Push — bet returned.';
    if (r === 'bust') return 'Bust! You lose.';
  }
  const wins = hands.filter(h => h.result === 'win' || h.result === 'blackjack').length;
  const losses = hands.filter(h => h.result === 'lose' || h.result === 'bust').length;
  const pushes = hands.filter(h => h.result === 'push').length;
  const dealerStr = isBust(dealerCards) ? 'Dealer busts!' : `Dealer: ${handValue(dealerCards)}.`;
  return `${dealerStr} Wins: ${wins} | Losses: ${losses} | Pushes: ${pushes}`;
}

function settlePayout(hands: SplitHand[]): number {
  let total = 0;
  for (const h of hands) {
    if (h.result === 'blackjack') total += h.bet + Math.floor(h.bet * 1.5);
    else if (h.result === 'win') total += h.bet * 2;
    else if (h.result === 'push') total += h.bet;
  }
  return total;
}

function runDealer(state: GameState): GameState {
  let deck = state.deck;
  let dealerHand = [...state.dealerHand]; // all face up (no hole card)

  while (dealerShouldHit(dealerHand)) {
    const [card, newDeck] = draw(deck);
    deck = newDeck;
    dealerHand = [...dealerHand, card];
  }

  const hands = state.playerHands.map(h => ({
    ...h,
    result: resolveHand(h.cards, dealerHand),
  }));

  const sideBetResults = state.sideBetResults;

  let balance = state.balance + settlePayout(hands);
  if (sideBetResults.perfectPairs) balance += sideBetResults.perfectPairs.payout;
  if (sideBetResults.twentyOnePlusThree) balance += sideBetResults.twentyOnePlusThree.payout;

  return {
    ...state,
    deck,
    dealerHand,
    playerHands: hands,
    balance,
    sideBetResults,
    phase: 'result',
    message: resultMessage(hands, dealerHand),
  };
}

function advanceHand(state: GameState): GameState {
  const next = state.playerHands.findIndex(
    (h, i) => i > state.activeHandIndex && !h.stood && !isBust(h.cards)
  );
  if (next === -1) return runDealer(state);
  return {
    ...state,
    activeHandIndex: next,
    message: `Hand ${next + 1} of ${state.playerHands.length}: Hit, Stand or Double?`,
  };
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'SET_BET': {
      if (state.phase !== 'betting') return state;
      const amount = Math.max(0, Math.min(action.amount, state.balance));
      return { ...state, currentBet: amount };
    }

    case 'SET_SIDEBET': {
      // FIX: was checking 'sidebets' phase which doesn't exist — should be 'betting'
      if (state.phase !== 'betting') return state;
      const available = state.balance - state.currentBet -
        Object.entries(state.sideBets)
          .filter(([k]) => k !== action.bet)
          .reduce((s, [, v]) => s + v, 0);
      const amount = Math.max(0, Math.min(action.amount, available, 1000));
      return { ...state, sideBets: { ...state.sideBets, [action.bet]: amount } };
    }

    case 'DEAL': {
      if (state.phase !== 'betting') return state;
      if (state.currentBet < 1) return state;
      const totalBet = state.currentBet + state.sideBets.perfectPairs + state.sideBets.twentyOnePlusThree;
      if (totalBet > state.balance) return state;

      let deck = state.deck;
      const dealCard = () => { const [c, d] = draw(deck); deck = d; return c; };

      // Player gets 2 cards, dealer gets 1 (European no-hole-card)
      const p1 = dealCard(); const p2 = dealCard(); const d1 = dealCard();
      const playerCards = [p1, p2];
      const dealerCards = [d1];
      const balance = state.balance - totalBet;

      const sideBetResults = resolveSideBets(playerCards, dealerCards, state.sideBets);
      const hands: SplitHand[] = [{ cards: playerCards, bet: state.currentBet, doubled: false, stood: false, result: null }];

      if (isBlackjack(playerCards)) {
        return runDealer({ ...state, deck, playerHands: [{ ...hands[0], stood: true }], dealerHand: dealerCards, balance, sideBetResults });
      }

      return {
        ...state, deck,
        playerHands: hands,
        dealerHand: dealerCards,
        balance,
        sideBetResults,
        phase: 'playerTurn',
        message: 'Hit, Stand, Double or Split?',
      };
    }

    case 'HIT': {
      if (state.phase !== 'playerTurn') return state;
      const [card, deck] = draw(state.deck);
      const hands = state.playerHands.map((h, i) =>
        i === state.activeHandIndex ? { ...h, cards: [...h.cards, card] } : h
      );
      const active = hands[state.activeHandIndex];
      if (isBust(active.cards)) {
        const updated = hands.map((h, i) =>
          i === state.activeHandIndex ? { ...h, result: 'bust' as HandResult } : h
        );
        return advanceHand({ ...state, deck, playerHands: updated });
      }
      // Split aces get one card only
      const isSplitAce = state.playerHands.length > 1 &&
        state.playerHands[state.activeHandIndex].cards[0].rank === 'A';
      if (isSplitAce) {
        const stood = hands.map((h, i) =>
          i === state.activeHandIndex ? { ...h, stood: true } : h
        );
        return advanceHand({ ...state, deck, playerHands: stood });
      }
      return { ...state, deck, playerHands: hands };
    }

    case 'STAND': {
      if (state.phase !== 'playerTurn') return state;
      const hands = state.playerHands.map((h, i) =>
        i === state.activeHandIndex ? { ...h, stood: true } : h
      );
      return advanceHand({ ...state, playerHands: hands });
    }

    case 'DOUBLE': {
      if (state.phase !== 'playerTurn') return state;
      const active = state.playerHands[state.activeHandIndex];
      if (!canDouble(active) || active.bet > state.balance) return state;
      const [card, deck] = draw(state.deck);
      const newCards = [...active.cards, card];
      const hands = state.playerHands.map((h, i) =>
        i === state.activeHandIndex
          ? { ...h, cards: newCards, bet: h.bet * 2, doubled: true, stood: true,
              result: isBust(newCards) ? 'bust' as HandResult : null }
          : h
      );
      return advanceHand({ ...state, deck, balance: state.balance - active.bet, playerHands: hands });
    }

    case 'SPLIT': {
      if (state.phase !== 'playerTurn') return state;
      const active = state.playerHands[state.activeHandIndex];
      if (!canSplit(active, state.playerHands.length - 1) || active.bet > state.balance) return state;
      let deck = state.deck;
      const dealCard = () => { const [c, d] = draw(deck); deck = d; return c; };
      const h1: SplitHand = { cards: [active.cards[0], dealCard()], bet: active.bet, doubled: false, stood: false, result: null };
      const h2: SplitHand = { cards: [active.cards[1], dealCard()], bet: active.bet, doubled: false, stood: false, result: null };
      const before = state.playerHands.slice(0, state.activeHandIndex);
      const after = state.playerHands.slice(state.activeHandIndex + 1);
      const hands = [...before, h1, h2, ...after];
      return {
        ...state, deck,
        playerHands: hands,
        balance: state.balance - active.bet,
        message: `Hand ${state.activeHandIndex + 1} of ${hands.length}: Hit, Stand or Double?`,
      };
    }

    case 'NEW_ROUND': {
      const deck = state.deck.length < 52 ? buildDeck() : state.deck;
      return {
        ...initial,
        deck,
        balance: state.balance,
        currentBet: 0,
        sideBets: { perfectPairs: 0, twentyOnePlusThree: 0, insurance: 0 },
        phase: 'betting',
        message: 'Place your bet to start.',
      };
    }

    default:
      return state;
  }
}

export function useBlackjack() {
  const [state, dispatch] = useReducer(reducer, initial);
  return {
    state,
    setBet: (amount: number) => dispatch({ type: 'SET_BET', amount }),
    setSideBet: (bet: keyof SideBetState, amount: number) => dispatch({ type: 'SET_SIDEBET', bet, amount }),
    deal: () => dispatch({ type: 'DEAL' }),
    hit: () => dispatch({ type: 'HIT' }),
    stand: () => dispatch({ type: 'STAND' }),
    double: () => dispatch({ type: 'DOUBLE' }),
    split: () => dispatch({ type: 'SPLIT' }),
    newRound: () => dispatch({ type: 'NEW_ROUND' }),
  };
}
