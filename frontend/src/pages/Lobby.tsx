import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const BALANCE_OPTIONS = [500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000];

export default function Lobby() {
  const navigate = useNavigate();
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [error, setError] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [startingBalance, setStartingBalance] = useState(10_000);

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

  return (
    <div className="lobby">
      <div className="lobby-card">
        <h1 className="lobby-title">♠ BLACKJACK ♦</h1>
        <p className="lobby-sub">Multiplayer · No accounts · No real money</p>

        <div className="lobby-tabs">
          <button
            className={`lobby-tab${tab === 'create' ? ' active' : ''}`}
            onClick={() => setTab('create')}
          >
            Create Room
          </button>
          <button
            className={`lobby-tab${tab === 'join' ? ' active' : ''}`}
            onClick={() => setTab('join')}
          >
            Join Room
          </button>
        </div>

        <form onSubmit={tab === 'create' ? handleCreate : handleJoin} className="lobby-form">
          <label className="lobby-label">
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
            <>
              <label className="lobby-label">
                Max Players
                <select
                  className="lobby-input lobby-select"
                  value={maxPlayers}
                  onChange={e => setMaxPlayers(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 7].map(n => (
                    <option key={n} value={n}>{n} {n === 1 ? 'player' : 'players'}</option>
                  ))}
                </select>
              </label>
              <label className="lobby-label">
                Starting Balance
                <select
                  className="lobby-input lobby-select"
                  value={startingBalance}
                  onChange={e => setStartingBalance(Number(e.target.value))}
                >
                  {BALANCE_OPTIONS.map(v => (
                    <option key={v} value={v}>${v.toLocaleString()}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          {tab === 'join' && (
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
          )}

          {error && <p className="lobby-error">{error}</p>}

          <button className="btn-deal lobby-cta" type="submit">
            {tab === 'create' ? 'Create Room' : 'Join Room'}
          </button>
        </form>
      </div>
    </div>
  );
}
