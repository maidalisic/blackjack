const CHIPS = [5, 10, 25, 50, 100, 500, 1000];

interface Props {
  balance: number;
  currentBet: number;
  onBet: (amount: number) => void;
  onClear: () => void;
  onDeal: () => void;
}

export default function BettingPanel({ balance, currentBet, onBet, onClear, onDeal }: Props) {
  return (
    <div className="betting-panel">
      <div className="bet-display">
        Bet: <span>${currentBet}</span>
      </div>
      <div className="chips">
        {CHIPS.map(c => (
          <button
            key={c}
            className="chip"
            onClick={() => onBet(Math.min(currentBet + c, balance))}
            disabled={currentBet + c > balance && currentBet === 0}
          >
            ${c}
          </button>
        ))}
      </div>
      <div className="bet-actions">
        <button onClick={onClear} className="btn btn-secondary">Clear</button>
        <button onClick={onDeal} className="btn btn-primary" disabled={currentBet < 1}>
          Deal
        </button>
      </div>
    </div>
  );
}
