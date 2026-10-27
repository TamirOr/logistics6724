// Gate by sign-in and approval, then route by role.
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/Toast";
import { refreshPush } from "./lib/push";
import { SessionProvider, useSession } from "./lib/session";
import { AdminEvent } from "./screens/admin/AdminEvent";
import { AdminHome } from "./screens/admin/AdminHome";
import { AdminUnits } from "./screens/admin/AdminUnits";
import { AdminUsers } from "./screens/admin/AdminUsers";
import { CustomerEvent } from "./screens/customer/CustomerEvent";
import { CustomerHome } from "./screens/customer/CustomerHome";
import { History } from "./screens/shared/History";
import { NewEvent } from "./screens/shared/NewEvent";
import { Onboarding } from "./screens/shared/Onboarding";
import { SignIn } from "./screens/shared/SignIn";
import { Waiting } from "./screens/shared/Waiting";
import { Catalog } from "./screens/supplier/Catalog";
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
  ],
  supplier: [
    { path: "/", element: <SupplierHome /> },
    { path: "/events/:id", element: <SupplierHome /> },
    { path: "/catalog", element: <Catalog /> },
    { path: "/history", element: <History /> },
  ],
  admin: [
    { path: "/", element: <AdminHome /> },
    { path: "/users", element: <AdminUsers /> },
    { path: "/units", element: <AdminUnits /> },
    { path: "/events/new", element: <NewEvent /> },
    { path: "/events/:id/duplicate", element: <NewEvent /> },
    { path: "/events/:id", element: <AdminEvent /> },
    { path: "/history", element: <History /> },
  ],
};

function Gate() {
  const { session, profile, loading } = useSession();

  useEffect(() => {
    if (session && profile) refreshPush(session.user.id).catch(() => {});
  }, [session, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="page center"><p className="muted">{t.loading}</p></div>;
  if (!session) return <SignIn />;
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
    <SessionProvider>
      <ToastProvider>
        <BrowserRouter>
          <Gate />
        </BrowserRouter>
      </ToastProvider>
    </SessionProvider>
  );
}
