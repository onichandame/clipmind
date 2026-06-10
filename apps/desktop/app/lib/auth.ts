import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { env } from '../env';

const LEGACY_TOKEN_KEY = 'clipmind:auth:token';
const USER_KEY = 'clipmind:auth:user';
const DESKTOP_AUTH_HEADER = 'X-ClipMind-Desktop';

let cachedAuthToken: string | null | undefined;
let inflightAuthToken: Promise<string | null> | null = null;
let authTokenVersion = 0;

export interface AuthUser {
  id: string;
  email: string;
}

function clearCachedUser() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export async function getAuthToken(): Promise<string | null> {
  if (cachedAuthToken !== undefined) return cachedAuthToken;
  if (inflightAuthToken) return inflightAuthToken;
  const version = authTokenVersion;
  inflightAuthToken = invoke<string | null>('get_auth_token')
    .then((token) => {
      if (version === authTokenVersion) cachedAuthToken = token;
      return token;
    })
    .finally(() => {
      if (version === authTokenVersion) inflightAuthToken = null;
    });
  return inflightAuthToken;
}

export async function requireAuthToken(): Promise<string> {
  const token = await getAuthToken();
  if (!token) throw new Error('登录态丢失，请重新登录。');
  return token;
}

async function setAuthToken(token: string) {
  await invoke('set_auth_token', { token });
  authTokenVersion += 1;
  cachedAuthToken = token;
  inflightAuthToken = null;
}

async function clearAuthToken() {
  try {
    await invoke('clear_auth_token');
  } finally {
    authTokenVersion += 1;
    cachedAuthToken = null;
    inflightAuthToken = null;
  }
}

export async function clearAuthStorage() {
  clearCachedUser();
  await clearAuthToken().catch(() => undefined);
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

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set(DESKTOP_AUTH_HEADER, '1');
  const token = await getAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${env.VITE_API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [DESKTOP_AUTH_HEADER]: '1' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Login failed (${res.status})`);
  }
  const data = await res.json();
  if (typeof data?.token !== 'string') throw new Error('Login failed: missing token');
  await setAuthToken(data.token);
  setCachedUser(data.user);
  return data.user;
}

export async function signup(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${env.VITE_API_BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [DESKTOP_AUTH_HEADER]: '1' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Signup failed (${res.status})`);
  }
  const data = await res.json();
  if (typeof data?.token !== 'string') throw new Error('Signup failed: missing token');
  await setAuthToken(data.token);
  setCachedUser(data.user);
  return data.user;
}

export async function logout(): Promise<void> {
  try {
    await authFetch(`${env.VITE_API_BASE_URL}/api/auth/logout`, { method: 'POST' });
  } catch { /* swallow */ }
  await clearAuthStorage();
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const token = await getAuthToken();
    if (!token) return null;
    const res = await fetch(`${env.VITE_API_BASE_URL}/api/auth/me`, {
      headers: {
        [DESKTOP_AUTH_HEADER]: '1',
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401) {
      if ((await getAuthToken()) === token) await clearAuthStorage();
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
