<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import {
    inbox,
    mailboxState,
    markAsRead,
    toggleFlag,
    profileCache,
    composing,
  } from '$lib/stores';
  import { nostrMail } from '$lib/nostr-mail';
  import { onMount } from 'svelte';
  import type { ParsedMail } from '$lib/nostr-mail';

  $: threadId = $page.params.id;

  // Get all messages in this thread
  $: threadMessages = $inbox
    .filter(m => m.threadId === threadId || m.id === threadId)
    .sort((a, b) => a.createdAt - b.createdAt);

  $: subject = threadMessages.length > 0 ? threadMessages[0].subject : '(no subject)';

  // Mark all messages as read when viewing
  $: {
    for (const msg of threadMessages) {
      if (!$mailboxState.reads.has(msg.id)) {
        markAsRead(msg.id);
      }
    }
  }

  let replyBody = '';
  let showReply = false;
  let sending = false;

  function senderName(msg: ParsedMail): string {
    const cached = $profileCache.get(msg.from.pubkey);
    if (cached?.name || cached?.display_name) return cached.name || cached.display_name || '';
    if (msg.from.name) return msg.from.name;
    return msg.from.pubkey.slice(0, 12) + '...';
  }

  function senderInitial(msg: ParsedMail): string {
    return senderName(msg)[0]?.toUpperCase() || '?';
  }

  function formatDateTime(ts: number): string {
    const date = new Date(ts * 1000);
    return date.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatBody(body: string): string {
    // Basic markdown-like rendering: paragraphs, bold, italic, code
    return body
      .split('\n\n')
      .map(p => `<p class="mb-3">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function handleReply() {
    showReply = true;
  }

  function handleReplyAll() {
    const lastMsg = threadMessages[threadMessages.length - 1];
    if (!lastMsg) return;

    composing.set({
      to: lastMsg.from.pubkey,
      cc: lastMsg.to.map(r => r.pubkey).join(', '),
      subject: subject.startsWith('Re: ') ? subject : `Re: ${subject}`,
      body: '',
      replyTo: lastMsg.id,
      threadId: threadId,
    });
    goto('/compose');
  }

  function handleForward() {
    const lastMsg = threadMessages[threadMessages.length - 1];
    if (!lastMsg) return;

    const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${senderName(lastMsg)}\nDate: ${formatDateTime(lastMsg.createdAt)}\nSubject: ${lastMsg.subject}\n\n${lastMsg.body}`;

    composing.set({
      to: '',
      cc: '',
      subject: subject.startsWith('Fwd: ') ? subject : `Fwd: ${subject}`,
      body: fwdBody,
    });
    goto('/compose');
  }

  async function sendReply() {
    if (!replyBody.trim()) return;
    sending = true;

    const lastMsg = threadMessages[threadMessages.length - 1];
    if (!lastMsg) { sending = false; return; }

    try {
      await nostrMail.sendMail({
        to: [lastMsg.from.pubkey],
        subject: subject.startsWith('Re: ') ? subject : `Re: ${subject}`,
        body: replyBody,
        replyTo: lastMsg.id,
        threadId: threadId,
      });
      replyBody = '';
      showReply = false;
    } catch (err) {
      console.error('Failed to send reply:', err);
    } finally {
      sending = false;
    }
  }

  function handleStarToggle(msgId: string) {
    toggleFlag(msgId, 'starred');
  }
</script>

<svelte:head>
  <title>{subject} - NOSTR Mail</title>
</svelte:head>

<div class="max-w-3xl mx-auto p-4 sm:p-6">
  <!-- Back + Thread header -->
  <div class="mb-6">
    <button
      on:click={() => goto('/')}
      class="flex items-center gap-1 text-sm text-mail-muted hover:text-gray-700 mb-3 transition-colors"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Back to Inbox
    </button>

    <div class="flex items-start justify-between gap-4">
      <h1 class="text-xl font-semibold text-gray-900">{subject}</h1>
      <div class="flex items-center gap-2 shrink-0">
        <span class="text-xs text-mail-muted bg-gray-100 px-2 py-1 rounded">
          {threadMessages.length} message{threadMessages.length !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  </div>

  <!-- Messages -->
  {#if threadMessages.length === 0}
    <div class="text-center py-12 text-mail-muted">
      <p>Thread not found or still loading.</p>
      <button on:click={() => goto('/')} class="btn-secondary text-sm mt-4">Back to Inbox</button>
    </div>
  {:else}
    <div class="space-y-4">
      {#each threadMessages as msg, i (msg.id)}
        <div class="bg-white rounded-xl border border-mail-border shadow-sm overflow-hidden">
          <!-- Message header -->
          <div class="flex items-start gap-3 p-4 border-b border-mail-border">
            <!-- Avatar -->
            <div class="w-10 h-10 rounded-full bg-mail-accent flex items-center justify-center text-white text-sm font-bold shrink-0">
              {senderInitial(msg)}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium text-sm text-gray-900">{senderName(msg)}</span>
                <div class="flex items-center gap-2 shrink-0">
                  <span class="text-xs text-mail-muted">{formatDateTime(msg.createdAt)}</span>
                  <!-- Star -->
                  <button
                    on:click={() => handleStarToggle(msg.id)}
                    class="text-gray-300 hover:text-yellow-400 transition-colors"
                    title="Star message"
                  >
                    <svg class="w-4 h-4 {($mailboxState.flags.get(msg.id) || []).includes('starred') ? 'text-yellow-400 fill-current' : ''}"
                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </button>
                </div>
              </div>
              <p class="text-xs text-mail-muted truncate">
                To: {msg.to.map(r => r.pubkey.slice(0, 8) + '...').join(', ')}
                {#if msg.cc.length > 0}
                  &nbsp;| CC: {msg.cc.map(r => r.pubkey.slice(0, 8) + '...').join(', ')}
                {/if}
              </p>
            </div>
          </div>

          <!-- Message body -->
          <div class="p-4 text-sm text-gray-700 leading-relaxed prose-sm">
            {@html formatBody(msg.body)}
          </div>

          <!-- Attachments -->
          {#if msg.attachments.length > 0}
            <div class="px-4 pb-4">
              <p class="text-xs text-mail-muted mb-2">Attachments ({msg.attachments.length})</p>
              <div class="flex flex-wrap gap-2">
                {#each msg.attachments as att}
                  <div class="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border border-mail-border text-sm">
                    <svg class="w-4 h-4 text-mail-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <span class="text-gray-700">{att.filename}</span>
                    <span class="text-xs text-mail-muted">
                      ({Math.round(att.size / 1024)}KB)
                    </span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Cashu postage indicator -->
          {#if msg.cashuPostage}
            <div class="px-4 pb-3">
              <span class="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {msg.cashuPostage.amount} sat postage
              </span>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Thread action buttons -->
    <div class="flex items-center gap-3 mt-6">
      <button on:click={handleReply} class="btn-primary text-sm flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
        Reply
      </button>
      <button on:click={handleReplyAll} class="btn-secondary text-sm flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
        Reply All
      </button>
      <button on:click={handleForward} class="btn-secondary text-sm flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" />
        </svg>
        Forward
      </button>
    </div>

    <!-- Inline reply -->
    {#if showReply}
      <div class="mt-4 bg-white rounded-xl border border-mail-border shadow-sm overflow-hidden">
        <div class="px-4 py-3 border-b border-mail-border bg-gray-50">
          <p class="text-sm text-mail-muted">Replying to this thread</p>
        </div>
        <div class="p-4">
          <textarea
            placeholder="Write your reply..."
            class="w-full min-h-[150px] text-sm border border-mail-border rounded-lg p-3
                   focus:outline-none focus:ring-2 focus:ring-mail-accent resize-none"
            bind:value={replyBody}
          />
        </div>
        <div class="flex items-center justify-between px-4 py-3 border-t border-mail-border bg-gray-50">
          <button
            on:click={() => { showReply = false; replyBody = ''; }}
            class="text-sm text-mail-muted hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            on:click={sendReply}
            disabled={sending || !replyBody.trim()}
            class="btn-primary text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {#if sending}
              Sending...
            {:else}
              Send Reply
            {/if}
          </button>
        </div>
      </div>
    {/if}
  {/if}
</div>
