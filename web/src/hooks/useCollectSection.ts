// "אספתי" on a supplier's section of a company list: collects everything
// ready or partial in it and offers undo. The company's front and rear both use it.
import { useToast } from "../components/Toast";
import { collectSection, isCollectable, undoMark } from "../lib/requests";
import type { Request } from "../lib/types";
import { t } from "../strings";

export function useCollectSection() {
  const showToast = useToast();
  return (listId: string, supplierId: string, sectionRows: Request[]) => {
    const ready = sectionRows.filter(isCollectable);
    collectSection(listId, supplierId, sectionRows);
    // Undo uses the rows as they were before the pickup.
    showToast({ message: `${t.collected} ✓`, onAction: () => ready.forEach((r) => undoMark(r, "collected")) });
  };
}
