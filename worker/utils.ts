/**
 * MERIS E-SHOP — Input sanitisation & rate-limiting helpers.
 * Ported from the original Express server (server.ts).
 */

/** Strip control characters, HTML tags, and trim to a maximum length. */
export function sanitizeString(value: unknown, maxLength = 500): string {
  if (typeof value !== 'string') return '';
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // control chars
    .replace(/<[^>]*>/g, '')                          // HTML tags
    .trim()
    .slice(0, maxLength);
}

/** Validate and normalise an email address. Returns '' if invalid. */
export function sanitizeEmail(value: unknown, maxLength = 254): string {
  const raw = typeof value === 'string' ? value.trim().toLowerCase().slice(0, maxLength) : '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw) ? raw : '';
}

/** Strip prompt-injection patterns from strings destined for AI models. */
export function sanitizeAiPrompt(value: unknown, maxLength = 300): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/system\s*:/gi, '')
    .replace(/\bignore\b.*\binstructions\b/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/[`{}<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') return '';
  const compact = value.replace(/[^\d+]/g, '');
  if (compact.startsWith('+')) return compact;
  if (compact.length === 10) return `+91${compact}`;
  return compact;
}

export function isConfigured(val: string | undefined | null): boolean {
  if (!val) return false;
  const clean = val.trim();
  return clean !== '' && !clean.includes('YOUR_') && !clean.includes('MY_');
}

export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

/**
 * Fixed-window in-memory rate limiter. Per-isolate only (each Cloudflare edge
 * PoP keeps its own counters), which is sufficient protection against
 * brute-force abuse when combined with Cloudflare's own WAF.
 */
const rateLimitDb: Record<string, { count: number; resetTime: number }> = {};

export function checkRateLimit(request: Request, pathKey: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const ip = getClientIp(request);
  const key = `${pathKey}:${ip}`;
  const now = Date.now();

  if (!rateLimitDb[key] || now > rateLimitDb[key].resetTime) {
    rateLimitDb[key] = { count: 1, resetTime: now + windowMs };
    return { ok: true, retryAfterSec: 0 };
  }

  rateLimitDb[key].count++;
  if (rateLimitDb[key].count > limit) {
    return { ok: false, retryAfterSec: Math.ceil((rateLimitDb[key].resetTime - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Escape a string for safe interpolation into HTML email templates. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Password validation ported from src/utils/passwordValidator.ts (server-side copy). */
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 8) errors.push('Password must be at least 8 characters long.');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter (A-Z).');
  if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter (a-z).');
  if (!/[0-9]/.test(password)) errors.push('Password must contain at least one number (0-9).');
  if (!/[!@#$%^&*()_+\-=[\]{}|;:'",.<>?/]/.test(password)) {
    errors.push('Password must contain at least one special character (e.g. !@#$%^&*).');
  }
  const commonPasswords = ['123456', 'password', 'qwerty', 'abc123', 'admin', 'welcome', 'letmein', '12345678', 'password123', 'admin123', 'welcome123', 'meriseshop', 'qwertyuiop'];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('This password is too common and easily guessable. Please choose a unique password.');
  }
  return { valid: errors.length === 0, errors };
}
