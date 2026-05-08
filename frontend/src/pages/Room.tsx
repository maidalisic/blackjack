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
const CHIP_ROTS = [-8, 5, -13, 3, 11, -5, 9];

interface ChatMsg { player_name: string; player_id: string; text: string; ts: number; }

function getWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (import.meta.env.DEV && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
    return `${proto}//${window.location.hostname}:8001/ws`;
  return `${proto}//${window.location.host}/ws`;
}

// ── Timer bar ─────────────────────────────────────────────────────────────────

function TimerBar({ startedAt }: { startedAt: number }) {
  const [pct, setPct] = useState(100);
  const [secs, setSecs] = useState(BETTING_DURATION);
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, BETTING_DURATION - (Date.now() / 1000 - startedAt));
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

// ── Opponent slots ────────────────────────────────────────────────────────────

const OPP_SLOTS = [
  { top: 70, left: 68 },
  { top: 70, left: 32 },
  { top: 46, left: 84 },
  { top: 46, left: 16 },
  { top: 18, left: 68 },
  { top: 18, left: 32 },
];

const OPP_DIST: Record<number, number[]> = {
  1: [4],
  2: [4, 5],
  3: [0, 4, 1],
  4: [0, 2, 3, 1],
  5: [0, 2, 4, 5, 3],
  6: [0, 2, 4, 5, 3, 1],
};

// ── Table chip stack ──────────────────────────────────────────────────────────

function TableChipStack({ amount, chipSize = 36 }: { amount: number; chipSize?: number }) {
  if (!amount) return null;
  const chips: string[] = [];
  let rem = amount;
  for (const { value, cls } of CHIP_DEFS) {
    while (rem >= value && chips.length < 7) { chips.push(cls); rem -= value; }
  }
  const step = Math.max(6, Math.round(chipSize * 0.25));
  const totalH = chipSize + (chips.length - 1) * step;
  return (
    <div style={{ position: 'relative', width: chipSize, height: totalH, flexShrink: 0 }}>
      {chips.map((cls, i) => (
        <div key={i} style={{ position: 'absolute', bottom: i * step, left: 0, width: chipSize, height: chipSize, transform: `rotate(${CHIP_ROTS[i % 7]}deg)` }}>
          <div className={`tcs-disc ${cls}`} style={{ width: chipSize, height: chipSize, animationDelay: `${i * 55}ms` }} />
        </div>
      ))}
    </div>
  );
}

// ── Result helpers ────────────────────────────────────────────────────────────

function resultCls(r: HandResult | null | undefined): string {
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

function BettingBox({ amount, onClick, interactive, result, isDragActive, isDropOver }: {
  amount: number; onClick?: () => void; interactive?: boolean;
  result?: HandResult | null; isDragActive?: boolean; isDropOver?: boolean;
}) {
  const active = amount > 0;
  return (
    <div
      className={['betting-box', active ? 'bb-active' : '', interactive ? 'bb-interactive' : '', resultCls(result), isDragActive ? 'drop-ready' : '', isDropOver ? 'drop-over' : ''].filter(Boolean).join(' ')}
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
          <span className="bb-empty">{isDropOver ? 'DROP' : interactive ? 'CLICK' : ''}</span>
        )}
      </div>
      {result && <PayoutLabel result={result} bet={amount} />}
    </div>
  );
}

// ── Side bet zone ─────────────────────────────────────────────────────────────

function SideBetZone({ label, paysText, amount, onClick, interactive, sbResult, isDragActive, isDropOver }: {
  label: string; paysText: string; amount: number; onClick?: () => void;
  interactive?: boolean; sbResult?: SideBetEntry | null;
  isDragActive?: boolean; isDropOver?: boolean;
}) {
  const active = amount > 0;
  const hasResult = !!sbResult;
  const won = sbResult?.win;
  return (
    <div
      className={['sidebet-zone', active ? 'sbz-active' : '', interactive ? 'sbz-interactive' : '', hasResult ? (won ? 'sbz-win' : 'sbz-lose') : '', isDragActive ? 'drop-ready' : '', isDropOver ? 'drop-over' : ''].filter(Boolean).join(' ')}
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

function OpponentSeat({ player, isActive, isHost, phase, top, left }: {
  player: PlayerState; isActive: boolean; isHost: boolean; phase: string; top: number; left: number;
}) {
  const hasCards = player.player_hands[0]?.cards.length > 0;
  const dispBet = hasCards ? (player.player_hands[0]?.bet ?? player.current_bet) : player.current_bet;
  const oppResult = phase === 'result' ? (player.player_hands[0]?.result ?? null) : null;
  return (
    <div className={`opp-seat${isActive ? ' opp-seat-active' : ''}`}
      style={{ position: 'absolute', top: `${top}%`, left: `${left}%`, transform: 'translate(-50%, 0)' }}>
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
              result={phase === 'result' ? (hand.result ?? undefined) : undefined} />
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
  const locState = location.state as { action?: string; playerName?: string; maxPlayers?: number; startingBalance?: number; } | null;

  const wsRef = useRef<WebSocket | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<RoomState | null>(null);
  const [statusMsg, setStatusMsg] = useState('Connecting…');
  const [copyMsg, setCopyMsg] = useState('');
  const [insuranceAmt, setInsuranceAmt] = useState(0);
  const [selectedChip, setSelectedChip] = useState(25);
  const [roomClosed, setRoomClosed] = useState(false);
  const [wasKicked, setWasKicked] = useState(false);

  // Drag state
  const [dragChip, setDragChip] = useState<{ value: number; cls: string } | null>(null);
  const [dragPos, setDragPos]   = useState({ x: 0, y: 0 });
  const [dragOverZone, setDragOverZone] = useState<string | null>(null);
  const dragStateRef = useRef<{ value: number; cls: string; startX: number; startY: number; active: boolean; } | null>(null);
  const meRef        = useRef<PlayerState | undefined>(undefined);
  const isBettingRef = useRef(false);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const chatOpenRef  = useRef(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Stats & last bet
  const [stats, setStats] = useState({ won: 0, lost: 0, pushed: 0 });
  const lastBetRef   = useRef(0);
  const prevPhaseRef = useRef('');

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);

  const toggleChat = useCallback(() => {
    const next = !chatOpenRef.current;
    chatOpenRef.current = next;
    setChatOpen(next);
    if (next) setUnreadChat(0);
  }, []);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text) return;
    send({ type: 'chat', text });
    setChatInput('');
  }, [chatInput, send]);

  // WebSocket setup
  useEffect(() => {
    const playerName = locState?.playerName ?? sessionStorage.getItem('playerName') ?? 'Player';
    sessionStorage.setItem('playerName', playerName);
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    ws.onopen = () => {
      if (locState?.action === 'create' || (!roomId && !locState?.action))
        ws.send(JSON.stringify({ type: 'create_room', player_name: playerName, max_players: locState?.maxPlayers ?? 5, starting_balance: locState?.startingBalance ?? 10_000 }));
      else
        ws.send(JSON.stringify({ type: 'join_room', room_id: roomId ?? '', player_name: playerName }));
    };
    ws.onmessage = (e) => {
      const msg: WsMessage & { player_name?: string; text?: string; ts?: number } = JSON.parse(e.data);
      if (msg.type === 'room_created' || msg.type === 'room_joined') {
        setMyId(msg.your_id ?? null);
        if (msg.state) setGameState(msg.state);
        if (msg.type === 'room_created' && msg.room_id)
          window.history.replaceState({}, '', `/room/${msg.room_id}`);
        setStatusMsg('');
      } else if (msg.type === 'game_update') {
        setMyId(prev => prev ?? msg.your_id ?? null);
        if (msg.state) setGameState(msg.state);
      } else if (msg.type === 'room_closed') {
        setRoomClosed(true);
      } else if (msg.type === 'kicked') {
        setWasKicked(true);
      } else if (msg.type === 'chat') {
        const cm: ChatMsg = { player_name: msg.player_name ?? '?', player_id: msg.player_id ?? '', text: msg.text ?? '', ts: msg.ts ?? Date.now() / 1000 };
        setChatMessages(prev => [...prev.slice(-99), cm]);
        if (!chatOpenRef.current) setUnreadChat(n => n + 1);
      } else if (msg.type === 'error') {
        setStatusMsg(msg.message ?? 'Error');
      }
    };
    ws.onclose = () => setStatusMsg('Disconnected.');
    ws.onerror  = () => setStatusMsg('Could not connect.');
    return () => ws.close();
  }, []);

  // Drag events
  useEffect(() => {
    const getZone = (x: number, y: number): string | null => {
      let node: Element | null = document.elementFromPoint(x, y);
      while (node) { const z = (node as HTMLElement).dataset?.zone; if (z) return z; node = node.parentElement; }
      return null;
    };
    const onMove = (e: PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      if (!ds.active && Math.hypot(e.clientX - ds.startX, e.clientY - ds.startY) > 8) { ds.active = true; setDragChip({ value: ds.value, cls: ds.cls }); }
      if (ds.active) { setDragPos({ x: e.clientX, y: e.clientY }); setDragOverZone(getZone(e.clientX, e.clientY)); }
    };
    const onUp = (e: PointerEvent) => {
      const ds = dragStateRef.current;
      if (ds?.active) {
        const zone = getZone(e.clientX, e.clientY);
        const m = meRef.current;
        if (zone && isBettingRef.current && m) {
          const v = ds.value;
          const totalSB = m.side_bets.perfect_pairs + m.side_bets.twenty_one_plus_three;
          if (zone === 'main') send({ type: 'place_bet', amount: Math.min(m.current_bet + v, Math.max(0, m.balance - totalSB)) });
          else if (zone === 'pp') { const mx = Math.min(1000, m.balance - m.current_bet - m.side_bets.twenty_one_plus_three); if (v <= mx) send({ type: 'place_side_bet', bet_type: 'perfect_pairs', amount: m.side_bets.perfect_pairs + v }); }
          else if (zone === '21p3') { const mx = Math.min(1000, m.balance - m.current_bet - m.side_bets.perfect_pairs); if (v <= mx) send({ type: 'place_side_bet', bet_type: 'twenty_one_plus_three', amount: m.side_bets.twenty_one_plus_three + v }); }
        }
      }
      dragStateRef.current = null; setDragChip(null); setDragOverZone(null);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
  }, [send]);

  // Stats + last bet tracking
  useEffect(() => {
    if (!gameState || !myId) return;
    if (gameState.phase === 'result' && prevPhaseRef.current !== 'result') {
      const me = gameState.players[myId];
      if (me) {
        let won = 0, lost = 0, pushed = 0;
        for (const hand of me.player_hands) {
          if (hand.result === 'win' || hand.result === 'blackjack') won++;
          else if (hand.result === 'lose' || hand.result === 'bust') lost++;
          else if (hand.result === 'push') pushed++;
        }
        if (won + lost + pushed > 0) setStats(s => ({ won: s.won + won, lost: s.lost + lost, pushed: s.pushed + pushed }));
        if (me.current_bet > 0) lastBetRef.current = me.current_bet;
      }
    }
    prevPhaseRef.current = gameState.phase;
  }, [gameState?.phase, myId]);

  // Chat auto-scroll
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── Room closed ───────────────────────────────────────────────────────────

  if (wasKicked) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1 className="lobby-title">♠ BLACKJACK ♦</h1>
          <p className="lobby-sub">You were removed from the room by the admin.</p>
          <button className="btn-ghost" style={{ marginTop: 20 }} onClick={() => navigate('/')}>← Lobby</button>
        </div>
      </div>
    );
  }

  if (roomClosed) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1 className="lobby-title">♠ BLACKJACK ♦</h1>
          <p className="lobby-sub">Room was closed by admin.</p>
          <button className="btn-ghost" style={{ marginTop: 20 }} onClick={() => navigate('/')}>← Lobby</button>
        </div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────

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
  const totalHands      = stats.won + stats.lost + stats.pushed;

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
            <button className="btn-ghost room-copy-btn" onClick={() => { navigator.clipboard.writeText(window.location.href); setCopyMsg('Copied!'); setTimeout(() => setCopyMsg(''), 2000); }}>{copyMsg || 'Copy Link'}</button>
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

  const oppCount    = Math.min(otherIds.length, 6);
  const slotIndices = OPP_DIST[oppCount] ?? [];

  // ── Game table ─────────────────────────────────────────────────────────────

  return (
    <div className="app">

      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="felt-noise" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.75 0.75" numOctaves="4" seed="3" stitchTiles="stitch" result="noise" />
            <feColorMatrix type="saturate" values="0" in="noise" result="gray" />
            <feBlend in="SourceGraphic" in2="gray" mode="multiply" result="blended" />
            <feComposite in="blended" in2="SourceGraphic" operator="in" />
          </filter>
        </defs>
      </svg>

      {/* Header */}
      <header className="hdr">
        <span className="hdr-title">♠ BLACKJACK ♦</span>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {totalHands > 0 && (
            <div className="hdr-stats">
              <span className="hdr-stat-win">W {stats.won}</span>
              <span className="hdr-stat-sep">·</span>
              <span className="hdr-stat-lose">L {stats.lost}</span>
              {stats.pushed > 0 && <><span className="hdr-stat-sep">·</span><span className="hdr-stat-push">P {stats.pushed}</span></>}
            </div>
          )}
          <div className="hdr-bal">
            <span className="hdr-bal-lbl">Balance</span>
            <span className="hdr-bal-amt">${(me?.balance ?? 0).toLocaleString()}</span>
          </div>
          <div className="hdr-bal">
            <span className="hdr-bal-lbl">Room</span>
            <span className="hdr-bal-amt" style={{ fontSize: 13, letterSpacing: 3 }}>{gameState.room_id}</span>
          </div>
          <button className="chat-toggle-btn" onClick={toggleChat} title="Chat">
            💬
            {unreadChat > 0 && <span className="chat-badge">{unreadChat > 9 ? '9+' : unreadChat}</span>}
          </button>
          <button className="btn-ghost leave-btn" onClick={() => { send({ type: 'leave_room' }); navigate('/'); }} title="Leave">✕</button>
        </div>
      </header>

      <div className="game-body">

        <div className="table-wrap">
          <div className="table-rim">
            <div className="casino-table">

              <div className="ct-dealer">
                <span className="felt-zone-lbl">DEALER</span>
                {dealer_hand.length > 0 ? <HandView cards={dealer_hand} /> : <div className="ct-dealer-empty" />}
              </div>

              <div className="ct-info">
                <span className="ct-rule-main">BLACKJACK PAYS 3 TO 2</span>
                <span className="ct-rule-sub">DEALER STANDS ON ALL 17s</span>
                {message && <div className={`ct-msg${phase === 'result' ? ' ct-msg-result' : ''}`}>{message}</div>}
                {phase === 'betting' && gameState.betting_started_at > 0 && <TimerBar startedAt={gameState.betting_started_at} />}
              </div>

              {otherIds.map((pid, i) => {
                const slot = OPP_SLOTS[slotIndices[i]];
                if (!slot || !players[pid]) return null;
                return <OpponentSeat key={pid} player={players[pid]} isActive={active_player_id === pid} isHost={host_id === pid} phase={phase} top={slot.top} left={slot.left} />;
              })}

              {/* ── Center table actions ── */}
              {me && (
                <div className="ct-actions">
                  {isBetting && !myHasCards && (
                    <div className="table-action-btns">
                      {lastBetRef.current > 0 && lastBetRef.current <= maxMainBet && (me.current_bet ?? 0) !== lastBetRef.current && (
                        <button className="tbl-btn tbl-btn-rebet" onClick={() => send({ type: 'place_bet', amount: lastBetRef.current })}>
                          <span className="tbl-btn-icon">↺</span>
                          <div className="tbl-btn-body">
                            <span className="tbl-btn-label">Repeat Bet</span>
                            <span className="tbl-btn-amt">${lastBetRef.current.toLocaleString()}</span>
                          </div>
                        </button>
                      )}
                      <button className="tbl-btn tbl-btn-ready" onClick={() => send({ type: 'set_ready' })} disabled={(me.current_bet ?? 0) === 0}>
                        <span className="tbl-btn-icon">✓</span>
                        <span className="tbl-btn-label">Ready</span>
                      </button>
                      {isHost && (
                        <button className="tbl-btn tbl-btn-deal" onClick={() => send({ type: 'deal' })} disabled={(me.current_bet ?? 0) === 0}>
                          <span className="tbl-btn-icon">♠</span>
                          <span className="tbl-btn-label">Deal</span>
                        </button>
                      )}
                    </div>
                  )}

                  {canAct && (
                    <div className="table-action-btns">
                      <button className="tbl-btn tbl-btn-hit" onClick={() => send({ type: 'hit' })}>
                        <span className="tbl-btn-icon">+</span><span className="tbl-btn-label">Hit</span>
                      </button>
                      <button className="tbl-btn tbl-btn-stand" onClick={() => send({ type: 'stand' })}>
                        <span className="tbl-btn-icon">✋</span><span className="tbl-btn-label">Stand</span>
                      </button>
                      {canDoubleShow && (
                        <button className="tbl-btn tbl-btn-double" disabled={!canDoubleActive} onClick={() => send({ type: 'double' })}>
                          <span className="tbl-btn-icon">×2</span><span className="tbl-btn-label">Double</span>
                        </button>
                      )}
                      {canSplitShow && (
                        <button className="tbl-btn tbl-btn-split" disabled={!canSplitActive} onClick={() => send({ type: 'split' })}>
                          <span className="tbl-btn-icon">⇌</span><span className="tbl-btn-label">Split</span>
                        </button>
                      )}
                    </div>
                  )}

                  {insurancePending && (
                    <div className="table-insurance">
                      <p className="ins-tbl-hdr">Insurance? <span className="ins-tbl-max">max ${maxInsurance}</span></p>
                      <div className="ins-tbl-stepper">
                        <button className="ins-step-btn" onClick={() => setInsuranceAmt(a => Math.max(0, a - 5))} disabled={insuranceAmt <= 0}>−</button>
                        <span className="ins-tbl-amt">${insuranceAmt}</span>
                        <button className="ins-step-btn" onClick={() => setInsuranceAmt(a => Math.min(maxInsurance, a + 5))} disabled={insuranceAmt >= maxInsurance}>+</button>
                      </div>
                      <div className="table-action-btns">
                        <button className="tbl-btn tbl-btn-stand" onClick={() => { send({ type: 'set_insurance', amount: 0 }); setInsuranceAmt(0); }}>
                          <span className="tbl-btn-label">Skip</span>
                        </button>
                        <button className="tbl-btn tbl-btn-rebet" disabled={insuranceAmt === 0} onClick={() => { send({ type: 'set_insurance', amount: insuranceAmt }); setInsuranceAmt(0); }}>
                          <div className="tbl-btn-body">
                            <span className="tbl-btn-label">Insure</span>
                            <span className="tbl-btn-amt">${insuranceAmt}</span>
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="my-seat">
                {me && (
                  <div className="my-table-area">

                    {myHasCards && (
                      <div className="my-hands-row">
                        {me.player_hands.map((hand, i) => {
                          const isSplit = me.player_hands.length > 1;
                          const isActiveHand = canAct && i === me.active_hand_index;
                          return (
                            <div key={i} className={['my-hand-bet-group', isSplit ? 'split-group' : '', isSplit && isActiveHand ? 'split-group-active' : ''].filter(Boolean).join(' ')}>
                              <HandView cards={hand.cards} label={isSplit ? `H${i + 1}` : undefined} active={isActiveHand} result={phase === 'result' ? (hand.result ?? undefined) : undefined} />
                              {isSplit && <BettingBox amount={hand.bet} result={phase === 'result' ? (hand.result ?? null) : null} />}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="my-betting-row">
                      <div data-zone="pp">
                        <SideBetZone label="PP" paysText="35:1" amount={me.side_bets.perfect_pairs} onClick={() => handleSideBet('perfect_pairs')} interactive={isBetting} sbResult={phase === 'result' ? me.side_bet_results.perfect_pairs : null} isDragActive={isBetting && isDragging} isDropOver={dragOverZone === 'pp'} />
                      </div>
                      <div className="my-main-bets">
                        {myHasCards
                          ? (me.player_hands.length === 1
                              ? <BettingBox amount={me.player_hands[0].bet} result={phase === 'result' ? (me.player_hands[0].result ?? null) : null} />
                              : null)
                          : <div data-zone="main">
                              <BettingBox amount={me.current_bet} onClick={handleMainBet} interactive={isBetting} result={null} isDragActive={isBetting && isDragging} isDropOver={dragOverZone === 'main'} />
                            </div>
                        }
                      </div>
                      <div data-zone="21p3">
                        <SideBetZone label="21+3" paysText="9:1" amount={me.side_bets.twenty_one_plus_three} onClick={() => handleSideBet('twenty_one_plus_three')} interactive={isBetting} sbResult={phase === 'result' ? me.side_bet_results.twenty_one_plus_three : null} isDragActive={isBetting && isDragging} isDropOver={dragOverZone === '21p3'} />
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

        {/* Chip dock */}
        <div className="chip-dock">

          <div className="dock-zone dock-left">

            {isBetting && (
              <button className="btn-ghost dock-btn"
                onClick={() => { send({ type: 'place_bet', amount: 0 }); send({ type: 'place_side_bet', bet_type: 'perfect_pairs', amount: 0 }); send({ type: 'place_side_bet', bet_type: 'twenty_one_plus_three', amount: 0 }); }}
                disabled={(me?.current_bet ?? 0) === 0 && totalSideBets === 0}>
                Clear
              </button>
            )}

            {phase === 'betting' && me?.ready && (
              <p className="dock-status">✓ Ready — {player_order.filter(pid => !players[pid]?.ready).length} waiting</p>
            )}

            {phase === 'playing' && !isMyTurn && (
              <p className="dock-status">{active_player_id ? `${players[active_player_id]?.name ?? '…'}'s turn` : 'Dealer is playing…'}</p>
            )}

            {phase === 'insurance' && !insurancePending && (
              <p className="dock-status">{me?.insurance_done ? 'Waiting for others…' : 'Dealer shows Ace'}</p>
            )}

            {me?.status === 'spectating' && (
              <p className="dock-status dock-spectating">You're out of chips — watching this round</p>
            )}

            {phase === 'result' && me?.status !== 'spectating' && (
              isHost
                ? <button className="btn-deal dock-btn" onClick={() => send({ type: 'new_round' })}>New Round</button>
                : <p className="dock-status">Waiting for host to start a new round…</p>
            )}

          </div>

          <div className="dock-zone dock-center">
            <div className={`chip-rack chip-rack-row${isBetting ? '' : ' chip-rack-dim'}`}>
              {CHIP_DEFS.map(({ value, cls }) => (
                <button key={value}
                  className={`chip ${cls}${selectedChip === value ? ' chip-selected' : ''}`}
                  onClick={() => setSelectedChip(value)}
                  onPointerDown={(e) => {
                    if (!isBetting) return;
                    setSelectedChip(value);
                    dragStateRef.current = { value, cls, startX: e.clientX, startY: e.clientY, active: false };
                  }}
                  disabled={value > (me?.balance ?? 0) || !isBetting}>
                  <span className="chip-label">${value}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="dock-zone dock-right">
            {phase === 'result' && me?.side_bet_results && (
              <div className="sidebet-results">
                {me.side_bet_results.perfect_pairs && (
                  <span className={me.side_bet_results.perfect_pairs.win ? 'sb-res-win' : 'sb-res-lose'}>
                    PP: {me.side_bet_results.perfect_pairs.win ? `+$${me.side_bet_results.perfect_pairs.payout} · ${me.side_bet_results.perfect_pairs.label ?? ''}` : `-$${Math.abs(me.side_bet_results.perfect_pairs.payout)}`}
                  </span>
                )}
                {me.side_bet_results.twenty_one_plus_three && (
                  <span className={me.side_bet_results.twenty_one_plus_three.win ? 'sb-res-win' : 'sb-res-lose'}>
                    21+3: {me.side_bet_results.twenty_one_plus_three.win ? `+$${me.side_bet_results.twenty_one_plus_three.payout} · ${me.side_bet_results.twenty_one_plus_three.label ?? ''}` : `-$${Math.abs(me.side_bet_results.twenty_one_plus_three.payout)}`}
                  </span>
                )}
                {me.side_bet_results.insurance && (
                  <span className={me.side_bet_results.insurance.win ? 'sb-res-win' : 'sb-res-lose'}>
                    Insurance: {me.side_bet_results.insurance.win ? `+$${me.side_bet_results.insurance.payout}` : `-$${Math.abs(me.side_bet_results.insurance.payout)}`}
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

      {/* Chat panel */}
      <div className={`chat-panel${chatOpen ? ' open' : ''}`}>
        <div className="chat-header">
          <span className="chat-header-title">Chat</span>
          <button className="leave-btn" onClick={toggleChat} title="Close">✕</button>
        </div>
        <div className="chat-messages">
          {chatMessages.length === 0 && (
            <p className="chat-empty">No messages yet</p>
          )}
          {chatMessages.map((m, i) => (
            <div key={i} className="chat-msg">
              <span className={`chat-msg-name${m.player_id === myId ? ' is-me' : ''}`}>{m.player_name}</span>
              <div className="chat-msg-text">{m.text}</div>
            </div>
          ))}
          <div ref={chatBottomRef} />
        </div>
        <div className="chat-input-row">
          <input
            className="chat-input"
            placeholder="Type a message…"
            value={chatInput}
            maxLength={200}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
          />
          <button className="btn-ghost" style={{ padding: '7px 12px', fontSize: 14 }} onClick={sendChat}>→</button>
        </div>
      </div>

      {dragChip && (
        <div className={`chip ${dragChip.cls} chip-ghost`} style={{ left: dragPos.x, top: dragPos.y }}>
          <span className="chip-label">${dragChip.value}</span>
        </div>
      )}

    </div>
  );
}
