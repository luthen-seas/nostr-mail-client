// Regression tests for the client's decrypted-mail sanitizer (F-CLIENT-XSS-01).
// Decrypted bodies are fully attacker-controlled; these assert that no script,
// event handler, or dangerous URL scheme survives any render path.
import { describe, it, expect } from 'vitest';
import { formatBody, safeBlossomFileUrl } from './sanitize';

describe('formatBody — XSS defense', () => {
  const xssPayloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://evil.test"></iframe>',
    '<svg onload="alert(1)"></svg>',
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
    '<div onclick="steal()">x</div>',
  ];

  // For markup content types, no live tags/handlers/schemes may survive.
  for (const contentType of ['text/html', 'text/markdown']) {
    for (const payload of xssPayloads) {
      it(`neutralizes ${payload.slice(0, 24)}… as ${contentType}`, () => {
        const out = formatBody(payload, contentType);
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toMatch(/<iframe/i);
        expect(out).not.toMatch(/<svg/i);
        // No live event-handler attribute (escaped text containing "onclick"
        // is fine; a live `onclick=` attribute on a tag is not).
        expect(out).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
        expect(out).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
      });
    }
  }

  // For plain text, everything is escaped — no live markup at all.
  for (const payload of xssPayloads) {
    it(`escapes ${payload.slice(0, 24)}… as text/plain`, () => {
      const out = formatBody(payload, 'text/plain');
      // The only tags present are the wrapper <p>/<br> we generate.
      expect(out).not.toMatch(/<(?!\/?(p|br)\b)[a-z]/i);
      expect(out).toContain('&lt;');
    });
  }

  it('preserves safe markdown formatting', () => {
    const out = formatBody('**bold** and [link](https://ok.test)', 'text/markdown');
    expect(out).toMatch(/<strong>bold<\/strong>/);
    expect(out).toMatch(/href="https:\/\/ok\.test"/);
  });

  it('escapes plain text', () => {
    const out = formatBody('1 < 2 & 3 > 0', 'text/plain');
    expect(out).toContain('&lt;');
    expect(out).toContain('&amp;');
    expect(out).not.toMatch(/<(?!\/?(p|br)\b)/i); // only p/br tags allowed in
  });
});

describe('safeBlossomFileUrl — SSRF/beacon guard', () => {
  const hash = 'a'.repeat(64);
  it('accepts a public https blossom url with a valid hash', () => {
    expect(safeBlossomFileUrl('https://blossom.example.com', hash)).toBe(`https://blossom.example.com/${hash}`);
  });
  it('rejects non-hex hashes', () => {
    expect(safeBlossomFileUrl('https://blossom.example.com', '../etc/passwd')).toBeNull();
  });
  it('rejects http and private/loopback hosts', () => {
    expect(safeBlossomFileUrl('http://blossom.example.com', hash)).toBeNull();
    expect(safeBlossomFileUrl('https://127.0.0.1', hash)).toBeNull();
    expect(safeBlossomFileUrl('https://169.254.169.254', hash)).toBeNull();
    expect(safeBlossomFileUrl('https://10.0.0.5', hash)).toBeNull();
    expect(safeBlossomFileUrl('https://localhost', hash)).toBeNull();
  });
});
