import { useState } from 'react';
import { useBlackjack } from './useBlackjack';
import { canSplit, canDouble } from './gameLogic';
import HandView from './components/HandView';
import type { SideBetResult } from './types';
import './App.css';

/* ── Chip config ──────────────────────────────────────────── */

const CHIP_DEFS = [
  { value: 1000, cls: 'c-1000' },
  { value: 500,  cls: 'c-500'  },
  { value: 100,  cls: 'c-100'  },
  { value: 50,   cls: 'c-50'   },
  { value: 25,   cls: 'c-25'   },
  { value: 10,   cls: 'c-10'   },
  { value: 5,    cls: 'c-5'    },
];

function betToChips(amount: number, cap = 10) {
  const out: { value: number; cls: string }[] = [];
  let rem = amount;

  for (const d of CHIP_DEFS) {
    while (rem >= d.value && out.length < cap) {
      out.push(d);
      rem -= d.value;
    }
  }

  return out;
}

/* ── Chip stack ──────────────────────────────────────────── */

function ChipStack({
  amount,
  cap = 8,
  size = 38,
}: {
  amount: number;
  cap?: number;
  size?: number;
}) {
  const chips = betToChips(amount, cap);
  if (!chips.length) return null;

  const step = size === 38 ? 6 : 4;
  const totalH = size + (chips.length - 1) * step;

  return (
    <div className="cs" style={{ height: totalH, width: size }}>
      {chips.map((c, i) => (
        <div
          key={i}
          className={`cs-chip ${c.cls}`}
          style={{ width: size, height: size, bottom: i * step }}
        />
      ))}
    </div>
  );
}

/* ── Side-bet oval ────────────────────────────────────────── */

type Zone = 'main' | 'side21' | 'sidePP';

interface SbOvalProps {
  title: string;
  lines: string[];
  paytableHeader?: boolean;
  amount: number;
  maxAmount: number;
  result: SideBetResult['perfectPairs'] | SideBetResult['twentyOnePlusThree'];
  phase: string;
  zone: Zone;
  dragValue: number | null;
  overZone: Zone | null;
  onInc: () => void;
  onDec: () => void;
  onDragOver: (z: Zone) => void;
  onDragLeave: () => void;
  onDrop: (z: Zone, v: number) => void;
}

function SbOval({
  title,
  lines,
  paytableHeader,
  amount,
  maxAmount,
  result,
  phase,
  zone,
  dragValue,
  overZone,
  onInc,
  onDec,
  onDragOver,
  onDragLeave,
  onDrop,
}: SbOvalProps) {
  const isBetting = phase === 'betting';
  const isResult = phase === 'result';
  const isOver = overZone === zone;
  const isDragging = dragValue !== null && isBetting;

  return (
    <div
      className={[
        'sb-oval',
        amount > 0 ? 'sb-has' : '',
        isResult && result?.win ? 'sb-win' : '',
        isResult && result && !result.win ? 'sb-lose' : '',
        isDragging ? 'drop-ready' : '',
        isOver ? 'drop-over' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(zone);
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        const v = Number(e.dataTransfer.getData('text/plain'));
        if (v) onDrop(zone, v);
      }}
    >
      <span className="sb-title">{title}</span>

      <div className="sb-pays">
        {paytableHeader && <span className="sb-pays-header">Paytable</span>}
        {lines.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>

      {amount > 0 && (
        <div className="sb-stack">
          <ChipStack amount={amount} cap={5} size={28} />
          <span className="sb-amt">${amount}</span>
        </div>
      )}

      {isResult && result && (
        <div className={`sb-res ${result.win ? 'sb-res-win' : 'sb-res-lose'}`}>
          {result.win ? (
            <>
              {result.label}
              <br />
              <strong>+${result.payout}</strong>
            </>
          ) : (
            <strong>−${Math.abs(result.payout)}</strong>
          )}
        </div>
      )}

      {isBetting && !isDragging && (
        <div className="sb-ctrl">
          <button className="sb-btn" onClick={onDec} disabled={amount <= 0}>
            −
          </button>
          <button className="sb-btn" onClick={onInc} disabled={amount >= maxAmount}>
            +
          </button>
        </div>
      )}

      {isDragging && <div className="drop-hint">Drop here</div>}
    </div>
  );
}

/* ── App ──────────────────────────────────────────────────── */

export default function App() {
  const {
    state,
    setBet,
    setSideBet,
    deal,
    hit,
    stand,
    double,
    split,
    newRound,
  } = useBlackjack();

  const {
    phase,
    playerHands,
    dealerHand,
    balance,
    currentBet,
    sideBets,
    sideBetResults,
    message,
    activeHandIndex,
  } = state;

  const [dragValue, setDragValue] = useState<number | null>(null);
  const [overZone, setOverZone] = useState<Zone | null>(null);

  const activeHand = playerHands[activeHandIndex];
  const canAct = phase === 'playerTurn';

  const canSplitActive =
    canAct &&
    activeHand &&
    canSplit(activeHand, playerHands.length - 1) &&
    activeHand.bet <= balance;

  const canDoubleActive =
    canAct &&
    activeHand &&
    canDouble(activeHand) &&
    activeHand.bet <= balance;

  const totalSideBets = sideBets.perfectPairs + sideBets.twentyOnePlusThree;

  const maxMainBet = Math.max(0, balance - totalSideBets);
  const maxSidePP = Math.max(0, balance - currentBet - sideBets.twentyOnePlusThree);
  const maxSide21 = Math.max(0, balance - currentBet - sideBets.perfectPairs);

  const addMainBet = (value: number) => {
    setBet(Math.min(currentBet + value, maxMainBet));
  };

  const handleDragStart = (value: number, e: React.DragEvent) => {
    setDragValue(value);
    e.dataTransfer.setData('text/plain', String(value));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragEnd = () => {
    setDragValue(null);
    setOverZone(null);
  };

  const handleDrop = (zone: Zone, value: number) => {
    if (phase !== 'betting') return;

    if (zone === 'main') {
      addMainBet(value);
    }

    if (zone === 'side21') {
      setSideBet(
        'twentyOnePlusThree',
        Math.min(sideBets.twentyOnePlusThree + value, maxSide21)
      );
    }

    if (zone === 'sidePP') {
      setSideBet(
        'perfectPairs',
        Math.min(sideBets.perfectPairs + value, maxSidePP)
      );
    }

    setDragValue(null);
    setOverZone(null);
  };

  const mainBetDropProps =
    phase === 'betting'
      ? {
          onDragOver: (e: React.DragEvent) => {
            e.preventDefault();
            setOverZone('main');
          },
          onDragLeave: () => setOverZone(null),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const v = Number(e.dataTransfer.getData('text/plain'));
            if (v) handleDrop('main', v);
          },
        }
      : {};

  return (
    <div className="app">
      <header className="hdr">
        <span className="hdr-title">♠ BLACKJACK ♦</span>

        <div className="hdr-bal">
          <span className="hdr-bal-lbl">Balance</span>
          <span className="hdr-bal-amt">${balance.toLocaleString()}</span>
        </div>
      </header>

      <div className="table-wrap">
        <div className={`felt${dragValue ? ' felt-dragging' : ''}`}>
          <div className="felt-dealer">
            <span className="felt-zone-lbl">Dealer</span>

            {dealerHand.length > 0 ? (
              <HandView
                cards={dealerHand}
                dealDelay={phase === 'playerTurn' ? 0.95 : 0}
              />
            ) : (
              <div style={{ height: 86 }} />
            )}
          </div>

          <div className="felt-mid">
            <SbOval
              title="21+3"
              lines={['Flush 5×', 'Straight 10×', 'Trips 30×', 'Str.Flush 40×', 'Suited 100×']}
              amount={sideBets.twentyOnePlusThree}
              maxAmount={maxSide21}
              result={sideBetResults.twentyOnePlusThree}
              phase={phase}
              zone="side21"
              dragValue={dragValue}
              overZone={overZone}
              onInc={() =>
                setSideBet(
                  'twentyOnePlusThree',
                  Math.min(sideBets.twentyOnePlusThree + 5, maxSide21)
                )
              }
              onDec={() =>
                setSideBet(
                  'twentyOnePlusThree',
                  Math.max(0, sideBets.twentyOnePlusThree - 5)
                )
              }
              onDragOver={setOverZone}
              onDragLeave={() => setOverZone(null)}
              onDrop={handleDrop}
            />

            <div className="felt-rules">
              <span className="felt-rules-main">BLACKJACK PAYS 3 TO 2</span>
              <span className="felt-rules-sub">DEALER STANDS ON ALL 17S</span>
            </div>

            <SbOval
              title="Perfect Pairs"
              paytableHeader
              lines={['Mixed 8×', 'Coloured 17×', 'Perfect 35×']}
              amount={sideBets.perfectPairs}
              maxAmount={maxSidePP}
              result={sideBetResults.perfectPairs}
              phase={phase}
              zone="sidePP"
              dragValue={dragValue}
              overZone={overZone}
              onInc={() =>
                setSideBet(
                  'perfectPairs',
                  Math.min(sideBets.perfectPairs + 5, maxSidePP)
                )
              }
              onDec={() =>
                setSideBet(
                  'perfectPairs',
                  Math.max(0, sideBets.perfectPairs - 5)
                )
              }
              onDragOver={setOverZone}
              onDragLeave={() => setOverZone(null)}
              onDrop={handleDrop}
            />
          </div>

          <div className={`felt-msg${phase === 'result' ? ' felt-msg-result' : ''}`}>
            {message}
          </div>

          <div className="felt-player">
            {playerHands[0].cards.length > 0 && (
              <div className="player-hands-wrap">
                <div className="player-hands">
                  {playerHands.map((hand, i) => (
                    <HandView
                      key={i}
                      cards={hand.cards}
                      label={playerHands.length > 1 ? `Hand ${i + 1}` : undefined}
                      active={canAct && i === activeHandIndex}
                      result={phase === 'result' ? hand.result ?? undefined : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            <div
              className={[
                'bet-circle',
                currentBet > 0 ? 'bet-circle-active' : '',
                dragValue && phase === 'betting' ? 'drop-ready' : '',
                overZone === 'main' ? 'drop-over' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              {...mainBetDropProps}
            >
              {currentBet > 0 ? (
                <>
                  <ChipStack amount={currentBet} />
                  <span className="bet-circle-amt">${currentBet}</span>
                </>
              ) : (
                <span className="bet-circle-hint">
                  {phase === 'betting' ? 'PLACE BET' : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="controls">
        {phase === 'betting' && (
          <>
            <div className="chip-rack-label">Drag or click chips to place bet</div>

            <div className="chip-rack">
              {CHIP_DEFS.map(({ value, cls }) => (
                <button
                  key={value}
                  className={`chip ${cls}${dragValue === value ? ' chip-dragging' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(value, e)}
                  onDragEnd={handleDragEnd}
                  onClick={() => addMainBet(value)}
                  disabled={currentBet + value > maxMainBet}
                >
                  <span className="chip-label">${value}</span>
                </button>
              ))}
            </div>

            <div className="ctrl-row">
              <button className="btn-ghost" onClick={() => setBet(0)}>
                Clear
              </button>

              <button className="btn-deal" onClick={deal} disabled={currentBet < 1}>
                Deal {currentBet + totalSideBets > 0 && `· $${currentBet + totalSideBets}`}
              </button>
            </div>
          </>
        )}

        {canAct && (
          <div className="action-row">
            <button className="act act-hit" onClick={hit}>
              Hit
            </button>

            <button className="act act-stand" onClick={stand}>
              Stand
            </button>

            {canDoubleActive && (
              <button className="act act-double" onClick={double}>
                Double
              </button>
            )}

            {canSplitActive && (
              <button className="act act-split" onClick={split}>
                Split
              </button>
            )}
          </div>
        )}

        {phase === 'result' && (
          <button className="btn-deal" onClick={newRound}>
            New Round
          </button>
        )}
      </div>
    </div>
  );
}