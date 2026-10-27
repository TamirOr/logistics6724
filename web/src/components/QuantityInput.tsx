// Number field with the numeric keyboard and large plus and minus buttons.
import { t } from "../strings";

interface Props {
  value: number;
  onChange: (value: number) => void;
  /** Called when editing ends, for fields that save on blur. */
  onCommit?: (value: number) => void;
  disabled?: boolean;
}

export function QuantityInput({ value, onChange, onCommit, disabled }: Props) {
  const step = (delta: number) => {
    const next = Math.max(1, value + delta);
    onChange(next);
    onCommit?.(next);
  };
  return (
    <div className="qty">
      <button type="button" className="qty-step" onClick={() => step(1)} disabled={disabled} aria-label="+">+</button>
      <input
        className="qty-input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={t.quantity}
        value={value || ""}
        disabled={disabled}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)}
        onBlur={() => onCommit?.(Math.max(1, value))}
      />
      <button type="button" className="qty-step" onClick={() => step(-1)} disabled={disabled || value <= 1} aria-label="-">−</button>
    </div>
  );
}
