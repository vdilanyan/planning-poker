interface Props {
  deck: readonly number[];
  selected?: number;
  disabled: boolean;
  onSelect: (value: number | null) => void;
}

export function CardDeck({ deck, selected, disabled, onSelect }: Props) {
  return (
    <div className="deck" role="group" aria-label="Cards">
      {deck.map((value) => {
        const isSelected = selected === value;
        return (
          <button
            key={value}
            type="button"
            className={`card${isSelected ? ' card--selected' : ''}`}
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onSelect(isSelected ? null : value)}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}
