// Gate by sign-in and approval, then route by role.
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Crash } from "./components/Crash";
import { ToastProvider } from "./components/Toast";
import { useOutdated } from "./lib/appUpdate";
import { MonitoredErrorBoundary, setMonitoringUser } from "./lib/monitoring";
import { refreshPush } from "./lib/push";
import { SessionProvider, useSession } from "./lib/session";
import { AdminEvent } from "./screens/admin/AdminEvent";
import { AdminHome } from "./screens/admin/AdminHome";
import { AdminUnits } from "./screens/admin/AdminUnits";
import { AccessReview } from "./screens/admin/AccessReview";
import { AdminUser } from "./screens/admin/AdminUser";
import { AdminUsers } from "./screens/admin/AdminUsers";
import { CustomerEvent } from "./screens/customer/CustomerEvent";
import { CustomerHome } from "./screens/customer/CustomerHome";
import { Diagnostics } from "./screens/shared/Diagnostics";
import { History } from "./screens/shared/History";
import { NewEvent } from "./screens/shared/NewEvent";
import { Onboarding } from "./screens/shared/Onboarding";
import { Outdated } from "./screens/shared/Outdated";
import { SignIn } from "./screens/shared/SignIn";
import { UnitUsers } from "./screens/shared/UnitUsers";
import { UNIT_USERS_PATH } from "./screens/shared/unitUsers";
import { Waiting } from "./screens/shared/Waiting";
import { Catalog } from "./screens/supplier/Catalog";
import { SupplierEvent } from "./screens/supplier/SupplierEvent";
import { SupplierHome } from "./screens/supplier/SupplierHome";
import type { UserRole } from "./lib/types";
import { t } from "./strings";

const ROUTES: Record<UserRole, { path: string; element: JSX.Element }[]> = {
  customer: [
    { path: "/", element: <CustomerHome /> },
    { path: "/events/new", element: <NewEvent /> },
    { path: "/duplicate", element: <History pick /> },
    { path: "/events/:id/duplicate", element: <NewEvent /> },
    { path: "/events/:id", element: <CustomerEvent /> },
    { path: "/history", element: <History /> },
    { path: UNIT_USERS_PATH, element: <UnitUsers /> },
    { path: "/diagnostics", element: <Diagnostics /> },
  ],
  supplier: [
    { path: "/", element: <SupplierHome /> },
    { path: "/events/:id", element: <SupplierEvent /> },
    { path: "/catalog", element: <Catalog /> },
    { path: "/history", element: <History /> },
    { path: UNIT_USERS_PATH, element: <UnitUsers /> },
    { path: "/diagnostics", element: <Diagnostics /> },
  ],
  admin: [
    { path: "/", element: <AdminHome /> },
    { path: "/users", element: <AdminUsers /> },
    { path: "/users/:id", element: <AdminUser /> },
    { path: "/access", element: <AccessReview /> },
    { path: "/units", element: <AdminUnits /> },
    { path: "/events/new", element: <NewEvent /> },
    { path: "/events/:id/duplicate", element: <NewEvent /> },
    { path: "/events/:id", element: <AdminEvent /> },
    { path: "/history", element: <History /> },
    { path: "/diagnostics", element: <Diagnostics /> },
  ],
};

function Gate() {
  const { session, profile, loading } = useSession();
  const outdated = useOutdated(!!session);

  useEffect(() => {
    if (session && profile) refreshPush().catch(() => {});
  }, [session, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setMonitoringUser(session && profile ? { id: profile.id, role: profile.role } : null);
  }, [session, profile?.id, profile?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="page center"><p className="muted">{t.loading}</p></div>;
  if (!session) return <SignIn />;
  if (outdated) return <Outdated />;
  if (!profile || profile.approval === "rejected") return <Onboarding />;
  if (profile.approval === "pending" || !profile.active) return <Waiting />;

  return (
    <Routes>
      {ROUTES[profile.role].map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <MonitoredErrorBoundary fallback={<Crash />}>
      <SessionProvider>
        <ToastProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL}>
            <Gate />
          </BrowserRouter>
        </ToastProvider>
      </SessionProvider>
    </MonitoredErrorBoundary>
  );
}
