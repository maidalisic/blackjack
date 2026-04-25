import type { Card } from '../types';
import { getHandDisplay } from '../gameLogic';
import CardView from './CardView';

interface Props {
  cards: Card[];
  label?: string;
  active?: boolean;
  result?: string | null;
  dealDelay?: number; // seconds — offsets ALL cards in this hand (for sequential multi-hand deals)
}

const BADGE: Record<string, string> = {
  blackjack: 'BLACKJACK', win: 'WIN', lose: 'LOSE', bust: 'BUST', push: 'PUSH',
};

export default function HandView({ cards, label, active, result, dealDelay = 0 }: Props) {
  const visible = cards.filter(c => !c.faceDown);
  const display = visible.length ? getHandDisplay(cards) : null;
  const isSoftDisplay = display?.includes('/') ?? false;

  return (
    <div className={`hv${active ? ' hv-active' : ''}`}>
      {(label || display !== null || result) && (
        <div className="hv-meta">
          {label && <span className="hv-label">{label}</span>}
          {display !== null && (
            <span className={`hv-val${isSoftDisplay ? ' hv-val-soft' : ''}`}>
              {display}
            </span>
          )}
          {result && (
            <span className={`hv-badge hv-badge-${result}`}>
              {BADGE[result] ?? result.toUpperCase()}
            </span>
          )}
        </div>
      )}
      {/* --delay-offset shifts all nth-child delays so dealer cards come after player cards */}
      <div
        className="hv-cards"
        style={{ '--delay-offset': `${dealDelay}s` } as React.CSSProperties}
      >
        {cards.map((c, i) => <CardView key={i} card={c} />)}
      </div>
    </div>
  );
}
