// A request's quantity and its measure ("5 קרטון"). Each is its own element
// so the number never jumps sides in mixed text.
interface Props {
  quantity: number;
  measure: string | null;
}

export function RequestQuantity({ quantity, measure }: Props) {
  return (
    <span className="req-amount">
      <span className="req-qty">{quantity}</span>
      {measure && <span className="req-measure user-text" dir="auto">{measure}</span>}
    </span>
  );
}
