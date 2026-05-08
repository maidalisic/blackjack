import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import HandView from '../components/HandView';
import type { RoomState } from '../types';

function getWsUrl(roomId: string) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host =
    import.meta.env.DEV &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'
      ? `${window.location.hostname}:8001`
      : window.location.host;
  return `${proto}//${host}/ws/spectate`;
}

// All 7 player slots spread around the oval arc (top → bottom)
const PLAYER_SLOTS = [
  { top: 18, left: 50 },  // back-center
  { top: 22, left: 72 },  // back-right
  { top: 22, left: 28 },  // back-left
  { top: 46, left: 84 },  // mid-right
  { top: 46, left: 16 },  // mid-left
  { top: 70, left: 68 },  // near-right
  { top: 70, left: 32 },  // near-left
];

const SLOT_DIST: Record<number, number[]> = {
  1: [0],
  2: [5, 6],
  3: [5, 0, 6],
  4: [5, 3, 4, 6],
  5: [5, 3, 0, 4, 6],
  6: [5, 3, 1, 2, 4, 6],
  7: [5, 3, 1, 0, 2, 4, 6],
};

const PHASE_LABEL: Record<string, string> = {
  waiting: 'Waiting',
  betting: 'Betting',
  insurance: 'Insurance',
  playing: 'Playing',
  result: 'Result',
};

export default function Spectate() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const [statusMsg, setStatusMsg] = useState('Connecting…');

  useEffect(() => {
    const ws = new WebSocket(getWsUrl(roomId ?? ''));
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'spectate_room', room_id: roomId }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'spectate_joined' || msg.type === 'game_update') {
        if (msg.state) setState(msg.state);
        setStatusMsg('');
      } else if (msg.type === 'error') {
        setStatusMsg(msg.message ?? 'Error');
      }
    };
    ws.onclose = () => setStatusMsg('Disconnected.');
    ws.onerror = () => setStatusMsg('Could not connect.');

    return () => ws.close();
  }, [roomId]);

  if (statusMsg || !state) {
    return (
      <div className="lobby">
        <div className="lobby-card">
          <h1 className="lobby-title">♠ BLACKJACK ♦</h1>
          <p className="lobby-sub">{statusMsg || 'Connecting…'}</p>
          <button className="btn-ghost" style={{ marginTop: 24 }} onClick={() => navigate('/admin')}>
            ← Admin
          </button>
        </div>
      </div>
    );
  }

  const { phase, players, player_order, dealer_hand, host_id, active_player_id, message } = state;
  const count = Math.min(player_order.length, 7);
  const slotIndices = SLOT_DIST[count] ?? [];

  return (
    <div className="app">

      {/* SVG felt noise */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="hdr-title">♠ {state.room_id}</span>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase',
            padding: '3px 10px', borderRadius: 5,
            background: 'rgba(201,168,76,0.12)', color: 'var(--gold)',
            border: '1px solid rgba(201,168,76,0.28)',
          }}>
            Spectating
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase',
            color: 'var(--text)',
          }}>
            {PHASE_LABEL[phase] ?? phase}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text)' }}>
            {player_order.length} player{player_order.length !== 1 ? 's' : ''}
          </span>
          <button
            className="btn-ghost leave-btn"
            onClick={() => navigate('/admin')}
            title="Back to admin"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="game-body">
        <div className="table-wrap">
          <div className="table-rim">
            <div className="casino-table">

              {/* Dealer */}
              <div className="ct-dealer">
                <span className="felt-zone-lbl">DEALER</span>
                {dealer_hand.length > 0
                  ? <HandView cards={dealer_hand} />
                  : <div className="ct-dealer-empty" />
                }
              </div>

              {/* Center: rules + game message */}
              <div className="ct-info">
                <span className="ct-rule-main">BLACKJACK PAYS 3 TO 2</span>
                <span className="ct-rule-sub">DEALER STANDS ON ALL 17s</span>
                {message && (
                  <div className={`ct-msg${phase === 'result' ? ' ct-msg-result' : ''}`}>
                    {message}
                  </div>
                )}
              </div>

              {/* All players arranged around the arc */}
              {player_order.map((pid, i) => {
                const slot = PLAYER_SLOTS[slotIndices[i]];
                if (!slot || !players[pid]) return null;
                const p = players[pid];
                const isActive = active_player_id === pid;
                const hasCards = (p.player_hands[0]?.cards.length ?? 0) > 0;
                const bet = hasCards
                  ? (p.player_hands[0]?.bet ?? p.current_bet)
                  : p.current_bet;

                return (
                  <div
                    key={pid}
                    className={`opp-seat${isActive ? ' opp-seat-active' : ''}`}
                    style={{
                      position: 'absolute',
                      top: `${slot.top}%`,
                      left: `${slot.left}%`,
                      transform: 'translate(-50%, 0)',
                    }}
                  >
                    <div className="opp-name-tag">
                      {host_id === pid && <span className="badge-host">HOST</span>}
                      <span>{p.name}</span>
                      {isActive && <span className="turn-dot" />}
                    </div>
                    <span className="opp-bal">${p.balance.toLocaleString()}</span>

                    {hasCards && (
                      <div className="opp-cards">
                        {p.player_hands.map((hand, hi) => (
                          <HandView
                            key={hi}
                            cards={hand.cards}
                            active={isActive && hi === p.active_hand_index}
                            result={phase === 'result' ? (hand.result ?? undefined) : undefined}
                          />
                        ))}
                      </div>
                    )}

                    <div className="opp-bet-row">
                      {p.side_bets.perfect_pairs > 0 && (
                        <span className="opp-sb-dot">PP</span>
                      )}
                      <div className={`opp-bet-box${bet > 0 ? ' obb-active' : ''}`}>
                        {bet > 0
                          ? <span>${bet.toLocaleString()}</span>
                          : <span className="obb-empty">BET</span>
                        }
                      </div>
                      {p.side_bets.twenty_one_plus_three > 0 && (
                        <span className="opp-sb-dot">21+3</span>
                      )}
                    </div>
                  </div>
                );
              })}

            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
