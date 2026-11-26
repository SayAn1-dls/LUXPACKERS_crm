import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Me } from "../../shared/schema";
import { api, ApiError, setApiHooks } from "./api";

/** The signed-in person, with the effective permissions of their position. */
export type User = Me;

interface AuthValue {
  /** null when signed out (or still loading, see `loading`). */
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<User | null>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

/** Root route element: owns the signed-in user and wires the api() hooks. */
export function AuthProvider({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: u } = await api<{ user: User }>("GET", "/me");
      setUser(u);
      return u;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 401) setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setApiHooks({
      onUnauthorized: () => {
        setUser(null);
        qc.clear();
        navigate("/login", { replace: true });
      },
      onMustChangePassword: () => {
        setUser((u) => (u ? { ...u, mustChangePassword: true } : u));
        navigate("/change-password", { replace: true });
      },
      onMfaSetupRequired: () => {
        setUser((u) => (u ? { ...u, mfaEnabled: false } : u));
        navigate("/account/two-step", { replace: true });
      },
    });
    void refresh();
    return () => setApiHooks({});
  }, [navigate, qc, refresh]);

  const signOut = useCallback(async () => {
    try {
      await api("POST", "/auth/logout");
    } catch {
      /* already signed out is fine */
    }
    setUser(null);
    qc.clear();
    navigate("/login", { replace: true });
  }, [navigate, qc]);

  const value = useMemo(() => ({ user, loading, setUser, signOut, refresh }), [user, loading, signOut, refresh]);
  return <AuthContext.Provider value={value}>{children ?? <Outlet />}</AuthContext.Provider>;
}
