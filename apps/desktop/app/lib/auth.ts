import { useEffect, useState, useCallback } from 'react';
import { env } from '../env';

const TOKEN_KEY = 'clipmind:auth:token';
const USER_KEY = 'clipmind:auth:user';

export interface AuthUser {
  id: string;
  email: string;
}

export function clearAuthStorage() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function getCachedUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthUser; } catch { return null; }
}

export function setCachedUser(user: AuthUser) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Drop-in fetch wrapper that sends the HttpOnly session cookie.
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  return fetch(input, { ...init, headers, credentials: init.credentials ?? 'include' });
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${env.VITE_API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Login failed (${res.status})`);
  }
  const data = await res.json();
  setCachedUser(data.user);
  return data.user;
}

export async function signup(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${env.VITE_API_BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Signup failed (${res.status})`);
  }
  const data = await res.json();
  setCachedUser(data.user);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await authFetch(`${env.VITE_API_BASE_URL}/api/auth/logout`, { method: 'POST' });
  } catch { /* swallow */ }
  clearAuthStorage();
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const res = await authFetch(`${env.VITE_API_BASE_URL}/api/auth/me`);
    if (res.status === 401) {
      clearAuthStorage();
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.user) setCachedUser(data.user);
    return data.user ?? null;
  } catch {
    return null;
  }
}

// Hook for components that need the current user. Hydrates from cache, then revalidates.
export function useSession() {
  const [user, setUser] = useState<AuthUser | null>(() => getCachedUser());
  const [loading, setLoading] = useState<boolean>(() => !getCachedUser());

  const refresh = useCallback(async () => {
    setLoading(true);
    const u = await fetchMe();
    setUser(u);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then(u => {
      if (!cancelled) {
        setUser(u);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return { user, loading, refresh, logout: async () => { await logout(); setUser(null); } };
}
