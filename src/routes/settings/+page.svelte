<script lang="ts">
  import { goto } from '$app/navigation';
  import {
    currentUser,
    connectionStatus,
    contacts,
    mailboxState,
  } from '$lib/stores';
  import { nostrMail, DEFAULT_RELAYS, DEFAULT_INBOX_RELAYS } from '$lib/nostr-mail';

  // ─── Identity section ──────────────────────────────────────────────

  $: pubkey = $currentUser?.pubkey || '';
  $: npub = $currentUser?.npub || '';
  $: profile = $currentUser?.profile;
  $: nip05 = profile?.nip05 || '';

  // ─── Relays ────────────────────────────────────────────────────────

  $: inboxRelays = $currentUser?.inboxRelays || DEFAULT_INBOX_RELAYS;
  $: generalRelays = $currentUser?.relays || DEFAULT_RELAYS;

  // ─── Spam policy ───────────────────────────────────────────────────

  let postageThreshold = 10;
  let acceptedMints = 'https://mint.minibits.cash';
  let contactsFree = true;
  let unknownAction: 'quarantine' | 'reject' = 'quarantine';

  // ─── Stats ─────────────────────────────────────────────────────────

  $: contactCount = $contacts.size;
  $: readCount = $mailboxState.reads.size;
  $: connectedRelayCount = $connectionStatus.connectedRelays.length;

  // ─── Actions ───────────────────────────────────────────────────────

  let copied = false;

  async function copyNpub() {
    if (npub) {
      await navigator.clipboard.writeText(npub);
      copied = true;
      setTimeout(() => copied = false, 2000);
    }
  }

  function handleLogout() {
    nostrMail.disconnect();
    currentUser.set(null);
    goto('/onboarding');
  }

  let savingPolicy = false;

  async function saveSpamPolicy() {
    // In a full implementation, this would publish a kind 10097 event
    savingPolicy = true;
    setTimeout(() => { savingPolicy = false; }, 1000);
  }

  let syncingState = false;

  async function syncMailboxState() {
    syncingState = true;
    try {
      await nostrMail.publishMailboxState($mailboxState);
    } catch (err) {
      console.error('Failed to sync state:', err);
    } finally {
      syncingState = false;
    }
  }
</script>

<svelte:head>
  <title>Settings - NOSTR Mail</title>
</svelte:head>

<div class="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
  <h1 class="text-2xl font-semibold text-gray-900">Settings</h1>

  <!-- ═══ Identity ═══ -->
  <section class="bg-white rounded-xl border border-mail-border shadow-sm overflow-hidden">
    <div class="px-5 py-4 border-b border-mail-border bg-gray-50">
      <h2 class="font-medium text-gray-900">Identity</h2>
    </div>
    <div class="p-5 space-y-4">
      <!-- Profile -->
      <div class="flex items-center gap-4">
        <div class="w-14 h-14 rounded-full bg-mail-accent flex items-center justify-center text-white text-xl font-bold shrink-0">
          {(profile?.name || 'U')[0].toUpperCase()}
        </div>
        <div class="min-w-0">
          <p class="font-medium text-gray-900">{profile?.name || profile?.display_name || 'Anonymous'}</p>
          {#if nip05}
            <p class="text-sm text-green-600 flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {nip05}
            </p>
          {/if}
          {#if profile?.about}
            <p class="text-xs text-mail-muted mt-1 truncate">{profile.about}</p>
          {/if}
        </div>
      </div>

      <!-- Public key -->
      <div>
        <label class="text-sm font-medium text-gray-700 block mb-1">Public Key (npub)</label>
        <div class="flex items-center gap-2">
          <input type="text" readonly value={npub} class="input-field font-mono text-xs flex-1" />
          <button on:click={copyNpub} class="btn-secondary text-sm shrink-0">
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <!-- Hex pubkey -->
      <div>
        <label class="text-sm font-medium text-gray-700 block mb-1">Hex Public Key</label>
        <input type="text" readonly value={pubkey} class="input-field font-mono text-xs" />
      </div>
    </div>
  </section>

  <!-- ═══ Relays ═══ -->
  <section class="bg-white rounded-xl border border-mail-border shadow-sm overflow-hidden">
    <div class="px-5 py-4 border-b border-mail-border bg-gray-50">
      <h2 class="font-medium text-gray-900">Relays</h2>
    </div>
    <div class="p-5 space-y-5">
      <!-- Inbox relays -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-medium text-gray-700">
            Inbox Relays
            <span class="text-xs text-mail-muted font-normal">(kind 10050)</span>
          </label>
          <span class="text-xs text-mail-muted">{inboxRelays.length} relay{inboxRelays.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="space-y-2">
          {#each inboxRelays as relay}
            <div class="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-sm font-mono">
              <div class="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span class="text-gray-700 truncate">{relay}</span>
            </div>
          {/each}
        </div>
        <p class="text-xs text-mail-muted mt-2">
          Where your encrypted mail is delivered. Published in your kind 10050 event.
        </p>
      </div>

      <!-- General relays -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="text-sm font-medium text-gray-700">
            General Relays
            <span class="text-xs text-mail-muted font-normal">(kind 10002)</span>
          </label>
          <span class="text-xs text-mail-muted">{generalRelays.length} relay{generalRelays.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="space-y-2">
          {#each generalRelays as relay}
            <div class="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-sm font-mono">
              <div class="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <span class="text-gray-700 truncate">{relay}</span>
            </div>
          {/each}
        </div>
        <p class="text-xs text-mail-muted mt-2">
          Used for profile lookups, contact lists, and relay discovery (NIP-65 outbox model).
        </p>
      </div>
    </div>
  </section>

  <!-- ═══ Spam Policy ═══ -->
  <section class="bg-white rounded-xl border border-mail-border shadow-sm overflow-hidden">
    <div class="px-5 py-4 border-b border-mail-border bg-gray-50">
      <h2 class="font-medium text-gray-900">Spam Policy</h2>
      <p class="text-xs text-mail-muted mt-0.5">Published as kind 10097 for senders to discover</p>
    </div>
    <div class="p-5 space-y-4">
      <!-- Trust bypasses -->
      <div>
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" bind:checked={contactsFree}
                 class="w-4 h-4 rounded border-gray-300 text-mail-accent focus:ring-mail-accent" />
          <div>
            <p class="text-sm font-medium text-gray-700">Contacts bypass all checks</p>
            <p class="text-xs text-mail-muted">Kind 3 follows get free delivery</p>
          </div>
        </label>
      </div>

      <!-- Postage threshold -->
      <div>
        <label class="text-sm font-medium text-gray-700 block mb-1">
          Cashu Postage Threshold
          <span class="text-xs text-mail-muted font-normal">({postageThreshold} sats minimum)</span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          bind:value={postageThreshold}
          class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-mail-accent"
        />
        <div class="flex justify-between text-xs text-mail-muted mt-1">
          <span>0 (free)</span>
          <span>100 sats</span>
        </div>
      </div>

      <!-- Accepted mints -->
      <div>
        <label class="text-sm font-medium text-gray-700 block mb-1">Accepted Cashu Mints</label>
        <input
          type="text"
          placeholder="Mint URLs (comma-separated)"
          class="input-field text-sm"
          bind:value={acceptedMints}
        />
      </div>

      <!-- Unknown action -->
      <div>
        <label class="text-sm font-medium text-gray-700 block mb-1">Unknown Sender Action</label>
        <select bind:value={unknownAction} class="input-field text-sm">
          <option value="quarantine">Quarantine (review later)</option>
          <option value="reject">Reject (discard silently)</option>
        </select>
      </div>

      <button
        on:click={saveSpamPolicy}
        disabled={savingPolicy}
        class="btn-primary text-sm"
      >
        {savingPolicy ? 'Publishing...' : 'Publish Spam Policy'}
      </button>
    </div>
  </section>

  <!-- ═══ Key Management ═══ -->
  <section class="bg-white rounded-xl border border-mail-border shadow-sm overflow-hidden">
    <div class="px-5 py-4 border-b border-mail-border bg-gray-50">
      <h2 class="font-medium text-gray-900">Key Management</h2>
    </div>
    <div class="p-5 space-y-4">
      <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <p class="text-sm text-amber-800">
          Your signing key is managed by your NIP-07 browser extension. NOSTR Mail never has direct
          access to your private key when using extension-based signing.
        </p>
      </div>

      <div class="flex items-center gap-3">
        <button on:click={syncMailboxState} disabled={syncingState} class="btn-secondary text-sm">
          {syncingState ? 'Syncing...' : 'Sync Mailbox State to Relays'}
        </button>
        <span class="text-xs text-mail-muted">Publishes read/flag/folder state (kind 30099, monthly partitions)</span>
      </div>
    </div>
  </section>

  <!-- ═══ About ═══ -->
  <section class="bg-white rounded-xl border border-mail-border shadow-sm overflow-hidden">
    <div class="px-5 py-4 border-b border-mail-border bg-gray-50">
      <h2 class="font-medium text-gray-900">About</h2>
    </div>
    <div class="p-5 space-y-3">
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p class="text-mail-muted">Version</p>
          <p class="font-medium">0.1.0 (Reference Client)</p>
        </div>
        <div>
          <p class="text-mail-muted">Protocol</p>
          <p class="font-medium">NOSTR Mail (NIP-17/59/44)</p>
        </div>
        <div>
          <p class="text-mail-muted">Contacts</p>
          <p class="font-medium">{contactCount}</p>
        </div>
        <div>
          <p class="text-mail-muted">Messages Read</p>
          <p class="font-medium">{readCount}</p>
        </div>
        <div>
          <p class="text-mail-muted">Connected Relays</p>
          <p class="font-medium">{connectedRelayCount}</p>
        </div>
        <div>
          <p class="text-mail-muted">Last Sync</p>
          <p class="font-medium">
            {$connectionStatus.lastSync ? new Date($connectionStatus.lastSync).toLocaleTimeString() : 'Never'}
          </p>
        </div>
      </div>

      <div class="pt-3 border-t border-mail-border space-y-2">
        <p class="text-xs text-mail-muted">
          <strong>Specification:</strong> nostr-protocol/nips (NIP-17, NIP-44, NIP-59)
        </p>
        <p class="text-xs text-mail-muted">
          <strong>Library:</strong> nostr-tools v2.10+
        </p>
        <p class="text-xs text-mail-muted">
          <strong>Source:</strong> Reference implementation for the NOSTR Mail protocol
        </p>
      </div>
    </div>
  </section>

  <!-- Logout -->
  <div class="flex justify-center pt-2 pb-8">
    <button
      on:click={handleLogout}
      class="text-sm text-red-600 hover:text-red-700 font-medium transition-colors"
    >
      Disconnect and Log Out
    </button>
  </div>
</div>
