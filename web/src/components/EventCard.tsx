import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ListOverview, LogisticsEvent } from "../lib/types";
import { formatDate, formatNeededBy } from "../lib/time";
import { ListStatusBadge, StatusCounts } from "./StatusBadge";
import { t } from "../strings";

interface Props {
  event: LogisticsEvent;
  /** The company's list, when the viewer is a customer. */
  list?: ListOverview;
  children?: ReactNode;
}

export function EventCard({ event, list, children }: Props) {
  const neededBy = formatNeededBy(event);
  return (
    <article className="card event-card">
      <Link to={`/events/${event.id}`} className="event-card-main">
        <div className="event-card-title">
          <span dir="auto" className="user-text">{event.name}</span>
          {event.scope === "battalion" && <span className="tag">{t.scopeBattalion}</span>}
        </div>
        <div className="event-card-meta muted">
          {neededBy && <span>{t.neededBy} {neededBy}</span>}
          <span>{formatDate(event.created_at)}</span>
          {event.status === "cancelled" && <span className="tag tag-danger">{t.eventCancelled}</span>}
          {event.status === "closed" && <span className="tag">{t.eventClosed}</span>}
        </div>
        {list && (
          <div className="event-card-counts">
            <ListStatusBadge status={list.status} />
            {list.n_urgent > 0 && <span className="tag tag-danger">{t.urgent} {list.n_urgent}</span>}
            <StatusCounts list={list} />
          </div>
        )}
      </Link>
      {children && <div className="event-card-actions">{children}</div>}
    </article>
  );
}
