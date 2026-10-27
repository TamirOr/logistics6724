// Page frame: header with title and back button, content, and an optional
// bottom action bar within thumb reach. Top-level screens pass nav; their
// header also has sign-out.
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { goBack } from "../lib/navigation";
import { AccountBar } from "./AccountBar";
import { SyncIndicator } from "./SyncIndicator";
import { t } from "../strings";

interface Props {
  title: ReactNode;
  back?: boolean;
  actions?: ReactNode;
  bottom?: ReactNode;
  nav?: { to: string; label: string }[];
  children: ReactNode;
}

export function Layout({ title, back, actions, bottom, nav, children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="page">
      <header className="header">
        {back && (
          <button className="icon-btn" onClick={() => goBack(navigate, location)} aria-label={t.back}>→</button>
        )}
        <h1 className="header-title" dir="auto">{title}</h1>
        <div className="header-actions">
          {actions}
          {nav && <AccountBar />}
        </div>
      </header>
      <SyncIndicator />
      {nav && (
        <nav className="tabs">
          {nav.map((n) => <Link key={n.to} to={n.to} className="tab">{n.label}</Link>)}
        </nav>
      )}
      <main className="content">{children}</main>
      {bottom && <div className="bottom-bar">{bottom}</div>}
    </div>
  );
}
