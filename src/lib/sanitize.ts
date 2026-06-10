// Centralized, testable HTML sanitization for decrypted mail bodies.
//
// Decrypted mail body + subject are fully attacker-controlled, so EVERY render
// path must pass through DOMPurify with a tight allowlist before insertion via
// {@html}. This module is the single source of that policy (F-CLIENT-XSS-01).
import DOMPurify from 'dompurify';
import { marked } from 'marked';

export const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4'],
  ALLOWED_ATTR: ['href', 'title'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|nostr):/i,
} as const;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a mail body to sanitized HTML safe for {@html} insertion.
 * Markdown is rendered then sanitized; HTML is sanitized; plain text is escaped
 * and paragraph-wrapped then sanitized (defense in depth).
 */
export function formatBody(body: string, contentType: string): string {
  const src = body || '';
  if (contentType === 'text/markdown') {
    const rendered = marked.parse(src, { async: false }) as string;
    return DOMPurify.sanitize(rendered, SANITIZE_CONFIG);
  }
  if (contentType === 'text/html') {
    return DOMPurify.sanitize(src, SANITIZE_CONFIG);
  }
  const html = escapeHtml(src)
    .split(/\n{2,}/)
    .map((p) => `<p class="mb-3">${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

// ── Attachment URL guard (F-DLOAD, client-side) ─────────────────────────────
// When the client implements attachment downloads, Blossom URLs come from the
// (attacker-authored) rumor. Only allow https with a 64-hex blob hash, and
// reject obvious private/loopback hosts. (Browsers sandbox cross-origin reads,
// but this prevents tracking-beacon / SSRF-style requests.)
const HEX64 = /^[0-9a-f]{64}$/i;

export function safeBlossomFileUrl(baseUrl: string, hash: string): string | null {
  if (!HEX64.test(hash)) return null;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return null;
  }
  return `${url.toString().replace(/\/$/, '')}/${hash}`;
}
