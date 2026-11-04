// The comments on one request, in its sheet: between the company (front and
// rear alike) and the request's supplier, with a field to add one while the
// event is open.
import { addComment, commentsOn, commentWriter } from "../lib/comments";
import { useLiveRows, useUnits } from "../lib/live";
import type { CommentSide, ListComment, Request } from "../lib/types";
import { CommentThread } from "./CommentThread";
import { t } from "../strings";

interface Props {
  request: Request;
  /** The side this screen writes from; null when read-only. */
  side: CommentSide | null;
}

export function RequestComments({ request: r, side }: Props) {
  const units = useUnits();
  const { rows } = useLiveRows<ListComment>("list_comments", {
    column: "list_id", value: r.list_id, cacheKey: `comments:list:${r.list_id}`,
  });
  return (
    <div className="field"><span>{t.itemComments}</span>
      <CommentThread comments={commentsOn(rows, r.id)} writerName={commentWriter(units)} side={side}
        placeholder={t.commentOnItem}
        onAdd={(body) => side && addComment({
          listId: r.list_id, eventId: r.event_id, companyId: r.company_id, supplierId: r.supplier_id, side, body, requestId: r.id,
        })} />
    </div>
  );
}
