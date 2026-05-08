import asyncio
import os
import time
import uuid
from typing import Dict
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from game import (
    build_deck, hand_value, is_bust, is_blackjack, can_split, can_double,
    dealer_should_hit, resolve_hand, settle_payout, resolve_side_bets,
)

DEFAULT_STARTING_BALANCE = 10_000
DEFAULT_MAX_PLAYERS = 5
BETTING_DURATION = 25  # seconds

app = FastAPI()
rooms: Dict[str, dict] = {}


# ── data constructors ─────────────────────────────────────────────────────────

def empty_hand(bet: int) -> dict:
    return {'cards': [], 'bet': bet, 'doubled': False, 'stood': False, 'result': None}


def make_player(player_id: str, name: str, starting_balance: int = DEFAULT_STARTING_BALANCE) -> dict:
    return {
        'player_id': player_id,
        'name': name,
        'balance': starting_balance,
        'current_bet': 0,
        'side_bets': {'perfect_pairs': 0, 'twenty_one_plus_three': 0, 'insurance': 0},
        'player_hands': [empty_hand(0)],
        'active_hand_index': 0,
        'side_bet_results': {'perfect_pairs': None, 'twenty_one_plus_three': None, 'insurance': None},
        'status': 'waiting',
        'ready': False,
        'insurance_done': False,
    }


def make_room(host_id: str, room_id: str, max_players: int = DEFAULT_MAX_PLAYERS, starting_balance: int = DEFAULT_STARTING_BALANCE) -> dict:
    return {
        'room_id': room_id,
        'host_id': host_id,
        'max_players': max_players,
        'starting_balance': starting_balance,
        'players': {},
        'player_order': [],
        'dealer_hand': [],
        'deck': build_deck(),
        'phase': 'waiting',
        'active_player_index': 0,
        'message': 'Waiting for players to join…',
        'connections': {},
        'spectators': {},
        'timer_task': None,
        'betting_started_at': 0.0,
    }


# ── helpers ───────────────────────────────────────────────────────────────────

def draw_card(room: dict) -> dict:
    if len(room['deck']) < 15:
        room['deck'] = build_deck()
    return room['deck'].pop(0)


def serialize_room(room: dict) -> dict:
    players_out = {}
    for pid, p in room['players'].items():
        players_out[pid] = {
            'player_id': pid,
            'name': p['name'],
            'balance': p['balance'],
            'current_bet': p['current_bet'],
            'side_bets': p['side_bets'],
            'player_hands': p['player_hands'],
            'active_hand_index': p['active_hand_index'],
            'side_bet_results': p['side_bet_results'],
            'status': p['status'],
            'ready': p.get('ready', False),
            'insurance_done': p.get('insurance_done', False),
        }

    active_pid = None
    order = room['player_order']
    idx = room['active_player_index']
    if room['phase'] == 'playing' and 0 <= idx < len(order):
        active_pid = order[idx]

    return {
        'room_id': room['room_id'],
        'host_id': room['host_id'],
        'max_players': room['max_players'],
        'starting_balance': room['starting_balance'],
        'players': players_out,
        'player_order': room['player_order'],
        'dealer_hand': room['dealer_hand'],
        'phase': room['phase'],
        'active_player_id': active_pid,
        'message': room['message'],
        'betting_started_at': room.get('betting_started_at', 0.0),
    }


async def broadcast_state(room: dict):
    state = serialize_room(room)
    dead = []
    for pid, ws in list(room['connections'].items()):
        try:
            await ws.send_json({'type': 'game_update', 'state': state, 'your_id': pid})
        except Exception:
            dead.append(pid)
    for pid in dead:
        room['connections'].pop(pid, None)

    dead_spec = []
    for sid, ws in list(room.get('spectators', {}).items()):
        try:
            await ws.send_json({'type': 'game_update', 'state': state})
        except Exception:
            dead_spec.append(sid)
    for sid in dead_spec:
        room['spectators'].pop(sid, None)


async def send_error(ws: WebSocket, message: str):
    await ws.send_json({'type': 'error', 'message': message})


# ── turn management ───────────────────────────────────────────────────────────

def start_turns(room: dict):
    for i, pid in enumerate(room['player_order']):
        p = room['players'][pid]
        if p['status'] == 'waiting_turn':
            p['status'] = 'playing'
            room['active_player_index'] = i
            room['message'] = f"{p['name']}'s turn"
            return
    run_dealer(room)


def advance_turn(room: dict):
    order = room['player_order']
    start = room['active_player_index'] + 1
    for i in range(start, len(order)):
        pid = order[i]
        p = room['players'][pid]
        if p['status'] == 'waiting_turn':
            p['status'] = 'playing'
            room['active_player_index'] = i
            room['message'] = f"{p['name']}'s turn"
            return
    run_dealer(room)


def advance_player_hand(room: dict, player_id: str):
    p = room['players'][player_id]
    next_hand = next(
        (i for i, h in enumerate(p['player_hands'])
         if i > p['active_hand_index'] and not h['stood'] and h['result'] is None),
        None,
    )
    if next_hand is not None:
        p['active_hand_index'] = next_hand
    else:
        p['status'] = 'done'
        advance_turn(room)


def run_dealer(room: dict):
    room['phase'] = 'result'
    dealer_hand = room['dealer_hand']
    while dealer_should_hit(dealer_hand):
        dealer_hand.append(draw_card(room))
    room['dealer_hand'] = dealer_hand

    # Resolve insurance: insurance wins if dealer's final hand is blackjack
    dealer_bj = is_blackjack(dealer_hand)
    for p in room['players'].values():
        ins_bet = p['side_bets'].get('insurance', 0)
        if ins_bet > 0:
            if dealer_bj:
                p['balance'] += ins_bet * 3  # return stake + 2:1 profit
            p['side_bet_results']['insurance'] = {
                'win': dealer_bj,
                'payout': ins_bet * 2 if dealer_bj else -ins_bet,
            }

    for p in room['players'].values():
        if p['status'] in ('done', 'playing', 'waiting_turn'):
            for h in p['player_hands']:
                if h['result'] is None:
                    h['result'] = resolve_hand(h['cards'], dealer_hand, h.get('is_split', False))
            payout = settle_payout(p['player_hands'])
            p['balance'] += payout
            sbr = p['side_bet_results']
            if sbr.get('perfect_pairs'):
                p['balance'] += sbr['perfect_pairs']['payout']
            if sbr.get('twenty_one_plus_three'):
                p['balance'] += sbr['twenty_one_plus_three']['payout']
            p['status'] = 'result'

    room['message'] = 'Round over! Host can start a new round.'


# ── betting timer ─────────────────────────────────────────────────────────────

def all_ready(room: dict) -> bool:
    betting = [p for p in room['players'].values() if p['status'] == 'betting']
    return len(betting) > 0 and all(p.get('ready', False) for p in betting)


def cancel_betting_timer(room: dict):
    task = room.get('timer_task')
    if task and not task.done():
        task.cancel()
    room['timer_task'] = None


async def betting_countdown(room_id: str):
    await asyncio.sleep(BETTING_DURATION)
    if room_id not in rooms:
        return
    room = rooms[room_id]
    if room['phase'] != 'betting':
        return
    room['timer_task'] = None
    if not do_deal(room):
        room['message'] = 'No bets placed — place your bets!'
        room['betting_started_at'] = time.time()
        room['timer_task'] = asyncio.create_task(betting_countdown(room_id))
    await broadcast_state(room)


def start_betting_timer(room_id: str):
    cancel_betting_timer(rooms[room_id])
    task = asyncio.create_task(betting_countdown(room_id))
    rooms[room_id]['timer_task'] = task


# ── deal logic ────────────────────────────────────────────────────────────────

def do_deal(room: dict) -> bool:
    """Deal cards to all players who placed bets. Returns True if dealt."""
    active = [pid for pid in room['player_order']
              if room['players'][pid]['current_bet'] > 0]
    if not active:
        return False

    for pid in room['player_order']:
        p = room['players'][pid]
        if p['current_bet'] == 0:
            p['status'] = 'done'
            continue
        total_bet = (p['current_bet']
                     + p['side_bets']['perfect_pairs']
                     + p['side_bets']['twenty_one_plus_three'])
        if total_bet > p['balance']:
            p['current_bet'] = 0
            p['status'] = 'done'
            continue
        c1, c2 = draw_card(room), draw_card(room)
        p['balance'] -= total_bet
        p['player_hands'] = [{'cards': [c1, c2], 'bet': p['current_bet'],
                               'doubled': False, 'stood': False, 'result': None}]
        p['active_hand_index'] = 0
        p['status'] = 'waiting_turn'

    dealer_up = draw_card(room)
    room['dealer_hand'] = [dealer_up]

    for pid in room['player_order']:
        p = room['players'][pid]
        if p['status'] == 'done':
            continue
        p['side_bet_results'] = resolve_side_bets(
            p['player_hands'][0]['cards'],
            room['dealer_hand'],
            p['side_bets'],
        )
        if is_blackjack(p['player_hands'][0]['cards']):
            p['player_hands'][0]['stood'] = True
            p['status'] = 'done'

    if dealer_up['rank'] == 'A':
        active_waiting = [p for p in room['players'].values() if p['status'] == 'waiting_turn']
        if active_waiting:
            room['phase'] = 'insurance'
            room['message'] = 'Dealer shows Ace — Insurance?'
        else:
            room['phase'] = 'playing'
            start_turns(room)
    else:
        room['phase'] = 'playing'
        start_turns(room)
    return True


def resolve_insurance(room: dict):
    # Insurance collected — proceed to playing; insurance is settled at end when dealer draws
    room['phase'] = 'playing'
    start_turns(room)


def reset_for_new_round(room: dict):
    # Players with no money stay in the room as spectators instead of being kicked
    for pid, p in room['players'].items():
        if p['balance'] <= 0:
            p['status'] = 'spectating'
            room['player_order'] = [x for x in room['player_order'] if x != pid]
    # Connections are kept so they can still receive updates and chat

    # Transfer host if they left or went broke (spectating hosts can't start rounds)
    if room['player_order']:
        host = room['players'].get(room['host_id'])
        if not host or host['status'] == 'spectating':
            room['host_id'] = room['player_order'][0]

    room['phase'] = 'betting'
    room['dealer_hand'] = []
    room['active_player_index'] = 0
    room['message'] = 'Place your bets!'
    room['betting_started_at'] = time.time()

    for p in room['players'].values():
        if p['status'] == 'spectating':
            continue  # don't reset spectating players
        p['status'] = 'betting'
        p['ready'] = False
        p['current_bet'] = 0
        p['side_bets'] = {'perfect_pairs': 0, 'twenty_one_plus_three': 0, 'insurance': 0}
        p['player_hands'] = [empty_hand(0)]
        p['active_hand_index'] = 0
        p['side_bet_results'] = {'perfect_pairs': None, 'twenty_one_plus_three': None, 'insurance': None}
        p['insurance_done'] = False


def remove_player(room: dict, pid: str) -> bool:
    """Remove a player and fix room state. Returns True if room still has active players."""
    old_order = room['player_order']
    old_active_index = room['active_player_index']
    removed_idx = next((i for i, p_id in enumerate(old_order) if p_id == pid), -1)

    was_active = (
        room['phase'] == 'playing'
        and removed_idx != -1
        and removed_idx == old_active_index
    )

    room['players'].pop(pid, None)
    room['player_order'] = [p for p in old_order if p != pid]
    room['connections'].pop(pid, None)

    # Close room when no players at all, or only spectators remain (can't play alone)
    if not room['players'] or not room['player_order']:
        return False

    if room['host_id'] == pid:
        room['host_id'] = room['player_order'][0]

    if room['phase'] == 'playing':
        if was_active:
            # Set index one before the removed slot so advance_turn scans from that slot onward
            room['active_player_index'] = old_active_index - 1
            advance_turn(room)
        elif removed_idx != -1 and removed_idx < old_active_index:
            # A player before the active one was removed — shift the index down
            room['active_player_index'] = old_active_index - 1

    if room['phase'] == 'betting' and all_ready(room):
        cancel_betting_timer(room)
        do_deal(room)

    if room['phase'] == 'insurance':
        pending = [p for p in room['players'].values()
                   if p['status'] == 'waiting_turn' and not p.get('insurance_done', False)]
        if not pending:
            resolve_insurance(room)

    return True


# ── websocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    player_id: str | None = None
    room_id: str | None = None

    try:
        while True:
            data = await ws.receive_json()
            t = data.get('type')

            # ── create_room ──────────────────────────────────────────────────
            if t == 'create_room':
                player_name = str(data.get('player_name', 'Player 1'))[:20].strip() or 'Player 1'
                player_id = str(uuid.uuid4())[:8]
                room_id = str(uuid.uuid4())[:6].upper()
                max_players = max(1, min(7, int(data.get('max_players', DEFAULT_MAX_PLAYERS))))
                starting_balance = max(500, min(50_000, int(data.get('starting_balance', DEFAULT_STARTING_BALANCE))))

                room = make_room(player_id, room_id, max_players, starting_balance)
                room['players'][player_id] = make_player(player_id, player_name, starting_balance)
                room['player_order'].append(player_id)
                room['connections'][player_id] = ws
                rooms[room_id] = room

                await ws.send_json({
                    'type': 'room_created',
                    'room_id': room_id,
                    'player_id': player_id,
                    'state': serialize_room(room),
                    'your_id': player_id,
                })

            # ── join_room ────────────────────────────────────────────────────
            elif t == 'join_room':
                join_id = str(data.get('room_id', '')).upper().strip()
                player_name = str(data.get('player_name', 'Player'))[:20].strip() or 'Player'

                if join_id not in rooms:
                    await send_error(ws, 'Room not found.')
                    continue
                room = rooms[join_id]
                if len(room['players']) >= room['max_players']:
                    await send_error(ws, f"Room is full (max {room['max_players']} players).")
                    continue
                if room['phase'] == 'playing':
                    await send_error(ws, 'Game already in progress.')
                    continue

                player_id = str(uuid.uuid4())[:8]
                room_id = join_id
                room['players'][player_id] = make_player(player_id, player_name, room['starting_balance'])
                room['player_order'].append(player_id)
                room['connections'][player_id] = ws

                # If joining during betting, mark them as betting too
                if room['phase'] == 'betting':
                    room['players'][player_id]['status'] = 'betting'

                await ws.send_json({
                    'type': 'room_joined',
                    'room_id': room_id,
                    'player_id': player_id,
                    'state': serialize_room(room),
                    'your_id': player_id,
                })
                await broadcast_state(room)

            # ── start_game ───────────────────────────────────────────────────
            elif t == 'start_game':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['host_id'] != player_id:
                    await send_error(ws, 'Only the host can start the game.')
                    continue
                reset_for_new_round(room)
                start_betting_timer(room_id)
                await broadcast_state(room)

            # ── place_bet ────────────────────────────────────────────────────
            elif t == 'place_bet':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['phase'] != 'betting':
                    continue
                p = room['players'].get(player_id)
                if not p:
                    continue
                p['ready'] = False  # unready when bet changes
                amount = max(0, min(int(data.get('amount', 0)), p['balance']))
                p['current_bet'] = amount
                await broadcast_state(room)

            # ── place_side_bet ───────────────────────────────────────────────
            elif t == 'place_side_bet':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['phase'] != 'betting':
                    continue
                p = room['players'].get(player_id)
                if not p:
                    continue
                bet_type = data.get('bet_type')
                if bet_type not in ('perfect_pairs', 'twenty_one_plus_three'):
                    continue
                p['ready'] = False
                other = sum(v for k, v in p['side_bets'].items() if k != bet_type)
                max_amt = min(1000, p['balance'] - p['current_bet'] - other)
                amount = max(0, min(int(data.get('amount', 0)), max_amt))
                p['side_bets'][bet_type] = amount
                await broadcast_state(room)

            # ── set_ready ────────────────────────────────────────────────────
            elif t == 'set_ready':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['phase'] != 'betting':
                    continue
                p = room['players'].get(player_id)
                if not p or p['current_bet'] == 0:
                    await send_error(ws, 'Place a bet before readying up.')
                    continue
                p['ready'] = True
                if all_ready(room):
                    cancel_betting_timer(room)
                    do_deal(room)
                await broadcast_state(room)

            # ── deal (host force-deal) ────────────────────────────────────────
            elif t == 'deal':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['host_id'] != player_id:
                    await send_error(ws, 'Only the host can deal.')
                    continue
                if room['phase'] != 'betting':
                    continue
                cancel_betting_timer(room)
                if not do_deal(room):
                    await send_error(ws, 'At least one player must place a bet.')
                    continue
                await broadcast_state(room)

            # ── set_insurance ─────────────────────────────────────────────────
            elif t == 'set_insurance':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['phase'] != 'insurance':
                    continue
                p = room['players'].get(player_id)
                if not p or p.get('insurance_done') or p['status'] != 'waiting_turn':
                    continue
                max_ins = p['current_bet'] // 2
                amount = max(0, min(int(data.get('amount', 0)), max_ins))
                p['balance'] -= amount
                p['side_bets']['insurance'] = amount
                p['insurance_done'] = True
                pending = [q for q in room['players'].values()
                           if q['status'] == 'waiting_turn' and not q.get('insurance_done', False)]
                if not pending:
                    resolve_insurance(room)
                await broadcast_state(room)

            # ── hit ──────────────────────────────────────────────────────────
            elif t == 'hit':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['phase'] != 'playing':
                    continue
                order = room['player_order']
                if order[room['active_player_index']] != player_id:
                    await send_error(ws, "It's not your turn.")
                    continue
                p = room['players'][player_id]
                hand = p['player_hands'][p['active_hand_index']]
                hand['cards'].append(draw_card(room))
                if is_bust(hand['cards']):
                    hand['result'] = 'bust'
                    advance_player_hand(room, player_id)
                elif hand_value(hand['cards']) == 21:
                    hand['stood'] = True
                    advance_player_hand(room, player_id)
                else:
                    is_split_ace = (
                        len(p['player_hands']) > 1
                        and p['player_hands'][p['active_hand_index']]['cards'][0]['rank'] == 'A'
                    )
                    if is_split_ace:
                        hand['stood'] = True
                        advance_player_hand(room, player_id)
                await broadcast_state(room)

            # ── stand ────────────────────────────────────────────────────────
            elif t == 'stand':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['phase'] != 'playing':
                    continue
                order = room['player_order']
                if order[room['active_player_index']] != player_id:
                    await send_error(ws, "It's not your turn.")
                    continue
                p = room['players'][player_id]
                p['player_hands'][p['active_hand_index']]['stood'] = True
                advance_player_hand(room, player_id)
                await broadcast_state(room)

            # ── double ───────────────────────────────────────────────────────
            elif t == 'double':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['phase'] != 'playing':
                    continue
                order = room['player_order']
                if order[room['active_player_index']] != player_id:
                    await send_error(ws, "It's not your turn.")
                    continue
                p = room['players'][player_id]
                hand = p['player_hands'][p['active_hand_index']]
                if not can_double(hand) or hand['bet'] > p['balance']:
                    await send_error(ws, 'Cannot double.')
                    continue
                hand['cards'].append(draw_card(room))
                p['balance'] -= hand['bet']
                hand['bet'] *= 2
                hand['doubled'] = True
                hand['stood'] = True
                if is_bust(hand['cards']):
                    hand['result'] = 'bust'
                advance_player_hand(room, player_id)
                await broadcast_state(room)

            # ── split ────────────────────────────────────────────────────────
            elif t == 'split':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['phase'] != 'playing':
                    continue
                order = room['player_order']
                if order[room['active_player_index']] != player_id:
                    await send_error(ws, "It's not your turn.")
                    continue
                p = room['players'][player_id]
                hi = p['active_hand_index']
                hand = p['player_hands'][hi]
                if not can_split(hand, len(p['player_hands']) - 1) or hand['bet'] > p['balance']:
                    await send_error(ws, 'Cannot split.')
                    continue
                c1, c2 = draw_card(room), draw_card(room)
                h1 = {'cards': [hand['cards'][0], c1], 'bet': hand['bet'],
                       'doubled': False, 'stood': False, 'result': None, 'is_split': True}
                h2 = {'cards': [hand['cards'][1], c2], 'bet': hand['bet'],
                       'doubled': False, 'stood': False, 'result': None, 'is_split': True}
                p['balance'] -= hand['bet']
                if hand_value(h1['cards']) == 21:
                    h1['stood'] = True
                if hand_value(h2['cards']) == 21:
                    h2['stood'] = True
                p['player_hands'] = p['player_hands'][:hi] + [h1, h2] + p['player_hands'][hi + 1:]
                if p['player_hands'][p['active_hand_index']]['stood']:
                    advance_player_hand(room, player_id)
                await broadcast_state(room)

            # ── new_round ────────────────────────────────────────────────────
            elif t == 'new_round':
                if not room_id or room_id not in rooms:
                    continue
                room = rooms[room_id]
                if room['host_id'] != player_id:
                    await send_error(ws, 'Only the host can start a new round.')
                    continue
                reset_for_new_round(room)
                start_betting_timer(room_id)
                await broadcast_state(room)

            # ── chat ─────────────────────────────────────────────────────────
            elif t == 'chat':
                if not room_id or room_id not in rooms or not player_id:
                    continue
                room = rooms[room_id]
                p = room['players'].get(player_id)
                if not p:
                    continue
                text = str(data.get('text', ''))[:200].strip()
                if text:
                    chat_msg = {
                        'type': 'chat',
                        'player_name': p['name'],
                        'player_id': player_id,
                        'text': text,
                        'ts': time.time(),
                    }
                    for conn in list(room['connections'].values()):
                        try: await conn.send_json(chat_msg)
                        except: pass
                    for conn in list(room.get('spectators', {}).values()):
                        try: await conn.send_json(chat_msg)
                        except: pass

            # ── leave_room ───────────────────────────────────────────────────
            elif t == 'leave_room':
                if not room_id or room_id not in rooms or not player_id:
                    break
                room = rooms[room_id]
                cancel_betting_timer(room)
                still_alive = remove_player(room, player_id)
                if still_alive:
                    if room['phase'] == 'betting':
                        room['betting_started_at'] = time.time()
                        start_betting_timer(room_id)
                    await broadcast_state(room)
                else:
                    rooms.pop(room_id, None)
                player_id = None
                room_id = None
                break

    except WebSocketDisconnect:
        pass
    finally:
        if room_id and room_id in rooms and player_id:
            room = rooms[room_id]
            room['connections'].pop(player_id, None)
            # Don't remove player on disconnect — they can reconnect
            # But if no connections left, keep room alive for a bit


async def broadcast_closed(room: dict):
    msg = {'type': 'room_closed', 'message': 'Room was closed by admin.'}
    for ws in list(room['connections'].values()):
        try: await ws.send_json(msg)
        except: pass
    for ws in list(room.get('spectators', {}).values()):
        try: await ws.send_json(msg)
        except: pass


# ── admin REST endpoint ───────────────────────────────────────────────────────

@app.get('/api/rooms')
async def get_rooms():
    result = []
    for room_id, room in rooms.items():
        result.append({
            'room_id': room_id,
            'phase': room['phase'],
            'player_count': len(room['players']),
            'max_players': room['max_players'],
            'starting_balance': room['starting_balance'],
            'spectator_count': len(room.get('spectators', {})),
            'players': [
                {'player_id': pid, 'name': p['name'], 'balance': p['balance'], 'status': p['status']}
                for pid, p in room['players'].items()
            ],
        })
    return {'rooms': result}


@app.delete('/api/rooms/{room_id}/players/{player_id}')
async def kick_player(room_id: str, player_id: str):
    rid = room_id.upper()
    if rid not in rooms:
        return {'ok': False, 'message': 'Room not found.'}
    room = rooms[rid]
    if player_id not in room['players']:
        return {'ok': False, 'message': 'Player not found.'}

    kicked_ws = room['connections'].get(player_id)
    if kicked_ws:
        try:
            await kicked_ws.send_json({'type': 'kicked', 'message': 'You were removed by the admin.'})
        except Exception:
            pass

    still_alive = remove_player(room, player_id)
    if not still_alive:
        cancel_betting_timer(room)
        await broadcast_closed(room)
        rooms.pop(rid, None)
    else:
        if room['phase'] == 'betting':
            room['betting_started_at'] = time.time()
            start_betting_timer(rid)
        await broadcast_state(room)
    return {'ok': True}


@app.delete('/api/rooms/{room_id}')
async def close_room(room_id: str):
    rid = room_id.upper()
    if rid not in rooms:
        return {'ok': False, 'message': 'Room not found.'}
    room = rooms.pop(rid)
    cancel_betting_timer(room)
    await broadcast_closed(room)
    return {'ok': True}


# ── spectator websocket ───────────────────────────────────────────────────────

@app.websocket('/ws/spectate')
async def spectate_endpoint(ws: WebSocket):
    await ws.accept()
    spectator_id: str | None = None
    room_id: str | None = None

    try:
        data = await ws.receive_json()
        if data.get('type') != 'spectate_room':
            await ws.close()
            return

        rid = str(data.get('room_id', '')).upper().strip()
        if rid not in rooms:
            await ws.send_json({'type': 'error', 'message': 'Room not found.'})
            await ws.close()
            return

        spectator_id = str(uuid.uuid4())[:8]
        room_id = rid
        room = rooms[room_id]
        room['spectators'][spectator_id] = ws

        await ws.send_json({'type': 'spectate_joined', 'state': serialize_room(room)})

        # Hold connection open; drain any messages (spectators can't act)
        while True:
            await ws.receive_text()

    except WebSocketDisconnect:
        pass
    finally:
        if room_id and room_id in rooms and spectator_id:
            rooms[room_id]['spectators'].pop(spectator_id, None)


# ── static files (production) ─────────────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')

if os.path.isdir(STATIC_DIR):
    app.mount('/assets', StaticFiles(directory=os.path.join(STATIC_DIR, 'assets')), name='assets')

    @app.get('/{full_path:path}')
    async def serve_spa(full_path: str):
        return FileResponse(os.path.join(STATIC_DIR, 'index.html'))
