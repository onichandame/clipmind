import { useEffect, useState, useCallback } from 'react';
import { env } from '../env';

const TOKEN_KEY = 'clipmind:auth:token';
const USER_KEY = 'clipmind:auth:user';

export interface AuthUser {
  id: string;
  email: string;
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
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

// Drop-in fetch wrapper that injects the Authorization header.
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${env.VITE_API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Login failed (${res.status})`);
  }
  const data = await res.json();
  setToken(data.token);
  setCachedUser(data.user);
  return data.user;
}

export async function signup(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${env.VITE_API_BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Signup failed (${res.status})`);
  }
  const data = await res.json();
  setToken(data.token);
  setCachedUser(data.user);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await authFetch(`${env.VITE_API_BASE_URL}/api/auth/logout`, { method: 'POST' });
  } catch { /* swallow */ }
  clearToken();
}

export async function fetchMe(): Promise<AuthUser | null> {
  if (!getToken()) return null;
  try {
    const res = await authFetch(`${env.VITE_API_BASE_URL}/api/auth/me`);
    if (res.status === 401) {
      clearToken();
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
  const [loading, setLoading] = useState<boolean>(() => !!getToken() && !getCachedUser());

  const refresh = useCallback(async () => {
    setLoading(true);
    const u = await fetchMe();
    setUser(u);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
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
