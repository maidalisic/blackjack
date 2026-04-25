import type { SideBetState, SideBetResult } from '../types';

const SIDEBETS = [
  {
    key: 'perfectPairs' as keyof SideBetState,
    label: 'Perfect Pairs',
    payouts: [
      { name: 'Mixed Pair', mult: '6×' },
      { name: 'Colored Pair', mult: '12×' },
      { name: 'Perfect Pair', mult: '25×' },
    ],
  },
  {
    key: 'twentyOnePlusThree' as keyof SideBetState,
    label: '21 + 3',
    payouts: [
      { name: 'Flush', mult: '5×' },
      { name: 'Straight', mult: '10×' },
      { name: 'Trips', mult: '30×' },
      { name: 'Str. Flush', mult: '40×' },
      { name: 'Suited Trips', mult: '100×' },
    ],
  },
];

interface Props {
  balance: number;
  mainBet: number;
  sideBets: SideBetState;
  sideBetResults: SideBetResult;
  onSet: (bet: keyof SideBetState, amount: number) => void;
  phase: string;
}

export default function SideBetsPanel({ balance, mainBet, sideBets, sideBetResults, onSet, phase }: Props) {
  const isBetting = phase === 'betting';
  const isResult = phase === 'result';
  const otherSideBets = (k: keyof SideBetState) =>
    Object.entries(sideBets)
      .filter(([key]) => key !== k)
      .reduce((s, [, v]) => s + v, 0);
  const maxFor = (k: keyof SideBetState) =>
    Math.min(balance - mainBet - otherSideBets(k), 100);

  return (
    <div className="sidebets">
      <div className="sidebets-title">Side Bets</div>
      <div className="sidebets-grid">
        {SIDEBETS.map(({ key, label, payouts }) => {
          const result = sideBetResults[key as keyof SideBetResult] as
            | { win: boolean; payout: number; label: string }
            | null;
          const current = sideBets[key];

          return (
            <div
              key={key}
              className={`sidebet-card${current > 0 ? ' sidebet-active' : ''}${isResult && result?.win ? ' sidebet-won' : ''}${isResult && result && !result.win ? ' sidebet-lost' : ''}`}
            >
              <div className="sidebet-header">
                <span className="sidebet-name">{label}</span>
                {isResult && result && (
                  <span className={`sidebet-outcome ${result.win ? 'outcome-win' : 'outcome-lose'}`}>
                    {result.win ? `+$${result.payout}` : `-$${Math.abs(result.payout)}`}
                  </span>
                )}
                {isResult && result && (
                  <span className="sidebet-hit-label">{result.label}</span>
                )}
              </div>
              <div className="sidebet-payouts">
                {payouts.map(p => (
                  <span key={p.name} className="sidebet-payout-item">
                    <span className="payout-name">{p.name}</span>
                    <span className="payout-mult">{p.mult}</span>
                  </span>
                ))}
              </div>
              {isBetting && (
                <div className="sidebet-controls">
                  <button
                    className="sidebet-btn"
                    onClick={() => onSet(key, current - 5)}
                    disabled={current <= 0}
                  >
                    −
                  </button>
                  <span className="sidebet-amount">
                    {current > 0 ? `$${current}` : '—'}
                  </span>
                  <button
                    className="sidebet-btn"
                    onClick={() => onSet(key, current + 5)}
                    disabled={current >= maxFor(key) || maxFor(key) <= 0}
                  >
                    +
                  </button>
                </div>
              )}
              {!isBetting && current > 0 && (
                <div className="sidebet-stake">${current}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
