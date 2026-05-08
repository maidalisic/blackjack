import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface RoomSummary {
  room_id: string;
  phase: string;
  player_count: number;
  max_players: number;
  starting_balance: number;
  spectator_count: number;
  players: { name: string; balance: number; status: string }[];
}

const PHASE_LABEL: Record<string, string> = {
  waiting: 'Waiting',
  betting: 'Betting',
  insurance: 'Insurance',
  playing: 'Playing',
  result: 'Result',
};

const PHASE_COLOR: Record<string, string> = {
  waiting: '#7a8aa8',
  betting: '#facc15',
  insurance: '#fb923c',
  playing: '#4ade80',
  result: '#c9a84c',
};

const STATUS_COLOR: Record<string, string> = {
  betting: '#facc15',
  waiting_turn: '#7a8aa8',
  playing: '#4ade80',
  done: '#374151',
  result: '#c9a84c',
};

export default function Admin() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/rooms');
        const data = await res.json();
        setRooms(data.rooms ?? []);
        setLastUpdate(new Date());
      } catch {
        // backend not reachable — keep last state
      } finally {
        setLoading(false);
      }
    };
    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{
      minHeight: '100svh',
      background: 'var(--bg)',
      color: 'var(--white)',
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      padding: '28px 32px',
    }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
            <h1 style={{
              fontSize: 18, fontWeight: 800, letterSpacing: 5,
              color: 'var(--gold)', textShadow: '0 0 30px var(--gold-glow)',
            }}>♠ ADMIN PANEL</h1>
            <p style={{ fontSize: 11, color: 'var(--text)', marginTop: 5, letterSpacing: 0.3 }}>
              {rooms.length} active room{rooms.length !== 1 ? 's' : ''}
              {' · '}updated {lastUpdate.toLocaleTimeString()}
            </p>
          </div>
          <button
            className="btn-ghost"
            style={{ padding: '9px 16px', fontSize: 13 }}
            onClick={() => navigate('/')}
          >
            ← Lobby
          </button>
        </div>

        {loading && (
          <p style={{ textAlign: 'center', color: 'var(--text)', fontSize: 13 }}>Loading…</p>
        )}

        {!loading && rooms.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '60px 0',
            border: '1px dashed rgba(255,255,255,0.07)', borderRadius: 14,
            color: 'var(--text)', fontSize: 14,
          }}>
            No active rooms
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {rooms.map(room => {
            const phaseColor = PHASE_COLOR[room.phase] ?? '#7a8aa8';
            return (
              <div key={room.room_id} style={{
                background: '#0e1628',
                border: '1px solid rgba(201,168,76,0.14)',
                borderRadius: 16,
                padding: '18px 22px',
                display: 'flex',
                gap: 18,
                alignItems: 'flex-start',
              }}>

                {/* Left column */}
                <div style={{ flex: 1, minWidth: 0 }}>

                  {/* Top row: code + phase badge + player count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 22, fontWeight: 900, letterSpacing: 5,
                      color: 'var(--gold)', textShadow: '0 0 16px var(--gold-glow)',
                    }}>
                      {room.room_id}
                    </span>

                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
                      background: `${phaseColor}1a`,
                      color: phaseColor,
                      border: `1px solid ${phaseColor}44`,
                      textTransform: 'uppercase', letterSpacing: 1.2,
                    }}>
                      {PHASE_LABEL[room.phase] ?? room.phase}
                    </span>

                    <span style={{ fontSize: 11, color: 'var(--text)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                      {room.player_count}/{room.max_players} players
                      {' · '}${room.starting_balance.toLocaleString()} start
                      {room.spectator_count > 0 && ` · ${room.spectator_count} watching`}
                    </span>
                  </div>

                  {/* Player chips */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {room.players.map((p, i) => (
                      <div key={i} style={{
                        padding: '6px 12px', borderRadius: 9,
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        display: 'flex', flexDirection: 'column', gap: 2,
                      }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--white)' }}>{p.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--gold)' }}>${p.balance.toLocaleString()}</span>
                          <span style={{
                            fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                            color: STATUS_COLOR[p.status] ?? 'var(--text)',
                          }}>
                            {p.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                </div>

                {/* Watch button */}
                <button
                  className="btn-deal"
                  style={{ flex: 'none', width: 'auto', padding: '11px 22px', fontSize: 13 }}
                  onClick={() => navigate(`/spectate/${room.room_id}`)}
                >
                  Watch
                </button>

              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
