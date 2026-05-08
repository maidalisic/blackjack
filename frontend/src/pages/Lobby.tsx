import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const BALANCE_OPTIONS = [500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000];
const PHASE_LABEL: Record<string, string> = { waiting: 'Waiting', betting: 'Betting', insurance: 'Insurance', playing: 'In Progress', result: 'Result' };
const PHASE_COLOR: Record<string, string> = { waiting: '#4ade80', betting: '#facc15', insurance: '#fb923c', playing: '#7a8aa8', result: '#c9a84c' };

interface RoomInfo {
  room_id: string;
  phase: string;
  player_count: number;
  max_players: number;
  starting_balance: number;
  players: { name: string }[];
}

export default function Lobby() {
  const navigate = useNavigate();
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [error, setError] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [startingBalance, setStartingBalance] = useState(10_000);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);

  useEffect(() => {
    if (tab !== 'join') return;
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/rooms');
        const data = await res.json();
        if (alive) setRooms(data.rooms ?? []);
      } catch { /* backend unreachable */ }
    };
    poll();
    const iv = setInterval(poll, 2500);
    return () => { alive = false; clearInterval(iv); };
  }, [tab]);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = playerName.trim() || 'Player';
    navigate('/room', { state: { action: 'create', playerName: name, maxPlayers, startingBalance } });
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const code = roomCode.trim().toUpperCase();
    if (!code) { setError('Enter a room code.'); return; }
    const name = playerName.trim() || 'Player';
    navigate(`/room/${code}`, { state: { action: 'join', playerName: name } });
  }

  function joinRoom(roomId: string) {
    const name = playerName.trim() || 'Player';
    navigate(`/room/${roomId}`, { state: { action: 'join', playerName: name } });
  }

  const joinableRooms = rooms.filter(r => r.phase !== 'playing' && r.player_count < r.max_players);
  const otherRooms    = rooms.filter(r => r.phase === 'playing' || r.player_count >= r.max_players);

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="lobby-title">♠ BLACKJACK ♦</h1>
        <p className="lobby-sub">Multiplayer · No accounts · No real money</p>

        <div className="lobby-tabs">
          <button className={`lobby-tab${tab === 'create' ? ' active' : ''}`} onClick={() => setTab('create')}>Create Room</button>
          <button className={`lobby-tab${tab === 'join'   ? ' active' : ''}`} onClick={() => setTab('join')}>Join Room</button>
        </div>

        {/* Name field — shared between tabs */}
        <label className="lobby-label" style={{ marginBottom: 4 }}>
          Your Name
          <input
            className="lobby-input"
            type="text"
            maxLength={20}
            placeholder="e.g. Lucky Luke"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
          />
        </label>

        {tab === 'create' && (
          <form onSubmit={handleCreate} className="lobby-form" style={{ paddingTop: 0 }}>
            <label className="lobby-label">
              Max Players
              <select className="lobby-input lobby-select" value={maxPlayers} onChange={e => setMaxPlayers(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].map(n => (
                  <option key={n} value={n}>{n} {n === 1 ? 'player' : 'players'}</option>
                ))}
              </select>
            </label>
            <label className="lobby-label">
              Starting Balance
              <select className="lobby-input lobby-select" value={startingBalance} onChange={e => setStartingBalance(Number(e.target.value))}>
                {BALANCE_OPTIONS.map(v => <option key={v} value={v}>${v.toLocaleString()}</option>)}
              </select>
            </label>
            <button className="btn-deal lobby-cta" type="submit">Create Room</button>
          </form>
        )}

        {tab === 'join' && (
          <div className="lobby-join-section">

            {/* Manual code entry */}
            <form onSubmit={handleJoin} className="lobby-form" style={{ paddingTop: 0, marginBottom: 0 }}>
              <label className="lobby-label">
                Room Code
                <input
                  className="lobby-input lobby-input-code"
                  type="text"
                  maxLength={6}
                  placeholder="ABC123"
                  value={roomCode}
                  onChange={e => { setRoomCode(e.target.value.toUpperCase()); setError(''); }}
                />
              </label>
              {error && <p className="lobby-error">{error}</p>}
              <button className="btn-deal lobby-cta" type="submit">Join Room</button>
            </form>

            {/* Live room browser */}
            {rooms.length > 0 && (
              <div className="room-browser">
                <p className="room-browser-hdr">Open Rooms</p>

                {joinableRooms.map(room => {
                  const phaseColor = PHASE_COLOR[room.phase] ?? '#7a8aa8';
                  return (
                    <div key={room.room_id} className="room-card">
                      <div className="room-card-left">
                        <div className="room-card-top">
                          <span className="room-card-id">{room.room_id}</span>
                          <span className="room-card-badge" style={{ color: phaseColor, background: `${phaseColor}18`, border: `1px solid ${phaseColor}44` }}>
                            {PHASE_LABEL[room.phase] ?? room.phase}
                          </span>
                          <span className="room-card-slots">{room.player_count}/{room.max_players}</span>
                        </div>
                        <div className="room-card-players">
                          {room.players.map((p, i) => (
                            <span key={i} className="room-card-player">{p.name}</span>
                          ))}
                          {Array.from({ length: room.max_players - room.player_count }).map((_, i) => (
                            <span key={`empty-${i}`} className="room-card-player room-card-player-empty">—</span>
                          ))}
                        </div>
                        <span className="room-card-balance">${room.starting_balance.toLocaleString()} start</span>
                      </div>
                      <button className="room-card-join" onClick={() => joinRoom(room.room_id)}>
                        Join →
                      </button>
                    </div>
                  );
                })}

                {otherRooms.map(room => {
                  const isFull = room.player_count >= room.max_players;
                  return (
                    <div key={room.room_id} className="room-card room-card-dim">
                      <div className="room-card-left">
                        <div className="room-card-top">
                          <span className="room-card-id">{room.room_id}</span>
                          <span className="room-card-badge" style={{ color: '#7a8aa8', background: 'rgba(122,138,168,0.1)', border: '1px solid rgba(122,138,168,0.2)' }}>
                            {isFull ? 'Full' : PHASE_LABEL[room.phase] ?? room.phase}
                          </span>
                          <span className="room-card-slots">{room.player_count}/{room.max_players}</span>
                        </div>
                        <div className="room-card-players">
                          {room.players.map((p, i) => <span key={i} className="room-card-player">{p.name}</span>)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {rooms.length === 0 && (
              <p className="room-browser-empty">No open rooms right now</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
