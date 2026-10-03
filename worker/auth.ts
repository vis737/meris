/**
 * MERIS E-SHOP — Authentication for the Cloudflare Worker.
 *
 * - Admin sessions: HMAC-SHA256 JWTs signed with WebCrypto (2h expiry),
 *   delivered in an HttpOnly `admin_session` cookie.
 * - Admin credentials: stored in the Supabase `admin_config` table as bcrypt
 *   hashes (bcryptjs is pure JS and runs fine on Workers), with env-var
 *   fallback for fresh deployments.
 * - Customer passwords: bcrypt, verified against the `customers` table.
 */
import bcrypt from 'bcryptjs';
import { getSupabase } from './db';
import type { Env } from './env';

const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(encoded: string): Uint8Array {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** Minimal HS256 JWT implementation using WebCrypto. */
export async function signJwt(payload: Record<string, unknown>, secret: string, expirySeconds: number): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64UrlEncode(encoder.encode(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expirySeconds,
  })));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, any> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const key = await hmacKey(secret);
  const expected = await crypto.subtle.sign('HMAC', key, encoder.encode(`${header}.${body}`));
  const expectedSig = base64UrlEncode(new Uint8Array(expected));
  // Constant-time-ish comparison
  if (expectedSig.length !== signature.length) return null;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) mismatch |= expectedSig.charCodeAt(i) ^ signature.charCodeAt(i);
  if (mismatch !== 0) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashAdminPassword(plain: string): string {
  return bcrypt.hashSync(plain, 12);
}

/** Verify an admin password that may be stored as bcrypt hash or legacy plaintext. */
export function verifyAdminPassword(plainInput: string, storedHashOrPlain: string): boolean {
  if (storedHashOrPlain.startsWith('$2a$') || storedHashOrPlain.startsWith('$2b$') || storedHashOrPlain.startsWith('$2y$')) {
    return bcrypt.compareSync(plainInput, storedHashOrPlain);
  }
  return plainInput === storedHashOrPlain;
}

export async function verifyCustomerPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashCustomerPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

/**
 * Read the admin session JWT from the request's cookies and verify it.
 * Returns the decoded payload (with role === 'admin') or null.
 */
export async function getAdminSession(request: Request, env: Env): Promise<Record<string, any> | null> {
  const cookieHeader = request.headers.get('Cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1].trim());
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || payload.role !== 'admin') return null;
  return payload;
}

export interface AdminCredentials {
  username: string;
  password: string;
}

/**
 * Outcome of an admin credential lookup — distinguishes "no admin exists yet"
 * from "this username is wrong" from "the credential store is unreachable",
 * so the login route can answer with an honest status code instead of telling
 * every typo that credentials are "not provisioned".
 */
export type AdminCredentialLookup =
  | { status: 'found'; credentials: AdminCredentials }
  /** No credential store is configured at all (fresh deployment). */
  | { status: 'unprovisioned' }
  /** Stores are configured and readable, but none hold this username. */
  | { status: 'unknown-user' }
  /** A store is configured but could not be read — retryable. */
  | { status: 'unavailable' };

/**
 * Load admin credentials for a specific username. Looks up the matching
 * admin_config row first (so any provisioned admin row can sign in), falling
 * back to environment variables for fresh deployments.
 */
export async function loadAdminCredentials(env: Env, username: string): Promise<AdminCredentialLookup> {
  const supabase = getSupabase(env);
  const envCredentials: AdminCredentials | null =
    env.ADMIN_USERNAME && env.ADMIN_PASSWORD
      ? { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD }
      : null;

  let storeReadFailed = false;

  if (supabase) {
    const { data, error } = await supabase.from('admin_config').select('username, password').eq('username', username).maybeSingle();
    if (error) {
      storeReadFailed = true;
    } else if (data?.username && data?.password) {
      return { status: 'found', credentials: { username: data.username, password: data.password } };
    }
  }

  // Fresh-deployment fallback: environment variables.
  if (envCredentials && username === envCredentials.username) {
    return { status: 'found', credentials: envCredentials };
  }

  if (!supabase && !envCredentials) return { status: 'unprovisioned' };
  if (storeReadFailed) return { status: 'unavailable' };
  return { status: 'unknown-user' };
}
