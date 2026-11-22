"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { api, tokenStore, type User } from "@/lib/api";

type AuthState = {
  user: User | null;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  guest: () => Promise<void>;
  upgrade: (name: string, email: string, password: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string | null) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export const PUBLIC_PATHS = ["/login", "/signup"];

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // On first load, check any saved token with the backend
  useEffect(() => {
    async function restore() {
      if (tokenStore.get()) {
        try {
          setUser(await api.me());
        } catch {
          tokenStore.clear();
        }
      }
      setReady(true);
    }
    restore();
  }, []);

  const isPublic = PUBLIC_PATHS.includes(pathname);

  // Keep logged-out visitors on the login/signup pages, and logged-in users off them
  useEffect(() => {
    if (!ready) return;
    if (!user && !isPublic) router.replace("/login");
    if (user && isPublic) router.replace("/");
  }, [ready, user, isPublic, router]);

  async function finishAuth(token: string, remember = true) {
    tokenStore.set(token, remember);
    setUser(await api.me());
  }

  const value: AuthState = {
    user,
    login: async (email, password, remember = true) =>
      finishAuth((await api.login(email, password)).access_token, remember),
    signup: async (name, email, password) => finishAuth((await api.signup(name, email, password)).access_token),
    // Session-only token: closing the browser ends the guest session
    guest: async () => finishAuth((await api.guest()).access_token, false),
    // Replaces the guest's short-lived, tab-only token with a normal one
    upgrade: async (name, email, password) => finishAuth((await api.upgrade(name, email, password)).access_token),
    // The old token stops working when the password changes, so the new one replaces it (kept the same way as before)
    changePassword: async (currentPassword, newPassword) =>
      finishAuth((await api.changePassword(currentPassword, newPassword)).access_token, tokenStore.persistent()),
    deleteAccount: async (password) => {
      await api.deleteAccount(password);
      tokenStore.clear();
      setUser(null);
    },
    logout: () => {
      tokenStore.clear();
      setUser(null);
    },
  };

  // Don't flash protected content (or the login form) while redirecting.
  // Public pages render immediately so they are part of the server render.
  if (isPublic ? !!user : !ready || !user) return null;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
