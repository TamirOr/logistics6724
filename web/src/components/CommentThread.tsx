// A thread of list comments, oldest first: who wrote each and when, the
// supplier's in the note color as with request notes. Below it, a "+ הערה"
// button that opens a field, so sections without comments stay one line.
import { useState, type FormEvent } from "react";
import { COMMENT_MAX_LENGTH, deleteComment } from "../lib/comments";
import { formatWrittenAt } from "../lib/time";
import type { CommentSide, ListComment } from "../lib/types";
import { useToast } from "./Toast";
import { t } from "../strings";

interface Props {
  comments: ListComment[];
  /** The company or supplier unit that wrote the comment. */
  writerName: (c: ListComment) => string;
  /** The side this screen writes from, whose comments it may delete; null when read-only. */
  side: CommentSide | null;
  onAdd: (body: string) => void;
  placeholder: string;
  /** Marks the company's comments to every supplier, where they mix with others. */
  markGeneral?: boolean;
}

export function CommentThread({ comments, writerName, side, onAdd, placeholder, markGeneral = false }: Props) {
  const [writing, setWriting] = useState(false);
  const [body, setBody] = useState("");
  const showToast = useToast();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAdd(body);
    setBody("");
    setWriting(false);
  };
  const remove = (c: ListComment) => showToast({ message: t.commentDeleted, onAction: deleteComment(c) });

  return (
    <div className="comments">
      {comments.length > 0 && (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id} className={`comment comment-${c.side}`}>
              <div className="comment-meta">
                <span className="comment-writer">{writerName(c)}</span>
                {markGeneral && c.supplier_id === null && <span className="tag">{t.toAllSuppliers}</span>}
                <span className="muted">{formatWrittenAt(c.created_at)}</span>
                {side === c.side && (
                  <button className="icon-btn comment-delete" aria-label={t.deleteComment} onClick={() => remove(c)}>×</button>
                )}
              </div>
              <div className="user-text" dir="auto">{c.body}</div>
            </li>
          ))}
        </ul>
      )}
      {side && (writing ? (
        <form className="adder-row" onSubmit={submit}>
          <input className="input" dir="auto" autoFocus placeholder={placeholder} aria-label={placeholder} value={body}
            maxLength={COMMENT_MAX_LENGTH} enterKeyHint="send" onChange={(e) => setBody(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!body.trim()}>{t.add}</button>
        </form>
      ) : (
        <button className="btn btn-ghost btn-small" onClick={() => setWriting(true)}>+ {t.addComment}</button>
      ))}
    </div>
  );
}
