<script lang="ts">
  import { goto } from '$app/navigation';
  import { composing, currentUser, contacts, profileCache, addToSent } from '$lib/stores';
  import { nostrMail } from '$lib/nostr-mail';
  import type { ParsedMail } from '$lib/nostr-mail';

  let sending = false;
  let error = '';
  let showCc = false;
  let nip05Resolving = false;
  let nip05Results: { address: string; pubkey: string }[] = [];

  // Reactive draft bound to the composing store
  let to = $composing.to;
  let cc = $composing.cc;
  let subject = $composing.subject;
  let body = $composing.body;
  let replyTo = $composing.replyTo;
  let threadId = $composing.threadId;

  // Initialize CC section if replying
  $: if (cc) showCc = true;

  async function resolveRecipient(input: string): Promise<string | null> {
    const trimmed = input.trim();
    // Already a hex pubkey
    if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed;
    // npub
    if (trimmed.startsWith('npub1')) {
      try {
        const { nip19 } = await import('nostr-tools/nip19');
        const decoded = nip19.decode(trimmed);
        if (decoded.type === 'npub') return decoded.data as string;
      } catch { /* fall through */ }
    }
    // NIP-05
    if (trimmed.includes('@')) {
      return nostrMail.resolveNip05(trimmed);
    }
    return null;
  }

  async function handleNip05Input(value: string) {
    if (!value.includes('@') || value.length < 5) {
      nip05Results = [];
      return;
    }
    nip05Resolving = true;
    const pubkey = await nostrMail.resolveNip05(value);
    nip05Resolving = false;
    if (pubkey) {
      nip05Results = [{ address: value, pubkey }];
    } else {
      nip05Results = [];
    }
  }

  function selectNip05(result: { address: string; pubkey: string }) {
    to = result.pubkey;
    nip05Results = [];
  }

  async function handleSend() {
    if (!to.trim()) { error = 'Recipient is required'; return; }
    if (!subject.trim()) { error = 'Subject is required'; return; }
    if (!body.trim()) { error = 'Message body is required'; return; }

    error = '';
    sending = true;

    try {
      // Resolve all recipients
      const toAddresses = to.split(',').map(s => s.trim()).filter(Boolean);
      const resolvedTo: string[] = [];
      for (const addr of toAddresses) {
        const pubkey = await resolveRecipient(addr);
        if (!pubkey) {
          error = `Could not resolve recipient: ${addr}`;
          sending = false;
          return;
        }
        resolvedTo.push(pubkey);
      }

      let resolvedCc: string[] = [];
      if (cc.trim()) {
        const ccAddresses = cc.split(',').map(s => s.trim()).filter(Boolean);
        for (const addr of ccAddresses) {
          const pubkey = await resolveRecipient(addr);
          if (!pubkey) {
            error = `Could not resolve CC recipient: ${addr}`;
            sending = false;
            return;
          }
          resolvedCc.push(pubkey);
        }
      }

      await nostrMail.sendMail({
        to: resolvedTo,
        cc: resolvedCc.length > 0 ? resolvedCc : undefined,
        subject,
        body,
        replyTo,
        threadId,
      });

      // Clear draft and navigate back
      composing.set({ to: '', cc: '', subject: '', body: '' });
      goto('/');
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to send message';
    } finally {
      sending = false;
    }
  }

  function handleDiscard() {
    composing.set({ to: '', cc: '', subject: '', body: '' });
    goto('/');
  }

  function handleKeydown(e: KeyboardEvent) {
    // Ctrl/Cmd + Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }
</script>

<svelte:head>
  <title>Compose - NOSTR Mail</title>
</svelte:head>

<div class="max-w-3xl mx-auto p-4 sm:p-6">
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <h2 class="text-xl font-semibold text-gray-900">
      {#if replyTo}
        Reply
      {:else}
        New Message
      {/if}
    </h2>
    <button
      on:click={handleDiscard}
      class="text-sm text-mail-muted hover:text-gray-700 transition-colors"
    >
      Discard
    </button>
  </div>

  <!-- Error banner -->
  {#if error}
    <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
      {error}
    </div>
  {/if}

  <!-- Compose form -->
  <div class="bg-white rounded-xl border border-mail-border shadow-sm" on:keydown={handleKeydown}>
    <!-- To field -->
    <div class="flex items-center border-b border-mail-border px-4 py-2.5 gap-2">
      <label for="to" class="text-sm font-medium text-mail-muted w-10">To</label>
      <div class="flex-1 relative">
        <input
          id="to"
          type="text"
          placeholder="npub, NIP-05 address, or hex pubkey"
          class="w-full text-sm border-0 focus:outline-none focus:ring-0 p-0 bg-transparent"
          bind:value={to}
          on:input={(e) => handleNip05Input(e.currentTarget.value)}
        />
        <!-- NIP-05 autocomplete dropdown -->
        {#if nip05Results.length > 0}
          <div class="absolute top-full left-0 mt-1 w-full bg-white border border-mail-border rounded-lg shadow-lg z-10">
            {#each nip05Results as result}
              <button
                class="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                on:click={() => selectNip05(result)}
              >
                <span class="font-medium">{result.address}</span>
                <span class="text-mail-muted ml-2">{result.pubkey.slice(0, 12)}...</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if nip05Resolving}
          <span class="absolute right-0 top-1/2 -translate-y-1/2 text-xs text-mail-muted">Resolving...</span>
        {/if}
      </div>
      {#if !showCc}
        <button
          class="text-xs text-mail-accent hover:text-mail-accent-hover"
          on:click={() => showCc = true}
        >
          CC
        </button>
      {/if}
    </div>

    <!-- CC field (expandable) -->
    {#if showCc}
      <div class="flex items-center border-b border-mail-border px-4 py-2.5 gap-2">
        <label for="cc" class="text-sm font-medium text-mail-muted w-10">CC</label>
        <input
          id="cc"
          type="text"
          placeholder="Additional recipients (comma-separated)"
          class="flex-1 text-sm border-0 focus:outline-none focus:ring-0 p-0 bg-transparent"
          bind:value={cc}
        />
      </div>
    {/if}

    <!-- Subject field -->
    <div class="flex items-center border-b border-mail-border px-4 py-2.5 gap-2">
      <label for="subject" class="text-sm font-medium text-mail-muted w-10">Subj</label>
      <input
        id="subject"
        type="text"
        placeholder="Subject"
        class="flex-1 text-sm border-0 focus:outline-none focus:ring-0 p-0 bg-transparent"
        bind:value={subject}
      />
    </div>

    <!-- Body -->
    <div class="p-4">
      <textarea
        placeholder="Write your message... (Markdown supported)"
        class="w-full min-h-[300px] text-sm border-0 focus:outline-none focus:ring-0 p-0
               bg-transparent resize-none leading-relaxed"
        bind:value={body}
      />
    </div>

    <!-- Footer / Actions -->
    <div class="flex items-center justify-between px-4 py-3 border-t border-mail-border bg-gray-50 rounded-b-xl">
      <div class="flex items-center gap-2">
        <!-- Attachment button -->
        <button
          class="p-2 rounded-lg hover:bg-gray-200 text-mail-muted transition-colors"
          title="Attach file (Blossom)"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>

        <!-- Format hint -->
        <span class="text-xs text-gray-400">Markdown supported</span>
      </div>

      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-400">
          Ctrl+Enter to send
        </span>
        <button
          on:click={handleSend}
          disabled={sending}
          class="btn-primary text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {#if sending}
            <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Sending...
          {:else}
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
            Send
          {/if}
        </button>
      </div>
    </div>
  </div>

  <!-- Encryption notice -->
  <div class="mt-4 flex items-center gap-2 text-xs text-mail-muted">
    <svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
    <span>End-to-end encrypted with NIP-44. Gift-wrapped with NIP-59 for metadata protection.</span>
  </div>
</div>
