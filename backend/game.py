import random

SUITS = ['spades', 'hearts', 'diamonds', 'clubs']
RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']
RANK_INDEX = {r: i for i, r in enumerate(RANKS)}


def build_deck(num_decks=6):
    deck = [{'suit': s, 'rank': r} for _ in range(num_decks) for s in SUITS for r in RANKS]
    random.shuffle(deck)
    return deck


def card_value(rank: str) -> int:
    if rank in ('J', 'Q', 'K'):
        return 10
    if rank == 'A':
        return 11
    return int(rank)


def hand_value(cards: list) -> int:
    total = 0
    aces = 0
    for c in cards:
        if c.get('face_down'):
            continue
        total += card_value(c['rank'])
        if c['rank'] == 'A':
            aces += 1
    while total > 21 and aces > 0:
        total -= 10
        aces -= 1
    return total


def is_bust(cards: list) -> bool:
    return hand_value(cards) > 21


def is_blackjack(cards: list) -> bool:
    return len(cards) == 2 and hand_value(cards) == 21


def is_soft(cards: list) -> bool:
    total = sum(card_value(c['rank']) for c in cards)
    has_ace = any(c['rank'] == 'A' for c in cards)
    return has_ace and total <= 21


def dealer_should_hit(cards: list) -> bool:
    val = hand_value(cards)
    if val < 17:
        return True
    if val == 17 and is_soft(cards):
        return True
    return False


def _card_value_for_split(rank: str) -> int:
    """10-value cards (10, J, Q, K) are treated as equivalent for splitting."""
    if rank in ('J', 'Q', 'K', '10'):
        return 10
    return 0  # all other ranks must match exactly by rank

def can_split(hand: dict, total_splits: int) -> bool:
    cards = hand['cards']
    if len(cards) != 2 or total_splits >= 3:
        return False
    r0, r1 = cards[0]['rank'], cards[1]['rank']
    # Same rank always OK; 10/J/Q/K may split against each other too
    if r0 == r1:
        return True
    return _card_value_for_split(r0) == 10 and _card_value_for_split(r1) == 10


def can_double(hand: dict) -> bool:
    return len(hand['cards']) == 2


def resolve_hand(player_cards: list, dealer_cards: list, is_split: bool = False) -> str:
    pv = hand_value(player_cards)
    dv = hand_value(dealer_cards)
    if is_bust(player_cards):
        return 'bust'
    # A+10 on a split hand is 21, not blackjack
    if not is_split and is_blackjack(player_cards) and not is_blackjack(dealer_cards):
        return 'blackjack'
    if is_blackjack(dealer_cards) and not is_split and not is_blackjack(player_cards):
        return 'lose'
    if is_bust(dealer_cards):
        return 'win'
    if pv > dv:
        return 'win'
    if pv < dv:
        return 'lose'
    return 'push'


def settle_payout(hands: list) -> int:
    total = 0
    for h in hands:
        r = h.get('result')
        if r == 'blackjack':
            total += h['bet'] + int(h['bet'] * 1.5)
        elif r == 'win':
            total += h['bet'] * 2
        elif r == 'push':
            total += h['bet']
    return total


def evaluate_perfect_pairs(card1: dict, card2: dict):
    if card_value(card1['rank']) != card_value(card2['rank']):
        return None
    if card1['suit'] == card2['suit']:
        return {'label': 'Perfect Pair', 'multiplier': 35}
    red = {'hearts', 'diamonds'}
    both_red = card1['suit'] in red and card2['suit'] in red
    both_black = card1['suit'] not in red and card2['suit'] not in red
    if both_red or both_black:
        return {'label': 'Coloured Pair', 'multiplier': 17}
    return {'label': 'Mixed Pair', 'multiplier': 8}


def evaluate_21_plus_3(p1: dict, p2: dict, dealer: dict):
    cards = [p1, p2, dealer]
    ranks = [c['rank'] for c in cards]
    suits = [c['suit'] for c in cards]
    values = sorted(RANK_INDEX[r] for r in ranks)

    all_same_suit = len(set(suits)) == 1
    all_same_rank = len(set(ranks)) == 1
    is_straight = values[2] - values[1] == 1 and values[1] - values[0] == 1

    if all_same_rank and all_same_suit:
        return {'label': 'Suited Trips', 'multiplier': 100}
    if all_same_rank:
        return {'label': 'Three of a Kind', 'multiplier': 30}
    if all_same_suit and is_straight:
        return {'label': 'Straight Flush', 'multiplier': 40}
    if all_same_suit:
        return {'label': 'Flush', 'multiplier': 5}
    if is_straight:
        return {'label': 'Straight', 'multiplier': 10}
    return None


def resolve_side_bets(player_cards: list, dealer_cards: list, side_bets: dict) -> dict:
    result = {'perfect_pairs': None, 'twenty_one_plus_three': None, 'insurance': None}

    pp_bet = side_bets.get('perfect_pairs', 0)
    if pp_bet > 0 and len(player_cards) >= 2:
        pp = evaluate_perfect_pairs(player_cards[0], player_cards[1])
        if pp:
            result['perfect_pairs'] = {'win': True, 'payout': pp_bet * pp['multiplier'], 'label': pp['label']}
        else:
            result['perfect_pairs'] = {'win': False, 'payout': -pp_bet, 'label': 'No Pair'}

    t21_bet = side_bets.get('twenty_one_plus_three', 0)
    if t21_bet > 0 and len(player_cards) >= 2 and len(dealer_cards) >= 1:
        dealer_up = next((c for c in dealer_cards if not c.get('face_down')), dealer_cards[0])
        t = evaluate_21_plus_3(player_cards[0], player_cards[1], dealer_up)
        if t:
            result['twenty_one_plus_three'] = {'win': True, 'payout': t21_bet * t['multiplier'], 'label': t['label']}
        else:
            result['twenty_one_plus_three'] = {'win': False, 'payout': -t21_bet, 'label': 'No Win'}

    ins_bet = side_bets.get('insurance', 0)
    if ins_bet > 0:
        dealer_bj = is_blackjack(dealer_cards)
        result['insurance'] = {'win': dealer_bj, 'payout': ins_bet * 2 if dealer_bj else -ins_bet}

    return result
