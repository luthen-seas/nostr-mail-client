# NOSTR Mail Reference Client

A minimal but functional web client demonstrating the full NOSTR Mail experience: onboarding, compose, inbox, threading, search, and settings.

## What This Is

This is the **reference client** for the NOSTR Mail protocol. It proves that the protocol works end-to-end and provides a UX baseline for other client implementations. It is not production-polished — it is a functional demonstration.

## Features

- **Onboarding flow**: Connect via NIP-07 browser extension (nos2x, Alby) or paste nsec
- **Inbox**: Threaded message list with unread indicators, sender avatars, timestamps
- **Compose**: To/CC fields with NIP-05 autocomplete, subject, Markdown body, attachment button
- **Thread view**: Chronological message display with inline reply, reply-all, forward
- **Search**: Real-time filtering across subject, body, and sender
- **Settings**: Identity, relay management, spam policy (Cashu/PoW thresholds), key management
- **Encryption**: Full NIP-59 gift wrapping (rumor -> seal -> gift wrap) with NIP-44 encryption
- **Mailbox state**: Read/flag/folder sync via kind 10099 (CRDT-based)
- **Anti-spam**: 6-tier trust model with contacts, NIP-05, PoW, and Cashu postage

## Tech Stack

- **SvelteKit** — SSR-capable, fast, minimal
- **Tailwind CSS** — Utility-first styling
- **nostr-tools** — NOSTR protocol library (NIP-44, NIP-59, SimplePool)
- **TypeScript** — Full type safety

## Protocol Coverage

| NIP | Purpose | Implementation |
|-----|---------|---------------|
| NIP-07 | Browser signer | Login via extension |
| NIP-17 | Private DMs | Kind 15 mail rumors |
| NIP-19 | Bech32 encoding | npub/nsec handling |
| NIP-44 | Versioned encryption | Seal + wrap layers |
| NIP-59 | Gift wrapping | 3-layer encryption |
| NIP-05 | DNS identifiers | Recipient resolution |
| NIP-65 | Relay lists | Kind 10002/10050 |

## Project Structure

```
src/
  lib/
    nostr-mail.ts    — Core client library (relay, encrypt, decrypt, send)
    stores.ts        — Svelte reactive stores (inbox, contacts, state)
  routes/
    +layout.svelte   — App shell (sidebar, topbar, responsive)
    +page.svelte     — Inbox view (threaded message list)
    compose/         — Compose view (to, cc, subject, body)
    thread/[id]/     — Thread view (conversation display)
    onboarding/      — 4-step onboarding flow
    settings/        — Identity, relays, spam policy, about
```

## Setup

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Requirements

- Node.js 18+
- A NIP-07 browser extension (nos2x, Alby, Nostr Connect) for key management
- Or a NOSTR nsec/hex private key for direct login

## Architecture

The client uses a singleton `NostrMailClient` instance (`nostrMail`) that manages:

1. **Relay connections** via `nostr-tools/SimplePool`
2. **NIP-07 signer integration** for key management
3. **Gift-wrap encryption** (rumor -> seal -> wrap) for outbound mail
4. **Gift-wrap decryption** (wrap -> seal -> rumor) for inbound mail
5. **Inbox subscription** with real-time WebSocket push
6. **Mailbox state** sync via kind 10099 replaceable events

Svelte stores provide reactive state that components subscribe to:

- `inbox` / `threadedInbox` — message data with thread grouping
- `mailboxState` — read/flag/folder state (CRDT-based)
- `currentUser` — identity, profile, relays
- `connectionStatus` — relay connectivity
- `composing` — draft state

## Relationship to Reference Library

This client uses a simplified, browser-adapted version of the `@nostr-mail/core` reference library (see `../reference/`). The core library handles the protocol mechanics; this client adds the UI layer and browser-specific integrations (NIP-07, DOM, routing).

## License

MIT
