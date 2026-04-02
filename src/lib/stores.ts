// ─── NOSTR Mail — Svelte Stores ──────────────────────────────────────────────
// Reactive state management for the NOSTR Mail client.
// All stores are writable and updated by the nostr-mail client library.

import { writable, derived, get } from 'svelte/store';
import type { ParsedMail, MailboxState, ProfileInfo } from './nostr-mail';

// ─── User Identity ───────────────────────────────────────────────────────────

export interface CurrentUser {
  pubkey: string;
  profile: ProfileInfo | null;
  relays: string[];
  inboxRelays: string[];
  npub: string;
}

export const currentUser = writable<CurrentUser | null>(null);

// ─── Inbox ───────────────────────────────────────────────────────────────────

/** All received mail messages, sorted by date (newest first). */
export const inbox = writable<ParsedMail[]>([]);

/** Add a new message to the inbox (deduplicates by ID). */
export function addToInbox(mail: ParsedMail): void {
  inbox.update(messages => {
    if (messages.some(m => m.id === mail.id)) return messages;
    return [mail, ...messages].sort((a, b) => b.createdAt - a.createdAt);
  });
}

/** Sent mail (messages where from.pubkey matches the current user). */
export const sentMail = writable<ParsedMail[]>([]);

export function addToSent(mail: ParsedMail): void {
  sentMail.update(messages => {
    if (messages.some(m => m.id === mail.id)) return messages;
    return [mail, ...messages].sort((a, b) => b.createdAt - a.createdAt);
  });
}

// ─── Contacts ────────────────────────────────────────────────────────────────

/** Set of pubkeys from the user's kind 3 contact list. */
export const contacts = writable<Set<string>>(new Set());

/** Cached profiles for display (pubkey -> ProfileInfo). */
export const profileCache = writable<Map<string, ProfileInfo>>(new Map());

export function cacheProfile(pubkey: string, profile: ProfileInfo): void {
  profileCache.update(cache => {
    const next = new Map(cache);
    next.set(pubkey, profile);
    return next;
  });
}

// ─── Selected Message / Thread ───────────────────────────────────────────────

/** Currently selected message for viewing. */
export const selectedMessage = writable<ParsedMail | null>(null);

/** Thread tree for the currently viewed conversation. */
export interface ThreadNode {
  message: ParsedMail;
  children: ThreadNode[];
}

export const selectedThread = writable<ThreadNode[]>([]);

// ─── Mailbox State ───────────────────────────────────────────────────────────

/** Reads, flags, folders, and deletes — synced via kind 10099. */
export const mailboxState = writable<MailboxState>({
  reads: new Set<string>(),
  flags: new Map<string, string[]>(),
  folders: new Map<string, string>(),
  deleted: new Set<string>(),
});

export function markAsRead(eventId: string): void {
  mailboxState.update(state => ({
    ...state,
    reads: new Set([...state.reads, eventId]),
  }));
}

export function toggleFlag(eventId: string, flag: string): void {
  mailboxState.update(state => {
    const newFlags = new Map(state.flags);
    const current = newFlags.get(eventId) || [];
    if (current.includes(flag)) {
      const updated = current.filter(f => f !== flag);
      if (updated.length === 0) newFlags.delete(eventId);
      else newFlags.set(eventId, updated);
    } else {
      newFlags.set(eventId, [...current, flag]);
    }
    return { ...state, flags: newFlags };
  });
}

export function moveToFolder(eventId: string, folder: string): void {
  mailboxState.update(state => {
    const newFolders = new Map(state.folders);
    newFolders.set(eventId, folder);
    return { ...state, folders: newFolders };
  });
}

export function markDeleted(eventId: string): void {
  mailboxState.update(state => ({
    ...state,
    deleted: new Set([...state.deleted, eventId]),
  }));
}

// ─── Connection Status ───────────────────────────────────────────────────────

export interface ConnectionStatus {
  connected: boolean;
  connectedRelays: string[];
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
}

export const connectionStatus = writable<ConnectionStatus>({
  connected: false,
  connectedRelays: [],
  syncing: false,
  lastSync: null,
  error: null,
});

// ─── Compose State ───────────────────────────────────────────────────────────

export interface ComposeDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
  replyTo?: string;
  threadId?: string;
}

export const composing = writable<ComposeDraft>({
  to: '',
  cc: '',
  subject: '',
  body: '',
});

export function resetCompose(): void {
  composing.set({ to: '', cc: '', subject: '', body: '' });
}

export function startReply(mail: ParsedMail): void {
  composing.set({
    to: mail.from.pubkey,
    cc: '',
    subject: mail.subject.startsWith('Re: ') ? mail.subject : `Re: ${mail.subject}`,
    body: '',
    replyTo: mail.id,
    threadId: mail.threadId || mail.id,
  });
}

// ─── Search ──────────────────────────────────────────────────────────────────

export const searchQuery = writable<string>('');

/** Derived store: inbox filtered by search query. */
export const filteredInbox = derived(
  [inbox, searchQuery, mailboxState],
  ([$inbox, $query, $state]) => {
    // Exclude deleted messages
    let messages = $inbox.filter(m => !$state.deleted.has(m.id));

    // Apply search filter
    if ($query.trim()) {
      const q = $query.toLowerCase();
      messages = messages.filter(m =>
        m.subject.toLowerCase().includes(q) ||
        m.body.toLowerCase().includes(q) ||
        m.from.pubkey.includes(q) ||
        (m.from.name || '').toLowerCase().includes(q) ||
        (m.from.nip05 || '').toLowerCase().includes(q)
      );
    }

    return messages;
  }
);

// ─── Thread Grouping ─────────────────────────────────────────────────────────

export interface ThreadSummary {
  threadId: string;
  subject: string;
  latestMessage: ParsedMail;
  messageCount: number;
  hasUnread: boolean;
  participants: string[];
}

/** Derived store: inbox grouped by threads for display. */
export const threadedInbox = derived(
  [filteredInbox, mailboxState],
  ([$messages, $state]) => {
    const threads = new Map<string, ParsedMail[]>();

    for (const msg of $messages) {
      const key = msg.threadId || msg.id;
      const existing = threads.get(key);
      if (existing) {
        existing.push(msg);
      } else {
        threads.set(key, [msg]);
      }
    }

    const summaries: ThreadSummary[] = [];
    for (const [threadId, msgs] of threads) {
      msgs.sort((a, b) => a.createdAt - b.createdAt);
      const latest = msgs[msgs.length - 1];
      const participants = [...new Set(msgs.map(m => m.from.pubkey))];
      const hasUnread = msgs.some(m => !$state.reads.has(m.id));

      summaries.push({
        threadId,
        subject: msgs[0].subject || '(no subject)',
        latestMessage: latest,
        messageCount: msgs.length,
        hasUnread,
        participants,
      });
    }

    // Sort by latest message timestamp, newest first
    summaries.sort((a, b) => b.latestMessage.createdAt - a.latestMessage.createdAt);
    return summaries;
  }
);

// ─── Active View ─────────────────────────────────────────────────────────────

export type ActiveView = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'contacts' | 'settings';

export const activeView = writable<ActiveView>('inbox');

// ─── Unread Count ────────────────────────────────────────────────────────────

export const unreadCount = derived(
  [inbox, mailboxState],
  ([$inbox, $state]) => {
    return $inbox.filter(m => !$state.reads.has(m.id) && !$state.deleted.has(m.id)).length;
  }
);
