import type { Card } from '../types';

const SUIT_SYMBOL: Record<string, string> = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
};

interface Props { card: Card }

export default function CardView({ card }: Props) {
  if (card.face_down) {
    return (
      <div className="card-wrap">
        <div className="card card-back" />
      </div>
    );
  }
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  return (
    <div className="card-wrap">
      <div className={`card${red ? ' card-red' : ''}`}>
        <div className="card-corner">
          <span className="card-rank">{card.rank}</span>
          <span className="card-suit-sm">{SUIT_SYMBOL[card.suit]}</span>
        </div>
        <span className="card-suit-center">{SUIT_SYMBOL[card.suit]}</span>
        <div className="card-corner card-corner-br">
          <span className="card-rank">{card.rank}</span>
          <span className="card-suit-sm">{SUIT_SYMBOL[card.suit]}</span>
        </div>
      </div>
    </div>
  );
}
