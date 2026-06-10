import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
      strict: true
    }),
    // F-CLIENT-XSS-01 (CSP hardening). adapter-static cannot emit per-request
    // nonces (no SSR), so we use HASH mode: SvelteKit hashes its own inline
    // hydration script and injects the hashes, letting us drop the previous
    // `script-src 'unsafe-inline'`. DOMPurify (src/lib/sanitize.ts) remains the
    // primary XSS gate; this CSP is defense-in-depth.
    //
    // NOTE: `frame-ancestors` / `form-action` are ignored when CSP is delivered
    // via <meta> (all static hosting can do) — set them as real HTTP response
    // headers at the web server / CDN layer.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'https:', 'data:'],
        'connect-src': ['self', 'wss:', 'https:'],
        'object-src': ['none'],
        'base-uri': ['self']
      }
    }
  }
};

export default config;
