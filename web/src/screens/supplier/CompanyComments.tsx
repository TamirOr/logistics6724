// The comments a supplier reads on one company's list: the company's to
// every supplier and those between the company and this supplier unit,
// with a field to answer while the event is open.
import { CommentThread } from "../../components/CommentThread";
import { addComment, commentsForSupplier, commentWriter } from "../../lib/comments";
import { useLiveRows } from "../../lib/live";
import type { ListComment, Unit } from "../../lib/types";
import { t } from "../../strings";

interface Props {
  listId: string;
  eventId: string;
  companyId: string;
  supplierId: string;
  units: Unit[];
  editable: boolean;
}

export function CompanyComments({ listId, eventId, companyId, supplierId, units, editable }: Props) {
  const { rows } = useLiveRows<ListComment>("list_comments", {
    column: "list_id", value: listId, cacheKey: `comments:list:${listId}`,
  });
  const nameOf = (id: string | null) => units.find((u) => u.id === id)?.name ?? "";
  return (
    <CommentThread comments={commentsForSupplier(rows, supplierId)} markGeneral
      writerName={commentWriter(units)}
      side={editable ? "supplier" : null} placeholder={t.commentToCompany(nameOf(companyId))}
      onAdd={(body) => addComment({ listId, eventId, companyId, supplierId, side: "supplier", body })} />
  );
}
