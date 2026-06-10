// ─── NOSTR Mail Client Library ───────────────────────────────────────────────
// Browser-adapted NOSTR Mail client using NIP-07 signer integration.
// Handles relay connections, gift-wrap encryption, inbox subscriptions,
// contact list management, and mailbox state sync.

import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import * as nip19 from 'nostr-tools/nip19';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Signer {
  getPublicKey(): Promise<string>;
  signEvent(event: any): Promise<any>;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

export interface ParsedMail {
  id: string;
  messageId: string;
  from: { pubkey: string; name?: string; nip05?: string };
  to: { pubkey: string; name?: string; role: string }[];
  cc: { pubkey: string; name?: string; role: string }[];
  subject: string;
  body: string;
  contentType: 'text/plain' | 'text/markdown' | 'text/html';
  attachments: MailAttachment[];
  threadId?: string;
  replyTo?: string;
  cashuPostage?: { token: string; mint: string; amount: number };
  createdAt: number;
  receivedAt: number;
}

export interface MailAttachment {
  hash: string;
  filename: string;
  mimeType: string;
  size: number;
  encryptionKey?: string;
  blossomUrls: string[];
}

export interface MailboxState {
  reads: Set<string>;
  flags: Map<string, string[]>;
  folders: Map<string, string>;
  deleted: Set<string>;
}

export interface ProfileInfo {
  name?: string;
  display_name?: string;
  picture?: string;
  nip05?: string;
  about?: string;
}

export interface SendMailParams {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  contentType?: 'text/plain' | 'text/markdown';
  replyTo?: string;
  threadId?: string;
  /** Bypass the 0-60s CSPRNG publish delay (DEC-016). Default: false. */
  immediate?: boolean;
}

// ─── Default Relays ──────────────────────────────────────────────────────────

export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.snort.social',
];

export const DEFAULT_INBOX_RELAYS = [
  'wss://auth.nostr1.com',
  'wss://relay.damus.io',
  'wss://nos.lol',
];

// ─── NostrMailClient ─────────────────────────────────────────────────────────

export class NostrMailClient {
  private pool: SimplePool;
  private signer: Signer | null = null;
  private pubkey: string = '';
  private relays: string[] = [];
  private inboxRelays: string[] = [];
  private subscriptionCloser: (() => void) | null = null;
  private profileCache: Map<string, ProfileInfo> = new Map();
  /** Master privkey bytes when connected via nsec; zeroed on disconnect. */
  private privkeyBytes: Uint8Array | null = null;

  constructor() {
    this.pool = new SimplePool();
  }

  // ── Connection & Authentication ──────────────────────────────────────

  /** Connect using a NIP-07 browser extension (nos2x, Alby, etc.) */
  async connectWithExtension(): Promise<string> {
    const nostr = (window as any).nostr;
    if (!nostr) {
      throw new Error('No NIP-07 extension found. Install nos2x, Alby, or another NOSTR signer.');
    }
    this.signer = nostr as Signer;
    this.pubkey = await nostr.getPublicKey();
    await this.loadRelayLists();
    return this.pubkey;
  }

  /** Connect with a raw nsec private key (stores in memory only). */
  async connectWithNsec(nsecOrHex: string): Promise<string> {
    let privkey: Uint8Array;
    if (nsecOrHex.startsWith('nsec1')) {
      const decoded = nip19.decode(nsecOrHex);
      if (decoded.type !== 'nsec') throw new Error('Invalid nsec');
      privkey = decoded.data as Uint8Array;
    } else if (/^[0-9a-f]{64}$/i.test(nsecOrHex.trim())) {
      privkey = hexToBytes(nsecOrHex.trim());
    } else {
      throw new Error('Invalid private key format');
    }

    const pubkey = getPublicKey(privkey);

    // Stash the buffer so disconnect() can zero it. The closures below capture
    // `privkey` by reference, so they keep working until disconnect() fires.
    this.privkeyBytes = privkey;

    this.signer = {
      getPublicKey: async () => pubkey,
      signEvent: async (event: any) => finalizeEvent(event, privkey),
      nip44: {
        encrypt: async (recipientPubkey: string, plaintext: string) => {
          const convKey = nip44.v2.utils.getConversationKey(privkey, recipientPubkey);
          return nip44.v2.encrypt(plaintext, convKey);
        },
        decrypt: async (senderPubkey: string, ciphertext: string) => {
          const convKey = nip44.v2.utils.getConversationKey(privkey, senderPubkey);
          return nip44.v2.decrypt(ciphertext, convKey);
        },
      },
    };

    this.pubkey = pubkey;
    await this.loadRelayLists();
    return pubkey;
  }

  get isConnected(): boolean {
    return !!this.signer && !!this.pubkey;
  }

  get currentPubkey(): string {
    return this.pubkey;
  }

  get currentRelays(): string[] {
    return this.relays;
  }

  get currentInboxRelays(): string[] {
    return this.inboxRelays;
  }

  // ── Relay List Management ────────────────────────────────────────────

  /** Load kind 10002 (general relays) and kind 10050 (DM inbox relays). */
  async loadRelayLists(): Promise<void> {
    const relays = this.relays.length > 0 ? this.relays : DEFAULT_RELAYS;

    // Fetch kind 10002 (NIP-65 relay list)
    const relayListEvents = await this.pool.querySync(relays, {
      kinds: [10002],
      authors: [this.pubkey],
      limit: 1,
    });

    if (relayListEvents.length > 0) {
      const event = relayListEvents[0];
      this.relays = event.tags
        .filter((t: string[]) => t[0] === 'r')
        .map((t: string[]) => t[1])
        .filter(Boolean);
    }
    if (this.relays.length === 0) {
      this.relays = DEFAULT_RELAYS;
    }

    // Fetch kind 10050 (DM relay list)
    const dmRelayEvents = await this.pool.querySync(this.relays, {
      kinds: [10050],
      authors: [this.pubkey],
      limit: 1,
    });

    if (dmRelayEvents.length > 0) {
      const event = dmRelayEvents[0];
      this.inboxRelays = event.tags
        .filter((t: string[]) => t[0] === 'relay')
        .map((t: string[]) => t[1])
        .filter(Boolean);
    }
    if (this.inboxRelays.length === 0) {
      this.inboxRelays = DEFAULT_INBOX_RELAYS;
    }
  }

  // ── Profile Fetching ─────────────────────────────────────────────────

  /** Fetch a kind 0 profile for a pubkey. Results are cached. */
  async fetchProfile(pubkey: string): Promise<ProfileInfo | null> {
    if (this.profileCache.has(pubkey)) {
      return this.profileCache.get(pubkey)!;
    }

    const events = await this.pool.querySync(this.relays, {
      kinds: [0],
      authors: [pubkey],
      limit: 1,
    });

    if (events.length === 0) return null;

    try {
      const profile = JSON.parse(events[0].content) as ProfileInfo;
      this.profileCache.set(pubkey, profile);
      return profile;
    } catch {
      return null;
    }
  }

  // ── Contact List ─────────────────────────────────────────────────────

  /** Fetch the user's kind 3 contact list (follows). */
  async fetchContacts(): Promise<Set<string>> {
    const events = await this.pool.querySync(this.relays, {
      kinds: [3],
      authors: [this.pubkey],
      limit: 1,
    });

    if (events.length === 0) return new Set();

    return new Set(
      events[0].tags
        .filter((t: string[]) => t[0] === 'p')
        .map((t: string[]) => t[1])
    );
  }

  // ── Inbox Subscription ───────────────────────────────────────────────

  /** Subscribe to incoming gift-wrapped mail (kind 1059). */
  subscribeInbox(
    onMessage: (wrap: any) => void,
    since?: number
  ): () => void {
    const filter = {
      '#p': [this.pubkey],
      kinds: [1059],
      ...(since ? { since } : {}),
    };

    const seenIds = new Set<string>();

    const sub = this.pool.subscribeMany(this.inboxRelays, [filter], {
      onevent(event: any) {
        if (seenIds.has(event.id)) return;
        seenIds.add(event.id);
        onMessage(event);
      },
    });

    this.subscriptionCloser = () => sub.close();
    return () => sub.close();
  }

  /** Fetch existing inbox events (one-shot query). */
  async fetchInbox(since?: number, limit: number = 500): Promise<any[]> {
    const events = await this.pool.querySync(this.inboxRelays, {
      '#p': [this.pubkey],
      kinds: [1059],
      ...(since ? { since } : {}),
      limit,
    });

    // Deduplicate by ID
    const seen = new Set<string>();
    return events.filter((e: any) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }

  // ── Decrypt Gift Wrap ────────────────────────────────────────────────

  /** Unwrap a kind 1059 gift wrap to reveal the mail rumor inside. */
  async unwrapMail(wrapEvent: any): Promise<ParsedMail | null> {
    if (!this.signer?.nip44) return null;

    try {
      // Layer 1: Decrypt gift wrap -> seal
      const sealJson = await this.signer.nip44.decrypt(wrapEvent.pubkey, wrapEvent.content);
      const seal = JSON.parse(sealJson);

      if (seal.kind !== 13) return null;

      // Verify seal Schnorr signature (NIP-59 MUST; spec compliance + DiD).
      // F2 from audit: the active-impersonation attack is blocked by NIP-44
      // HMAC binding, but we still must verify per the spec.
      if (!verifyEvent(seal)) return null;

      // Layer 2: Decrypt seal -> rumor
      const rumorJson = await this.signer.nip44.decrypt(seal.pubkey, seal.content);
      const rumor = JSON.parse(rumorJson);

      if (rumor.kind !== 1400 && rumor.kind !== 14) return null;

      // Verify sender consistency: rumor.pubkey must match seal.pubkey
      if (rumor.pubkey !== seal.pubkey) return null;

      // Parse rumor tags into structured mail
      return this.parseRumor(rumor, wrapEvent.id, seal.pubkey);
    } catch (err) {
      console.warn('Failed to unwrap mail:', err);
      return null;
    }
  }

  /** Parse a decrypted rumor into a ParsedMail object. */
  private parseRumor(rumor: any, wrapId: string, senderPubkey: string): ParsedMail {
    const tags: string[][] = rumor.tags || [];

    const recipients = tags
      .filter(t => t[0] === 'p')
      .map(t => ({ pubkey: t[1] || '', name: undefined, role: t[3] || 'to' }));

    const to = recipients.filter(r => r.role === 'to');
    const cc = recipients.filter(r => r.role === 'cc');

    const subject = tags.find(t => t[0] === 'subject')?.[1] || '(no subject)';
    const messageId = tags.find(t => t[0] === 'message-id')?.[1] || '';
    const contentType = (tags.find(t => t[0] === 'content-type')?.[1] || 'text/plain') as ParsedMail['contentType'];
    const replyTo = tags.find(t => t[0] === 'reply' || (t[0] === 'e' && t[3] === 'reply'))?.[1];
    const threadId = tags.find(t => t[0] === 'thread' || (t[0] === 'e' && t[3] === 'root'))?.[1];

    // Parse attachments
    const attachmentTags = tags.filter(t => t[0] === 'attachment');
    const keyTags = tags.filter(t => t[0] === 'attachment-key');
    const blossomTag = tags.find(t => t[0] === 'blossom');
    const blossomUrls = blossomTag ? blossomTag.slice(1) : [];

    const attachments: MailAttachment[] = attachmentTags.map(t => {
      const hash = t[1] || '';
      const keyTag = keyTags.find(k => k[1] === hash);
      return {
        hash,
        filename: t[2] || '',
        mimeType: t[3] || 'application/octet-stream',
        size: parseInt(t[4] || '0', 10),
        encryptionKey: keyTag?.[2],
        blossomUrls,
      };
    });

    // Parse cashu postage
    const cashuTag = tags.find(t => t[0] === 'cashu');
    const cashuPostage = cashuTag ? {
      token: cashuTag[1] || '',
      mint: tags.find(t => t[0] === 'cashu-mint')?.[1] || '',
      amount: parseInt(tags.find(t => t[0] === 'cashu-amount')?.[1] || '0', 10),
    } : undefined;

    return {
      id: wrapId,
      messageId,
      from: { pubkey: senderPubkey },
      to,
      cc,
      subject,
      body: rumor.content || '',
      contentType,
      attachments,
      threadId,
      replyTo,
      cashuPostage,
      createdAt: rumor.created_at || Math.floor(Date.now() / 1000),
      receivedAt: Math.floor(Date.now() / 1000),
    };
  }

  // ── Send Mail ────────────────────────────────────────────────────────

  /** Send a NOSTR Mail message (gift-wrapped kind 1400 rumor). */
  async sendMail(params: SendMailParams): Promise<string> {
    if (!this.signer) throw new Error('Not connected');

    const allRecipients = [
      ...(params.to || []).map(p => ({ pubkey: p, role: 'to' })),
      ...(params.cc || []).map(p => ({ pubkey: p, role: 'cc' })),
    ];

    // Build the kind 1400 rumor (unsigned)
    const tags: string[][] = [];
    for (const r of allRecipients) {
      tags.push(['p', r.pubkey, '', r.role]);
    }
    tags.push(['subject', params.subject]);

    // Generate stable message-id (shared across all recipient copies)
    const messageId = Array.from(crypto.getRandomValues(new Uint8Array(32)),
      b => b.toString(16).padStart(2, '0')).join('');
    tags.push(['message-id', messageId]);

    if (params.contentType && params.contentType !== 'text/plain') {
      tags.push(['content-type', params.contentType]);
    }
    if (params.replyTo) {
      tags.push(['reply', params.replyTo, '']);
    }
    if (params.threadId) {
      tags.push(['thread', params.threadId, '']);
    }

    const rumor = {
      kind: 1400,
      pubkey: this.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: params.body,
    };

    // Compute rumor ID (hash of serialized event)
    const rumorId = await computeEventId(rumor);

    // Gift-wrap for each recipient + self-copy
    const recipientPubkeys = [...new Set([
      ...allRecipients.map(r => r.pubkey),
      this.pubkey, // self-copy
    ])];

    for (const recipientPubkey of recipientPubkeys) {
      // Look up recipient's inbox relays
      const targetRelays = await this.getRecipientRelays(recipientPubkey);

      // Create gift wrap via signer
      const wrap = await this.createGiftWrap(rumor, recipientPubkey);

      // DEC-016: 0-60s CSPRNG random publish delay to defeat send-time
      // correlation. Caller may opt out via params.immediate (warns user).
      if (!params.immediate) {
        const delayMs = cryptoRandomUint32() % 60001;
        await new Promise((r) => setTimeout(r, delayMs));
      }

      // Publish to recipient's relays
      await Promise.allSettled(
        this.pool.publish(targetRelays, wrap)
      );
    }

    return rumorId;
  }

  /** Look up a recipient's kind 10050 inbox relays, falling back to kind 10002. */
  private async getRecipientRelays(pubkey: string): Promise<string[]> {
    // Try kind 10050 first
    const dmEvents = await this.pool.querySync(this.relays, {
      kinds: [10050],
      authors: [pubkey],
      limit: 1,
    });

    if (dmEvents.length > 0) {
      const relays = dmEvents[0].tags
        .filter((t: string[]) => t[0] === 'relay')
        .map((t: string[]) => t[1])
        .filter(Boolean);
      if (relays.length > 0) return relays;
    }

    // Fall back to kind 10002
    const relayEvents = await this.pool.querySync(this.relays, {
      kinds: [10002],
      authors: [pubkey],
      limit: 1,
    });

    if (relayEvents.length > 0) {
      return relayEvents[0].tags
        .filter((t: string[]) => t[0] === 'r')
        .map((t: string[]) => t[1])
        .filter(Boolean)
        .slice(0, 5);
    }

    return DEFAULT_INBOX_RELAYS;
  }

  /** Create a NIP-59 gift wrap for a single recipient. */
  private async createGiftWrap(rumor: any, recipientPubkey: string): Promise<any> {
    if (!this.signer) throw new Error('Not connected');

    const now = Math.floor(Date.now() / 1000);
    const rumorJson = JSON.stringify(rumor);

    // Seal: encrypt rumor with NIP-44, signed by sender
    const encryptedRumor = this.signer.nip44
      ? await this.signer.nip44.encrypt(recipientPubkey, rumorJson)
      : '';

    const sealTemplate = {
      kind: 13,
      created_at: now + randomOffset(),
      tags: [] as string[][],
      content: encryptedRumor,
    };

    const seal = await this.signer.signEvent(sealTemplate);

    // Gift wrap: encrypt seal with ephemeral key
    const ephemeralPrivkey = generateSecretKey();
    const sealJson = JSON.stringify(seal);
    const convKey = nip44.v2.utils.getConversationKey(ephemeralPrivkey, recipientPubkey);
    const encryptedSeal = nip44.v2.encrypt(sealJson, convKey);

    const wrapTemplate = {
      kind: 1059,
      created_at: now + randomOffset(),
      tags: [['p', recipientPubkey]],
      content: encryptedSeal,
    };

    const wrap = finalizeEvent(wrapTemplate, ephemeralPrivkey);
    ephemeralPrivkey.fill(0); // Zero ephemeral key material after use
    return wrap;
  }

  // ── Mailbox State (kind 30099, partitioned by month) ─────────────────

  /** Fetch the user's mailbox state from relays (all monthly partitions). */
  async fetchMailboxState(): Promise<MailboxState> {
    const events = await this.pool.querySync(this.relays, {
      kinds: [30099],
      authors: [this.pubkey],
    });

    if (events.length === 0) {
      return { reads: new Set(), flags: new Map(), folders: new Map(), deleted: new Set() };
    }

    // Merge all monthly partitions into a single state.
    // Each partition is decrypted from event.content per DEC-013.
    const merged: MailboxState = { reads: new Set(), flags: new Map(), folders: new Map(), deleted: new Set() };
    for (const event of events) {
      const partitionState = await this.parseStateFromEvent(event);
      if (!partitionState) continue;
      // G-Set union for reads and deleted
      for (const id of partitionState.reads) merged.reads.add(id);
      for (const id of partitionState.deleted) merged.deleted.add(id);
      // Union for flags
      for (const [id, flags] of partitionState.flags) {
        const existing = merged.flags.get(id) || [];
        merged.flags.set(id, [...new Set([...existing, ...flags])]);
      }
      // LWW for folders (latest event wins)
      for (const [id, folder] of partitionState.folders) {
        merged.folders.set(id, folder);
      }
    }
    return merged;
  }

  /**
   * Publish updated mailbox state to relays (current month partition).
   *
   * Per DEC-013, the state payload is NIP-44-encrypted to the user's own
   * pubkey and stored in the event's `content` field. Only the `["d", "YYYY-MM"]`
   * partition tag is visible to relays.
   */
  async publishMailboxState(state: MailboxState): Promise<void> {
    if (!this.signer || !this.signer.nip44) return;

    const now = new Date();
    const partition = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const payload = payloadFromState(state);
    const encrypted = await this.signer.nip44.encrypt(this.pubkey, payload);

    const event = await this.signer.signEvent({
      kind: 30099,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', partition]],
      content: encrypted,
    });

    await Promise.allSettled(this.pool.publish(this.relays, event));
  }

  /** Decrypt and parse a kind 30099 mailbox state partition event. */
  private async parseStateFromEvent(event: any): Promise<MailboxState | null> {
    if (!this.signer?.nip44) return null;
    if (!event.content) {
      return { reads: new Set(), flags: new Map(), folders: new Map(), deleted: new Set() };
    }
    try {
      const json = await this.signer.nip44.decrypt(this.pubkey, event.content);
      return payloadToState(json);
    } catch (err) {
      console.warn('Failed to decrypt mailbox state partition:', err);
      return null;
    }
  }

  // ── Spam Policy (kind 10097) ─────────────────────────────────────────

  /** Publish a kind 10097 spam policy event (public, unencrypted). */
  async publishSpamPolicy(policy: {
    cashuMinSats: number;
    acceptedMints: string[];
    unknownAction: 'quarantine' | 'reject';
    contactsFree: boolean;
  }): Promise<void> {
    if (!this.signer) throw new Error('Not connected');

    const tags: string[][] = [
      ['cashu-min-sats', String(policy.cashuMinSats)],
      ['unknown-action', policy.unknownAction],
      ['contacts-free', policy.contactsFree ? 'true' : 'false'],
    ];
    for (const mint of policy.acceptedMints) {
      if (mint.trim()) tags.push(['accepted-mint', mint.trim()]);
    }

    const event = await this.signer.signEvent({
      kind: 10097,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    });

    await Promise.allSettled(this.pool.publish(this.relays, event));
  }

  // ── NIP-05 Resolution ────────────────────────────────────────────────

  /** Resolve a NIP-05 address to a hex pubkey. */
  async resolveNip05(address: string): Promise<string | null> {
    const [name, domain] = address.split('@');
    if (!name || !domain) return null;
    if (!/^[a-zA-Z0-9.-]+$/.test(domain)) return null;
    let url: URL;
    try {
      url = new URL(`https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`);
    } catch {
      return null;
    }
    if (url.hostname !== domain) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const resp = await fetch(url.toString(), { signal: controller.signal });
      if (!resp.ok) return null;
      const data = await resp.json();
      const pubkey = data?.names?.[name];
      if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(pubkey)) return null;
      return pubkey;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  disconnect(): void {
    if (this.subscriptionCloser) {
      this.subscriptionCloser();
      this.subscriptionCloser = null;
    }
    this.pool.close(this.relays);
    this.pool.close(this.inboxRelays);
    if (this.privkeyBytes) {
      this.privkeyBytes.fill(0);
      this.privkeyBytes = null;
    }
    this.signer = null;
    this.pubkey = '';
  }
}

function cryptoRandomUint32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomOffset(): number {
  const maxOffset = 172800; // +/- 2 days
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const normalized = (buf[0]! / 0x100000000) * 2 - 1;
  return Math.floor(normalized * maxOffset);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function computeEventId(event: any): Promise<string> {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

interface MailboxStatePayload {
  read: string[];
  flag: Record<string, string[]>;
  folder: Record<string, string>;
  deleted: string[];
}

function payloadFromState(state: MailboxState): string {
  const flag: Record<string, string[]> = {};
  for (const [id, list] of state.flags) {
    if (list.length > 0) flag[id] = list;
  }
  const folder: Record<string, string> = {};
  for (const [id, f] of state.folders) folder[id] = f;
  const payload: MailboxStatePayload = {
    read: [...state.reads],
    flag,
    folder,
    deleted: [...state.deleted],
  };
  return JSON.stringify(payload);
}

function payloadToState(json: string): MailboxState {
  const state: MailboxState = {
    reads: new Set(),
    flags: new Map(),
    folders: new Map(),
    deleted: new Set(),
  };
  let parsed: Partial<MailboxStatePayload>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return state;
  }
  if (Array.isArray(parsed.read)) {
    for (const id of parsed.read) if (typeof id === 'string') state.reads.add(id);
  }
  if (Array.isArray(parsed.deleted)) {
    for (const id of parsed.deleted) if (typeof id === 'string') state.deleted.add(id);
  }
  if (parsed.flag && typeof parsed.flag === 'object') {
    for (const [id, list] of Object.entries(parsed.flag)) {
      if (Array.isArray(list)) state.flags.set(id, list.filter(f => typeof f === 'string'));
    }
  }
  if (parsed.folder && typeof parsed.folder === 'object') {
    for (const [id, f] of Object.entries(parsed.folder)) {
      if (typeof f === 'string') state.folders.set(id, f);
    }
  }
  return state;
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const nostrMail = new NostrMailClient();
