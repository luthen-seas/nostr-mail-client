<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    currentUser,
    threadedInbox,
    mailboxState,
    profileCache,
    markAsRead,
    searchQuery,
    unreadCount,
    connectionStatus,
    inbox,
    addToInbox,
    activeView,
  } from '$lib/stores';
  import { nostrMail } from '$lib/nostr-mail';
  import { onMount, onDestroy } from 'svelte';
  import type { ThreadSummary } from '$lib/stores';

  let loading = true;
  let closeSubscription: (() => void) | null = null;

  onMount(async () => {
    // Redirect to onboarding if not connected
    if (!$currentUser) {
      goto('/onboarding');
      return;
    }

    loading = true;
    connectionStatus.update(s => ({ ...s, syncing: true }));

    try {
      // Fetch existing inbox
      const wraps = await nostrMail.fetchInbox();
      for (const wrap of wraps) {
        const mail = await nostrMail.unwrapMail(wrap);
        if (mail) {
          if (mail.from.pubkey === $currentUser?.pubkey) {
            // Self-copy = sent mail
          } else {
            addToInbox(mail);
          }

          // Fetch sender profile
          if (!$profileCache.has(mail.from.pubkey)) {
            nostrMail.fetchProfile(mail.from.pubkey).then(profile => {
              if (profile) {
                mail.from.name = profile.name || profile.display_name;
                mail.from.nip05 = profile.nip05;
                profileCache.update(c => {
                  const next = new Map(c);
                  next.set(mail.from.pubkey, profile);
                  return next;
                });
              }
            });
          }
        }
      }

      // Fetch mailbox state
      const state = await nostrMail.fetchMailboxState();
      mailboxState.set(state);

      // Subscribe to new messages
      closeSubscription = nostrMail.subscribeInbox(async (wrapEvent) => {
        const mail = await nostrMail.unwrapMail(wrapEvent);
        if (mail) {
          addToInbox(mail);
          // Fetch profile for new sender
          if (!$profileCache.has(mail.from.pubkey)) {
            const profile = await nostrMail.fetchProfile(mail.from.pubkey);
            if (profile) {
              mail.from.name = profile.name || profile.display_name;
              profileCache.update(c => {
                const next = new Map(c);
                next.set(mail.from.pubkey, profile);
                return next;
              });
            }
          }
        }
      });

      connectionStatus.update(s => ({
        ...s,
        connected: true,
        syncing: false,
        lastSync: Date.now(),
        connectedRelays: nostrMail.currentInboxRelays,
      }));
    } catch (err) {
      connectionStatus.update(s => ({
        ...s,
        syncing: false,
        error: err instanceof Error ? err.message : 'Failed to load inbox',
      }));
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    if (closeSubscription) closeSubscription();
  });

  function openThread(thread: ThreadSummary) {
    markAsRead(thread.latestMessage.id);
    goto(`/thread/${thread.threadId}`);
  }

  function formatTime(ts: number): string {
    const date = new Date(ts * 1000);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 86400000 && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diff < 604800000) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function senderName(thread: ThreadSummary): string {
    const pubkey = thread.latestMessage.from.pubkey;
    const cached = $profileCache.get(pubkey);
    if (cached?.name || cached?.display_name) return cached.name || cached.display_name || '';
    if (thread.latestMessage.from.name) return thread.latestMessage.from.name;
    return pubkey.slice(0, 8) + '...';
  }

  function senderInitial(thread: ThreadSummary): string {
    const name = senderName(thread);
    return name[0]?.toUpperCase() || '?';
  }

  function preview(thread: ThreadSummary): string {
    const body = thread.latestMessage.body;
    if (body.length > 120) return body.slice(0, 120) + '...';
    return body;
  }
</script>

<svelte:head>
  <title>Inbox {$unreadCount > 0 ? `(${$unreadCount})` : ''} - NOSTR Mail</title>
</svelte:head>

<div class="h-full">
  {#if loading}
    <!-- Loading state -->
    <div class="flex items-center justify-center h-64">
      <div class="text-center">
        <svg class="w-8 h-8 text-mail-accent animate-spin mx-auto mb-3" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p class="text-sm text-mail-muted">Loading inbox...</p>
        <p class="text-xs text-gray-400 mt-1">Decrypting messages from relays</p>
      </div>
    </div>

  {:else if $threadedInbox.length === 0}
    <!-- Empty state -->
    <div class="flex items-center justify-center h-64">
      <div class="text-center">
        <svg class="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
                d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
        <h3 class="text-lg font-medium text-gray-600 mb-1">Your inbox is empty</h3>
        <p class="text-sm text-mail-muted mb-4">
          {#if $searchQuery}
            No messages match your search.
          {:else}
            No messages yet. Send one to get started!
          {/if}
        </p>
        <a href="/compose" class="btn-primary text-sm">Compose a message</a>
      </div>
    </div>

  {:else}
    <!-- Thread list -->
    <div class="divide-y divide-mail-border">
      {#each $threadedInbox as thread (thread.threadId)}
        <button
          class="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start gap-3
                 {thread.hasUnread ? 'bg-blue-50/50' : ''}"
          on:click={() => openThread(thread)}
        >
          <!-- Avatar -->
          <div class="shrink-0 mt-0.5">
            <div
              class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white
                     {thread.hasUnread ? 'bg-mail-accent' : 'bg-gray-400'}"
            >
              {senderInitial(thread)}
            </div>
          </div>

          <!-- Content -->
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2 mb-0.5">
              <span class="text-sm truncate {thread.hasUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}">
                {senderName(thread)}
                {#if thread.messageCount > 1}
                  <span class="text-xs text-mail-muted font-normal">({thread.messageCount})</span>
                {/if}
              </span>
              <span class="text-xs text-mail-muted shrink-0">
                {formatTime(thread.latestMessage.createdAt)}
              </span>
            </div>
            <p class="text-sm truncate {thread.hasUnread ? 'font-medium text-gray-900' : 'text-gray-700'}">
              {thread.subject}
            </p>
            <p class="text-xs text-mail-muted truncate mt-0.5">
              {preview(thread)}
            </p>
          </div>

          <!-- Unread indicator -->
          {#if thread.hasUnread}
            <div class="shrink-0 mt-2">
              <div class="w-2.5 h-2.5 rounded-full bg-mail-unread" />
            </div>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
