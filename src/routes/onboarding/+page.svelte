<script lang="ts">
  import { goto } from '$app/navigation';
  import { currentUser, connectionStatus, contacts } from '$lib/stores';
  import { nostrMail, DEFAULT_RELAYS, DEFAULT_INBOX_RELAYS } from '$lib/nostr-mail';
  import * as nip19 from 'nostr-tools/nip19';

  let step = 1;
  let error = '';
  let loading = false;

  // Step 1 state
  let loginMethod: 'extension' | 'nsec' | null = null;
  let nsecInput = '';
  let hasExtension = false;

  // Step 2 state
  let nip05Address = '';
  let profile: any = null;

  // Step 3 state
  let inboxRelays: string[] = [];
  let generalRelays: string[] = [];

  // Check for NIP-07 extension on mount
  import { onMount } from 'svelte';

  onMount(() => {
    // Check if window.nostr is available (NIP-07)
    hasExtension = !!(window as any).nostr;
  });

  async function connectExtension() {
    error = '';
    loading = true;
    try {
      const pubkey = await nostrMail.connectWithExtension();
      await finishStep1(pubkey);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to connect extension';
    } finally {
      loading = false;
    }
  }

  async function connectNsec() {
    if (!nsecInput.trim()) {
      error = 'Please enter your nsec or hex private key';
      return;
    }
    error = '';
    loading = true;
    try {
      const pubkey = await nostrMail.connectWithNsec(nsecInput);
      await finishStep1(pubkey);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Invalid key';
    } finally {
      loading = false;
    }
  }

  async function finishStep1(pubkey: string) {
    const npub = nip19.npubEncode(pubkey);

    // Fetch profile
    profile = await nostrMail.fetchProfile(pubkey);
    nip05Address = profile?.nip05 || '';

    // Set relays from loaded data
    generalRelays = nostrMail.currentRelays.length > 0 ? nostrMail.currentRelays : DEFAULT_RELAYS;
    inboxRelays = nostrMail.currentInboxRelays.length > 0 ? nostrMail.currentInboxRelays : DEFAULT_INBOX_RELAYS;

    currentUser.set({
      pubkey,
      profile,
      relays: generalRelays,
      inboxRelays,
      npub,
    });

    // Fetch contacts
    const contactSet = await nostrMail.fetchContacts();
    contacts.set(contactSet);

    connectionStatus.set({
      connected: true,
      connectedRelays: generalRelays,
      syncing: false,
      lastSync: Date.now(),
      error: null,
    });

    step = 2;
  }

  function goToStep3() {
    step = 3;
  }

  function goToInbox() {
    step = 4;
    // Brief pause to show the success state, then redirect
    setTimeout(() => goto('/'), 1500);
  }

  function truncatePubkey(pk: string): string {
    return pk.slice(0, 12) + '...' + pk.slice(-8);
  }
</script>

<svelte:head>
  <title>Welcome - NOSTR Mail</title>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 flex items-center justify-center p-4">
  <div class="w-full max-w-lg">
    <!-- Header -->
    <div class="text-center mb-8">
      <h1 class="text-3xl font-bold text-gray-900 mb-2">NOSTR Mail</h1>
      <p class="text-mail-muted">Encrypted, sovereign email on NOSTR</p>
    </div>

    <!-- Step indicators -->
    <div class="flex items-center justify-center gap-2 mb-8">
      {#each [1, 2, 3, 4] as s}
        <div class="flex items-center">
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors
                   {step >= s ? 'bg-mail-accent text-white' : 'bg-gray-200 text-gray-500'}"
          >
            {#if step > s}
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            {:else}
              {s}
            {/if}
          </div>
          {#if s < 4}
            <div class="w-12 h-0.5 {step > s ? 'bg-mail-accent' : 'bg-gray-200'}" />
          {/if}
        </div>
      {/each}
    </div>

    <!-- Card -->
    <div class="bg-white rounded-2xl shadow-lg border border-mail-border p-6 sm:p-8">

      <!-- ═══ STEP 1: Connect Identity ═══ -->
      {#if step === 1}
        <h2 class="text-xl font-semibold text-gray-900 mb-2">Connect your NOSTR identity</h2>
        <p class="text-sm text-mail-muted mb-6">
          Sign in with your NOSTR keypair. Your keys never leave your device.
        </p>

        {#if error}
          <div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        {/if}

        <!-- NIP-07 Extension Option -->
        <button
          on:click={connectExtension}
          disabled={loading || !hasExtension}
          class="w-full mb-3 p-4 rounded-xl border-2 transition-all text-left flex items-center gap-4
                 {hasExtension ? 'border-mail-border hover:border-mail-accent cursor-pointer' : 'border-gray-100 opacity-50 cursor-not-allowed'}"
        >
          <div class="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
            <svg class="w-6 h-6 text-mail-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <p class="font-medium text-gray-900">Browser Extension (NIP-07)</p>
            <p class="text-xs text-mail-muted mt-0.5">
              {hasExtension ? 'nos2x, Alby, or similar detected' : 'No extension detected. Install nos2x or Alby.'}
            </p>
          </div>
          {#if loading && loginMethod === 'extension'}
            <svg class="w-5 h-5 animate-spin text-mail-accent ml-auto" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          {/if}
        </button>

        <!-- Divider -->
        <div class="flex items-center gap-3 my-4">
          <div class="flex-1 h-px bg-mail-border" />
          <span class="text-xs text-mail-muted">or</span>
          <div class="flex-1 h-px bg-mail-border" />
        </div>

        <!-- nsec paste option -->
        <div class="space-y-3">
          <label for="nsec" class="text-sm font-medium text-gray-700">Paste your nsec or hex private key</label>
          <input
            id="nsec"
            type="password"
            placeholder="nsec1... or hex private key"
            class="input-field"
            bind:value={nsecInput}
            on:keydown={(e) => e.key === 'Enter' && connectNsec()}
          />
          <p class="text-xs text-amber-600 flex items-start gap-1">
            <svg class="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span>Your key stays in browser memory only. For production use, we recommend a NIP-07 extension.</span>
          </p>
          <button
            on:click={connectNsec}
            disabled={loading || !nsecInput.trim()}
            class="btn-primary w-full disabled:opacity-50"
          >
            {loading ? 'Connecting...' : 'Connect with Key'}
          </button>
        </div>

      <!-- ═══ STEP 2: Your Address ═══ -->
      {:else if step === 2}
        <h2 class="text-xl font-semibold text-gray-900 mb-2">Your NOSTR Mail address</h2>
        <p class="text-sm text-mail-muted mb-6">
          This is how others can reach you.
        </p>

        <div class="space-y-4">
          <!-- Profile card -->
          {#if $currentUser}
            <div class="p-4 bg-gray-50 rounded-xl border border-mail-border">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-12 h-12 rounded-full bg-mail-accent flex items-center justify-center text-white text-lg font-bold">
                  {(profile?.name || 'U')[0].toUpperCase()}
                </div>
                <div>
                  <p class="font-medium text-gray-900">{profile?.name || profile?.display_name || 'Anonymous'}</p>
                  <p class="text-xs text-mail-muted font-mono">{truncatePubkey($currentUser.pubkey)}</p>
                </div>
              </div>

              {#if nip05Address}
                <div class="flex items-center gap-2 p-2 bg-white rounded-lg border border-mail-border">
                  <svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span class="text-sm font-medium">{nip05Address}</span>
                </div>
              {:else}
                <div class="p-2 bg-amber-50 rounded-lg border border-amber-200">
                  <p class="text-sm text-amber-700">
                    No NIP-05 address set. Others can still reach you via npub, but a NIP-05 address
                    (like alice@example.com) makes you easier to find.
                  </p>
                </div>
              {/if}
            </div>

            <!-- npub for sharing -->
            <div>
              <label class="text-sm font-medium text-gray-700 block mb-1">Your npub (share this)</label>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  readonly
                  value={$currentUser.npub}
                  class="input-field font-mono text-xs flex-1"
                />
                <button
                  class="btn-secondary text-sm shrink-0"
                  on:click={() => navigator.clipboard.writeText($currentUser?.npub || '')}
                >
                  Copy
                </button>
              </div>
            </div>
          {/if}
        </div>

        <button on:click={goToStep3} class="btn-primary w-full mt-6">
          Continue
        </button>

      <!-- ═══ STEP 3: Inbox Relays ═══ -->
      {:else if step === 3}
        <h2 class="text-xl font-semibold text-gray-900 mb-2">Your inbox relays</h2>
        <p class="text-sm text-mail-muted mb-6">
          These relays receive your encrypted mail. Senders look up your kind 10050 event to find them.
        </p>

        <div class="space-y-4">
          <!-- Inbox relays (kind 10050) -->
          <div>
            <label class="text-sm font-medium text-gray-700 block mb-2">
              DM Inbox Relays
              <span class="text-xs text-mail-muted font-normal">(kind 10050)</span>
            </label>
            <div class="space-y-2">
              {#each inboxRelays as relay, i}
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  <input
                    type="text"
                    value={relay}
                    on:input={(e) => { inboxRelays[i] = e.currentTarget.value; }}
                    class="input-field font-mono text-xs flex-1"
                  />
                </div>
              {/each}
            </div>
          </div>

          <!-- General relays (kind 10002) -->
          <div>
            <label class="text-sm font-medium text-gray-700 block mb-2">
              General Relays
              <span class="text-xs text-mail-muted font-normal">(kind 10002)</span>
            </label>
            <div class="space-y-2">
              {#each generalRelays as relay, i}
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  <input
                    type="text"
                    value={relay}
                    on:input={(e) => { generalRelays[i] = e.currentTarget.value; }}
                    class="input-field font-mono text-xs flex-1"
                  />
                </div>
              {/each}
            </div>
          </div>
        </div>

        <button on:click={goToInbox} class="btn-primary w-full mt-6">
          Finish Setup
        </button>

      <!-- ═══ STEP 4: Done! ═══ -->
      {:else if step === 4}
        <div class="text-center py-6">
          <div class="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 class="text-xl font-semibold text-gray-900 mb-2">You're all set!</h2>
          <p class="text-sm text-mail-muted">
            Redirecting to your inbox...
          </p>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <p class="text-center text-xs text-gray-400 mt-6">
      NOSTR Mail Reference Client v0.1.0 &mdash; NIP-17 + NIP-59 + NIP-44
    </p>
  </div>
</div>
