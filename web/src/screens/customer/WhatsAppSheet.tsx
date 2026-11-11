// Shows the company's list as a WhatsApp message and copies it. Where the
// clipboard is blocked, the text stays on screen to copy by hand.
import { useState } from "react";
import { Sheet } from "../../components/Sheet";
import { useToast } from "../../components/Toast";
import { whatsAppList, type WhatsAppListInput } from "../../lib/whatsAppList";
import { t } from "../../strings";

export function WhatsAppSheet({ list, onClose }: { list: Omit<WhatsAppListInput, "bySupplier">; onClose: () => void }) {
  const [bySupplier, setBySupplier] = useState(true);
  const [copyFailed, setCopyFailed] = useState(false);
  const showToast = useToast();
  const text = whatsAppList({ ...list, bySupplier });

  const copy = () => navigator.clipboard.writeText(text)
    .then(() => {
      showToast({ message: t.textCopied });
      onClose();
    })
    .catch(() => setCopyFailed(true));

  return (
    <Sheet title={t.whatsApp} onClose={onClose}>
      <div className="stack">
        <div className="segmented" role="group" aria-label={t.whatsAppSplit}>
          {[true, false].map((split) => (
            <button key={String(split)} className={split === bySupplier ? "active" : ""} aria-pressed={split === bySupplier}
              onClick={() => setBySupplier(split)}>{split ? t.whatsAppBySupplier : t.whatsAppByCategory}</button>
          ))}
        </div>
        <textarea className="input whatsapp-text" dir="auto" readOnly value={text} rows={12}
          onFocus={(e) => e.currentTarget.select()} />
        {copyFailed && <p className="notice">{t.copyByHand}</p>}
        <button className="btn btn-primary btn-block" onClick={copy}>{t.copyText}</button>
        <button className="btn btn-ghost btn-block" onClick={onClose}>{t.close}</button>
      </div>
    </Sheet>
  );
}
