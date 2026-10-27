// Bottom sheet for row menus and short forms. Closes on backdrop tap.
import type { ReactNode } from "react";

export function Sheet({ title, onClose, children }: { title?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        {title && <h2 className="sheet-title" dir="auto">{title}</h2>}
        {children}
      </div>
    </div>
  );
}
