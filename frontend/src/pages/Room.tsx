import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import HandView from '../components/HandView';
import { canSplit, canDouble } from '../gameLogic';
import type { RoomState, WsMessage, PlayerState, HandResult, SideBetEntry } from '../types';

const CHIP_DEFS = [
  { value: 1000, cls: 'c-1000' },
  { value: 500,  cls: 'c-500'  },
  { value: 100,  cls: 'c-100'  },
  { value: 50,   cls: 'c-50'   },
  { value: 25,   cls: 'c-25'   },
  { value: 10,   cls: 'c-10'   },
  { value: 5,    cls: 'c-5'    },
];

const BETTING_DURATION = 25;
// Deterministic rotations so chips don't spin on re-render
const CHIP_ROTS = [-8, 5, -13, 3, 11, -5, 9];

function getWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (
    import.meta.env.DEV &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
  ) {
    return `${proto}//${window.location.hostname}:8001/ws`;
  }
  return `${proto}//${window.location.host}/ws`;
}

// ── Timer bar ─────────────────────────────────────────────────────────────────

function TimerBar({ startedAt }: { startedAt: number }) {
  const [pct, setPct] = useState(100);
  const [secs, setSecs] = useState(BETTING_DURATION);
  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() / 1000 - startedAt;
      const left = Math.max(0, BETTING_DURATION - elapsed);
      setSecs(Math.ceil(left));
      setPct((left / BETTING_DURATION) * 100);
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [startedAt]);
  const color = pct > 50 ? '#4ade80' : pct > 25 ? '#facc15' : '#f87171';
  return (
    <div className="timer-wrap">
      <div className="timer-bar-bg">
        <div className="timer-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="timer-secs" style={{ color }}>{secs}s</span>
    </div>
  );
}

// ── Opponent slots — 5 positions around the felt arc ─────────────────────────

const OPP_SLOTS = [
  { top: 70, left: 68 },  // near-right
  { top: 70, left: 32 },  // near-left
  { top: 46, left: 84 },  // far-right
  { top: 46, left: 16 },  // far-left
  { top: 18, left: 68 },  // back-right
  { top: 18, left: 32 },  // back-left
];

const OPP_DIST: Record<number, number[]> = {
  1: [4],
  2: [4, 5],
  3: [0, 4, 1],
  4: [0, 2, 3, 1],
  5: [0, 2, 4, 5, 3],  // skip near-left, fill right-arc first then left
  6: [0, 2, 4, 5, 3, 1],
};

// ── Table chip stack ──────────────────────────────────────────────────────────

function TableChipStack({ amount, chipSize = 36 }: { amount: number; chipSize?: number }) {
  if (!amount) return null;
  const chips: string[] = [];
  let rem = amount;
  for (const { value, cls } of CHIP_DEFS) {
    while (rem >= value && chips.length < 7) {
      chips.push(cls);
      rem -= value;
    }
  }
  const step = Math.max(6, Math.round(chipSize * 0.25));
  const totalH = chipSize + (chips.length - 1) * step;
  return (
    <div style={{ position: 'relative', width: chipSize, height: totalH, flexShrink: 0 }}>
      {chips.map((cls, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            bottom: i * step,
            left: 0,
            width: chipSize,
            height: chipSize,
            transform: `rotate(${CHIP_ROTS[i % 7]}deg)`,
          }}
        >
          <div
            className={`tcs-disc ${cls}`}
            style={{ width: chipSize, height: chipSize, animationDelay: `${i * 55}ms` }}
          />
        </div>
      ))}
    </div>
  );
}

// ── Result helpers ────────────────────────────────────────────────────────────

function resultCls(r: HandResult | null | undefined): string {
  if (!r) return '';
  if (r === 'blackjack') return 'bef-result-blackjack';
  if (r === 'win')       return 'bef-result-win';
  if (r === 'lose' || r === 'bust') return 'bef-result-lose';
  if (r === 'push')      return 'bef-result-push';
  return '';
}

function PayoutLabel({ result, bet }: { result: HandResult; bet: number }) {
  if (result === 'blackjack') return <span className="payout-label payout-win">+${Math.floor(bet * 1.5)}</span>;
  if (result === 'win')       return <span className="payout-label payout-win">+${bet}</span>;
  if (result === 'lose' || result === 'bust') return <span className="payout-label payout-lose">−${bet}</span>;
  if (result === 'push')      return <span className="payout-label payout-push">push</span>;
  return null;
}

// ── Betting box ───────────────────────────────────────────────────────────────

function BettingBox({
  amount, onClick, interactive, result, isDragActive, isDropOver,
}: {
  amount: number; onClick?: () => void; interactive?: boolean;
  result?: HandResult | null; isDragActive?: boolean; isDropOver?: boolean;
}) {
  const active = amount > 0;
  const rc = resultCls(result);
  return (
    <div
      className={[
        'betting-box',
        active ? 'bb-active' : '',
        interactive ? 'bb-interactive' : '',
        rc,
        isDragActive ? 'drop-ready' : '',
        isDropOver ? 'drop-over' : '',
      ].filter(Boolean).join(' ')}
      onClick={interactive ? onClick : undefined}
    >
      <span className="bb-label">BET</span>
      <div className="bb-chips-area">
        {active ? (
          <>
            <TableChipStack amount={amount} chipSize={34} />
            <span className="bb-amt">${amount}</span>
          </>
        ) : (
          <span className="bb-empty">
            {isDropOver ? 'DROP' : interactive ? 'CLICK' : ''}
          </span>
        )}
      </div>
      {result && <PayoutLabel result={result} bet={amount} />}
    </div>
  );
}

// ── Side bet zone ─────────────────────────────────────────────────────────────

function SideBetZone({
  label, paysText, amount, onClick, interactive, sbResult, isDragActive, isDropOver,
}: {
  label: string; paysText: string; amount: number; onClick?: () => void;
  interactive?: boolean; sbResult?: SideBetEntry | null;
  isDragActive?: boolean; isDropOver?: boolean;
}) {
  const active = amount > 0;
  const hasResult = !!sbResult;
  const won = sbResult?.win;
  return (
    <div
      className={[
        'sidebet-zone',
        active ? 'sbz-active' : '',
        interactive ? 'sbz-interactive' : '',
        hasResult ? (won ? 'sbz-win' : 'sbz-lose') : '',
        isDragActive ? 'drop-ready' : '',
        isDropOver ? 'drop-over' : '',
      ].filter(Boolean).join(' ')}
      onClick={interactive ? onClick : undefined}
    >
      <span className="sbz-label">{label}</span>
      <span className="sbz-pays">{paysText}</span>
      {active && !hasResult && (
        <>
          <TableChipStack amount={amount} chipSize={22} />
          <span className="sbz-amt">${amount}</span>
        </>
      )}
      {hasResult && (
        <span className={won ? 'sbz-res-win' : 'sbz-res-lose'}>
          {won ? `+$${sbResult!.payout}` : `−$${Math.abs(sbResult!.payout)}`}
        </span>
      )}
    </div>
  );
}

// ── Opponent seat ─────────────────────────────────────────────────────────────

function OpponentSeat({
  player, isActive, isHost, phase, top, left,
}: {
  player: PlayerState; isActive: boolean; isHost: boolean; phase: string;
  top: number; left: number;
}) {
  const hasCards = player.player_hands[0]?.cards.length > 0;
  const dispBet = hasCards ? (player.player_hands[0]?.bet ?? player.current_bet) : player.current_bet;
  const oppResult = phase === 'result' ? (player.player_hands[0]?.result ?? null) : null;

  return (
    <div
      className={`opp-seat${isActive ? ' opp-seat-active' : ''}`}
      style={{ position: 'absolute', top: `${top}%`, left: `${left}%`, transform: 'translate(-50%, 0)' }}
    >
      <div className="opp-name-tag">
        {isHost && <span className="badge-host">HOST</span>}
        <span>{player.name}</span>
        {isActive && <span className="turn-dot" />}
      </div>
      <span className="opp-bal">${player.balance.toLocaleString()}</span>
      {hasCards && (
        <div className="opp-cards">
          {player.player_hands.map((hand, i) => (
            <HandView key={i} cards={hand.cards}
              active={isActive && i === player.active_hand_index}
              result={phase === 'result' ? (hand.result ?? undefined) : undefined}
            />
          ))}
        </div>
      )}
      <div className="opp-bet-row">
        {player.side_bets.perfect_pairs > 0 && <div className="opp-sb-dot">PP</div>}
        <div className={['opp-bet-box', dispBet > 0 ? 'obb-active' : '', resultCls(oppResult)].filter(Boolean).join(' ')}>
          {dispBet > 0 ? <span>${dispBet}</span> : <span className="obb-empty">BET</span>}
        </div>
        {player.side_bets.twenty_one_plus_three > 0 && <div className="opp-sb-dot">21+3</div>}
      </div>
    </div>
  );
}

// ── Room ──────────────────────────────────────────────────────────────────────

export default function Room() {
  const { roomId } = useParams<{ roomId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const locState = location.state as {
    action?: string; playerName?: string; maxPlayers?: number; startingBalance?: number;
  } | null;

  const wsRef = useRef<WebSocket | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<RoomState | null>(null);
  const [statusMsg, setStatusMsg] = useState('Connecting…');
  const [copyMsg, setCopyMsg] = useState('');
  const [insuranceAmt, setInsuranceAmt] = useState(0);
  const [selectedChip, setSelectedChip] = useState(25);

  const [dragChip, setDragChip] = useState<{ value: number; cls: string } | null>(null);
  const [dragPos, setDragPos]   = useState({ x: 0, y: 0 });
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);

  const dragStateRef = useRef<{
    value: number; cls: string; startX: number; startY: number; active: boolean;
  } | null>(null);
  const meRef        = useRef<PlayerState | undefined>(undefined);
  const isBettingRef = useRef(false);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    const playerName = locState?.playerName ?? sessionStorage.getItem('playerName') ?? 'Player';
    sessionStorage.setItem('playerName', playerName);
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    ws.onopen = () => {
      if (locState?.action === 'create' || (!roomId && !locState?.action))
        ws.send(JSON.stringify({
          type: 'create_room',
          player_name: playerName,
          max_players: locState?.maxPlayers ?? 5,
          starting_balance: locState?.startingBalance ?? 10_000,
        }));
      else
        ws.send(JSON.stringify({ type: 'join_room', room_id: roomId ?? '', player_name: playerName }));
    };
    ws.onmessage = (e) => {
      const msg: WsMessage = JSON.parse(e.data);
      if (msg.type === 'room_created' || msg.type === 'room_joined') {
        setMyId(msg.your_id ?? null);
        if (msg.state) setGameState(msg.state);
        if (msg.type === 'room_created' && msg.room_id)
          window.history.replaceState({}, '', `/room/${msg.room_id}`);
        setStatusMsg('');
      } else if (msg.type === 'game_update') {
        setMyId(prev => prev ?? msg.your_id ?? null);
        if (msg.state) setGameState(msg.state);
      } else if (msg.type === 'error') {
        setStatusMsg(msg.message ?? 'Error');
      }
    };
    ws.onclose = () => setStatusMsg('Disconnected.');
    ws.onerror  = () => setStatusMsg('Could not connect.');
    return () => ws.close();
  }, []);

  useEffect(() => {
    const getZone = (x: number, y: number): string | null => {
      let node: Element | null = document.elementFromPoint(x, y);
      while (node) {
        const z = (node as HTMLElement).dataset?.zone;
        if (z) return z;
        node = node.parentElement;
      }
      return null;
    };

    const onMove = (e: PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      if (!ds.active) {
        if (Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY) > 8) {
          ds.active = true;
          setDragChip({ value: ds.value, cls: ds.cls });
        }
      }
      if (ds.active) {
        setDragPos({ x: e.clientX, y: e.clientY });
        setDragOverZone(getZone(e.clientX, e.clientY));
      }
    };

    const onUp = (e: PointerEvent) => {
      const ds = dragStateRef.current;
      if (ds?.active) {
        const zone = getZone(e.clientX, e.clientY);
        const m = meRef.current;
        if (zone && isBettingRef.current && m) {
          const v = ds.value;
          const totalSB = m.side_bets.perfect_pairs + m.side_bets.twenty_one_plus_three;
          if (zone === 'main') {
            send({ type: 'place_bet', amount: Math.min(m.current_bet + v, Math.max(0, m.balance - totalSB)) });
          } else if (zone === 'pp') {
            const maxSb = Math.min(1000, m.balance - m.current_bet - m.side_bets.twenty_one_plus_three);
            if (v <= maxSb) send({ type: 'place_side_bet', bet_type: 'perfect_pairs', amount: m.side_bets.perfect_pairs + v });
          } else if (zone === '21p3') {
            const maxSb = Math.min(1000, m.balance - m.current_bet - m.side_bets.perfect_pairs);
            if (v <= maxSb) send({ type: 'place_side_bet', bet_type: 'twenty_one_plus_three', amount: m.side_bets.twenty_one_plus_three + v });
          }
        }
      }
      dragStateRef.current = null;
      setDragChip(null);
      setDragOverZone(null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [send]);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (!gameState || !myId) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1 className="lobby-title">♠ BLACKJACK ♦</h1>
          <p className="lobby-sub">{statusMsg || 'Connecting…'}</p>
          <button className="btn-ghost" style={{ marginTop: 24 }} onClick={() => navigate('/')}>← Back</button>
        </div>
      </div>
    );
  }

  const { phase, players, player_order, dealer_hand, host_id, active_player_id, message } = gameState;
  const me = players[myId];

  meRef.current = me;
  isBettingRef.current = phase === 'betting' && me?.status === 'betting' && !(me?.ready);

  const isHost   = host_id === myId;
  const isMyTurn = active_player_id === myId;
  const otherIds = player_order.filter(pid => pid !== myId);

  const myActiveHand    = me?.player_hands[me.active_hand_index];
  const canAct          = phase === 'playing' && isMyTurn && !!myActiveHand;
  const isBetting       = isBettingRef.current;
  const insurancePending = phase === 'insurance' && me?.status === 'waiting_turn' && !me?.insurance_done;
  const maxInsurance    = Math.floor((me?.current_bet ?? 0) / 2);
  const canDoubleShow   = canAct && canDouble(myActiveHand);
  const canDoubleActive = canDoubleShow && (myActiveHand?.bet ?? 0) <= (me?.balance ?? 0);
  const canSplitShow    = canAct && canSplit(myActiveHand, (me?.player_hands.length ?? 1) - 1);
  const canSplitActive  = canSplitShow && (myActiveHand?.bet ?? 0) <= (me?.balance ?? 0);
  const totalSideBets   = (me?.side_bets.perfect_pairs ?? 0) + (me?.side_bets.twenty_one_plus_three ?? 0);
  const maxMainBet      = Math.max(0, (me?.balance ?? 0) - totalSideBets);
  const myHasCards      = (me?.player_hands[0]?.cards.length ?? 0) > 0;
  const isDragging      = dragChip !== null;

  const handleMainBet = () => {
    if (!isBetting) return;
    send({ type: 'place_bet', amount: Math.min((me?.current_bet ?? 0) + selectedChip, maxMainBet) });
  };
  const handleSideBet = (bt: 'perfect_pairs' | 'twenty_one_plus_three') => {
    if (!isBetting) return;
    const cur   = me?.side_bets[bt] ?? 0;
    const other = bt === 'perfect_pairs' ? (me?.side_bets.twenty_one_plus_three ?? 0) : (me?.side_bets.perfect_pairs ?? 0);
    const maxSb = Math.min(1000, (me?.balance ?? 0) - (me?.current_bet ?? 0) - other);
    if (selectedChip > maxSb) return;
    send({ type: 'place_side_bet', bet_type: bt, amount: cur + selectedChip });
  };

  // ── Waiting room ───────────────────────────────────────────────────────────

  if (phase === 'waiting') {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1 className="lobby-title">♠ BLACKJACK ♦</h1>
          <div className="room-code-block">
            <span className="room-code-lbl">Room Code</span>
            <span className="room-code">{gameState.room_id}</span>
            <button className="btn-ghost room-copy-btn" onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              setCopyMsg('Copied!'); setTimeout(() => setCopyMsg(''), 2000);
            }}>{copyMsg || 'Copy Link'}</button>
          </div>
          <div className="player-list">
            {player_order.map(pid => (
              <div key={pid} className="player-list-item">
                <span>{players[pid]?.name}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {pid === host_id && <span className="badge-host">Host</span>}
                  {pid === myId    && <span className="badge-you">You</span>}
                </div>
              </div>
            ))}
          </div>
          <p className="lobby-sub">{player_order.length}/{gameState.max_players ?? 5} players</p>
          <div style={{ display: 'flex', gap: 10 }}>
            {isHost
              ? <button className="btn-deal" style={{ flex: 1 }} onClick={() => send({ type: 'start_game' })}>Start Game</button>
              : <p className="lobby-sub" style={{ flex: 1, textAlign: 'center' }}>Waiting for host…</p>}
            <button className="btn-ghost" onClick={() => { send({ type: 'leave_room' }); navigate('/'); }}>Leave</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Opponent slot assignment ───────────────────────────────────────────────

  const oppCount = Math.min(otherIds.length, 6);
  const slotIndices = OPP_DIST[oppCount] ?? [];

  // ── Game table ─────────────────────────────────────────────────────────────

  return (
    <div className="app">

      {/* SVG filter for felt noise texture */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="felt-noise" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.75 0.75"
              numOctaves="4" seed="3" stitchTiles="stitch" result="noise" />
            <feColorMatrix type="saturate" values="0" in="noise" result="gray" />
            <feBlend in="SourceGraphic" in2="gray" mode="multiply" result="blended" />
            <feComposite in="blended" in2="SourceGraphic" operator="in" />
          </filter>
        </defs>
      </svg>

      {/* Header */}
      <header className="hdr">
        <span className="hdr-title">♠ BLACKJACK ♦</span>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
          <div className="hdr-bal">
            <span className="hdr-bal-lbl">Balance</span>
            <span className="hdr-bal-amt">${(me?.balance ?? 0).toLocaleString()}</span>
          </div>
          <div className="hdr-bal">
            <span className="hdr-bal-lbl">Room</span>
            <span className="hdr-bal-amt" style={{ fontSize: 13, letterSpacing: 3 }}>{gameState.room_id}</span>
          </div>
          <button className="btn-ghost leave-btn"
            onClick={() => { send({ type: 'leave_room' }); navigate('/'); }}
            title="Leave">✕</button>
        </div>
      </header>

      <div className="game-body">

        {/* ── Casino table ──────────────────────────────────────────────────── */}
        <div className="table-wrap">
          <div className="table-rim">
            <div className="casino-table">

              {/* Dealer */}
              <div className="ct-dealer">
                <span className="felt-zone-lbl">DEALER</span>
                {dealer_hand.length > 0
                  ? <HandView cards={dealer_hand} />
                  : <div className="ct-dealer-empty" />}
              </div>

              {/* Center rules + message */}
              <div className="ct-info">
                <span className="ct-rule-main">BLACKJACK PAYS 3 TO 2</span>
                <span className="ct-rule-sub">DEALER STANDS ON ALL 17s</span>
                {message && (
                  <div className={`ct-msg${phase === 'result' ? ' ct-msg-result' : ''}`}>
                    {message}
                  </div>
                )}
                {phase === 'betting' && gameState.betting_started_at > 0 &&
                  <TimerBar startedAt={gameState.betting_started_at} />}
              </div>

              {/* Opponent seats */}
              {otherIds.map((pid, i) => {
                const slotIdx = slotIndices[i];
                const slot = OPP_SLOTS[slotIdx];
                if (slot === undefined || !players[pid]) return null;
                return (
                  <OpponentSeat key={pid} player={players[pid]}
                    isActive={active_player_id === pid} isHost={host_id === pid}
                    phase={phase} top={slot.top} left={slot.left} />
                );
              })}

              {/* My seat — bottom center */}
              <div className="my-seat">
                {me && (
                  <div className="my-table-area">

                    {myHasCards && (
                      <div className="my-hands-row">
                        {me.player_hands.map((hand, i) => {
                          const isSplit = me.player_hands.length > 1;
                          const isActiveHand = canAct && i === me.active_hand_index;
                          return (
                            <div key={i} className={[
                              'my-hand-bet-group',
                              isSplit ? 'split-group' : '',
                              isSplit && isActiveHand ? 'split-group-active' : '',
                            ].filter(Boolean).join(' ')}>
                              <HandView
                                cards={hand.cards}
                                label={isSplit ? `H${i + 1}` : undefined}
                                active={isActiveHand}
                                result={phase === 'result' ? (hand.result ?? undefined) : undefined}
                              />
                              {/* Bet box inline with hand when split */}
                              {isSplit && (
                                <BettingBox
                                  amount={hand.bet}
                                  result={phase === 'result' ? (hand.result ?? null) : null}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Betting row — PP | main bet(s) | 21+3 */}
                    <div className="my-betting-row">

                      <div data-zone="pp">
                        <SideBetZone
                          label="PP" paysText="35:1"
                          amount={me.side_bets.perfect_pairs}
                          onClick={() => handleSideBet('perfect_pairs')}
                          interactive={isBetting}
                          sbResult={phase === 'result' ? me.side_bet_results.perfect_pairs : null}
                          isDragActive={isBetting && isDragging}
                          isDropOver={dragOverZone === 'pp'}
                        />
                      </div>

                      <div className="my-main-bets">
                        {myHasCards
                          ? (me.player_hands.length === 1
                              ? <BettingBox
                                  amount={me.player_hands[0].bet}
                                  result={phase === 'result' ? (me.player_hands[0].result ?? null) : null}
                                />
                              : null /* split: bet boxes live inside each split-group above */
                            )
                          : <div data-zone="main">
                              <BettingBox
                                amount={me.current_bet}
                                onClick={handleMainBet}
                                interactive={isBetting}
                                result={null}
                                isDragActive={isBetting && isDragging}
                                isDropOver={dragOverZone === 'main'}
                              />
                            </div>
                        }
                      </div>

                      <div data-zone="21p3">
                        <SideBetZone
                          label="21+3" paysText="9:1"
                          amount={me.side_bets.twenty_one_plus_three}
                          onClick={() => handleSideBet('twenty_one_plus_three')}
                          interactive={isBetting}
                          sbResult={phase === 'result' ? me.side_bet_results.twenty_one_plus_three : null}
                          isDragActive={isBetting && isDragging}
                          isDropOver={dragOverZone === '21p3'}
                        />
                      </div>

                    </div>
                  </div>
                )}

                <div className="my-tag">
                  {isHost && <span className="badge-host">HOST</span>}
                  <span className="my-name">{me?.name}</span>
                  <span className="badge-you">YOU</span>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* ── Chip dock ────────────────────────────────────────────────────── */}
        <div className="chip-dock">

          {/* Left zone: phase-specific controls */}
          <div className="dock-zone dock-left">

            {/* Betting controls */}
            {isBetting && (
              <div className="dock-bet-actions">
                <button className="btn-ghost dock-btn"
                  onClick={() => { send({ type: 'place_bet', amount: 0 }); send({ type: 'place_side_bet', bet_type: 'perfect_pairs', amount: 0 }); send({ type: 'place_side_bet', bet_type: 'twenty_one_plus_three', amount: 0 }); }}
                  disabled={(me?.current_bet ?? 0) === 0 && totalSideBets === 0}>
                  Clear
                </button>
                <button className="btn-ready dock-btn"
                  onClick={() => send({ type: 'set_ready' })}
                  disabled={(me?.current_bet ?? 0) === 0}>
                  ✓ Ready
                </button>
                {isHost && (
                  <button className="btn-deal dock-btn"
                    onClick={() => send({ type: 'deal' })}
                    disabled={(me?.current_bet ?? 0) === 0}>
                    Deal
                  </button>
                )}
              </div>
            )}

            {phase === 'betting' && me?.ready && (
              <p className="dock-status">
                ✓ Ready — {player_order.filter(pid => !players[pid]?.ready).length} waiting
              </p>
            )}

            {/* Action buttons */}
            {canAct && (
              <div className="action-row">
                <button className="act act-hit"   onClick={() => send({ type: 'hit' })}>Hit</button>
                <button className="act act-stand" onClick={() => send({ type: 'stand' })}>Stand</button>
                {canDoubleShow && (
                  <button className="act act-double" disabled={!canDoubleActive}
                    onClick={() => send({ type: 'double' })}>Double</button>
                )}
                {canSplitShow && (
                  <button className="act act-split" disabled={!canSplitActive}
                    onClick={() => send({ type: 'split' })}>Split</button>
                )}
              </div>
            )}

            {phase === 'playing' && !isMyTurn && (
              <p className="dock-status">
                {active_player_id
                  ? `${players[active_player_id]?.name ?? '…'}'s turn`
                  : 'Dealer is playing…'}
              </p>
            )}

            {/* Insurance */}
            {insurancePending && (
              <div className="insurance-ctrl">
                <span className="ins-ctrl-title">Insurance? (max ${maxInsurance})</span>
                <div className="ins-ctrl-row">
                  <button className="sb-btn"
                    onClick={() => setInsuranceAmt(a => Math.max(0, a - 5))}
                    disabled={insuranceAmt <= 0}>−</button>
                  <span className="ins-amt">${insuranceAmt}</span>
                  <button className="sb-btn"
                    onClick={() => setInsuranceAmt(a => Math.min(maxInsurance, a + 5))}
                    disabled={insuranceAmt >= maxInsurance}>+</button>
                  <button className="btn-ghost dock-btn"
                    onClick={() => { send({ type: 'set_insurance', amount: 0 }); setInsuranceAmt(0); }}>
                    No
                  </button>
                  <button className="btn-ready dock-btn" disabled={insuranceAmt === 0}
                    onClick={() => { send({ type: 'set_insurance', amount: insuranceAmt }); setInsuranceAmt(0); }}>
                    Insure ${insuranceAmt}
                  </button>
                </div>
              </div>
            )}

            {phase === 'insurance' && !insurancePending && (
              <p className="dock-status">{me?.insurance_done ? 'Waiting for others…' : 'Dealer shows Ace'}</p>
            )}

            {/* Result */}
            {phase === 'result' && (
              isHost
                ? <button className="btn-deal dock-btn" onClick={() => send({ type: 'new_round' })}>New Round</button>
                : <p className="dock-status">Waiting for host to start a new round…</p>
            )}

          </div>

          {/* Center zone: chip rack */}
          <div className="dock-zone dock-center">
            <div className={`chip-rack chip-rack-row${isBetting ? '' : ' chip-rack-dim'}`}>
              {CHIP_DEFS.map(({ value, cls }) => (
                <button key={value}
                  className={`chip ${cls}${selectedChip === value ? ' chip-selected' : ''}`}
                  onClick={() => setSelectedChip(value)}
                  onPointerDown={(e) => {
                    if (!isBetting) return;
                    setSelectedChip(value);
                    dragStateRef.current = {
                      value, cls, startX: e.clientX, startY: e.clientY, active: false,
                    };
                  }}
                  disabled={value > (me?.balance ?? 0) || !isBetting}>
                  <span className="chip-label">${value}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right zone: side bet results + bet total */}
          <div className="dock-zone dock-right">
            {phase === 'result' && me?.side_bet_results && (
              <div className="sidebet-results">
                {me.side_bet_results.perfect_pairs && (
                  <span className={me.side_bet_results.perfect_pairs.win ? 'sb-res-win' : 'sb-res-lose'}>
                    PP: {me.side_bet_results.perfect_pairs.win
                      ? `+$${me.side_bet_results.perfect_pairs.payout} · ${me.side_bet_results.perfect_pairs.label ?? ''}`
                      : `-$${Math.abs(me.side_bet_results.perfect_pairs.payout)}`}
                  </span>
                )}
                {me.side_bet_results.twenty_one_plus_three && (
                  <span className={me.side_bet_results.twenty_one_plus_three.win ? 'sb-res-win' : 'sb-res-lose'}>
                    21+3: {me.side_bet_results.twenty_one_plus_three.win
                      ? `+$${me.side_bet_results.twenty_one_plus_three.payout} · ${me.side_bet_results.twenty_one_plus_three.label ?? ''}`
                      : `-$${Math.abs(me.side_bet_results.twenty_one_plus_three.payout)}`}
                  </span>
                )}
                {me.side_bet_results.insurance && (
                  <span className={me.side_bet_results.insurance.win ? 'sb-res-win' : 'sb-res-lose'}>
                    Insurance: {me.side_bet_results.insurance.win
                      ? `+$${me.side_bet_results.insurance.payout}`
                      : `-$${Math.abs(me.side_bet_results.insurance.payout)}`}
                  </span>
                )}
              </div>
            )}

            {isBetting && (me?.current_bet ?? 0) > 0 && (
              <div className="dock-bet-info">
                <span className="dock-bet-lbl">Bet</span>
                <span className="dock-bet-amt">${me?.current_bet ?? 0}</span>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Drag ghost chip */}
      {dragChip && (
        <div
          className={`chip ${dragChip.cls} chip-ghost`}
          style={{ left: dragPos.x, top: dragPos.y }}
        >
          <span className="chip-label">${dragChip.value}</span>
        </div>
      )}

    </div>
  );
}
