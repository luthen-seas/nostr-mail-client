<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import {
    currentUser,
    activeView,
    unreadCount,
    connectionStatus,
    searchQuery,
    composing,
    resetCompose,
  } from '$lib/stores';
  import { nostrMail } from '$lib/nostr-mail';

  let sidebarOpen = false;

  $: isOnboarding = $page.url.pathname.startsWith('/onboarding');
  $: currentPath = $page.url.pathname;

  const navItems = [
    { id: 'inbox', label: 'Inbox', href: '/', icon: 'inbox' },
    { id: 'sent', label: 'Sent', href: '/?view=sent', icon: 'send' },
    { id: 'drafts', label: 'Drafts', href: '/?view=drafts', icon: 'file' },
    { id: 'archive', label: 'Archive', href: '/?view=archive', icon: 'archive' },
    { id: 'trash', label: 'Trash', href: '/?view=trash', icon: 'trash' },
  ];

  const bottomItems = [
    { id: 'contacts', label: 'Contacts', href: '/?view=contacts', icon: 'users' },
    { id: 'settings', label: 'Settings', href: '/settings', icon: 'settings' },
  ];

  function handleCompose() {
    resetCompose();
    goto('/compose');
    sidebarOpen = false;
  }

  function truncatePubkey(pubkey: string): string {
    return pubkey.slice(0, 8) + '...' + pubkey.slice(-4);
  }
</script>

{#if isOnboarding}
  <slot />
{:else}
  <div class="flex h-screen overflow-hidden">
    <!-- Mobile sidebar overlay -->
    {#if sidebarOpen}
      <button
        class="fixed inset-0 bg-black/50 z-40 lg:hidden"
        on:click={() => sidebarOpen = false}
        aria-label="Close sidebar"
      />
    {/if}

    <!-- Sidebar -->
    <aside
      class="fixed lg:static inset-y-0 left-0 z-50 w-64 bg-mail-sidebar text-white
             flex flex-col transform transition-transform duration-200 ease-in-out
             {sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}"
    >
      <!-- Logo / Brand -->
      <div class="p-5 border-b border-white/10">
        <h1 class="text-xl font-bold tracking-tight">NOSTR Mail</h1>
        <p class="text-xs text-gray-400 mt-1">Encrypted. Sovereign. Yours.</p>
      </div>

      <!-- Compose Button -->
      <div class="p-4">
        <button
          on:click={handleCompose}
          class="w-full bg-mail-accent hover:bg-mail-accent-hover text-white py-2.5 px-4
                 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 4v16m8-8H4" />
          </svg>
          Compose
        </button>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 px-3 space-y-1 overflow-y-auto">
        {#each navItems as item}
          <a
            href={item.href}
            on:click={() => { activeView.set(item.id); sidebarOpen = false; }}
            class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                   {$activeView === item.id ? 'bg-white/10 text-white' : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'}"
          >
            {#if item.icon === 'inbox'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            {:else if item.icon === 'send'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            {:else if item.icon === 'file'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            {:else if item.icon === 'archive'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            {:else if item.icon === 'trash'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            {/if}
            <span class="flex-1">{item.label}</span>
            {#if item.id === 'inbox' && $unreadCount > 0}
              <span class="bg-mail-unread text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {$unreadCount}
              </span>
            {/if}
          </a>
        {/each}

        <div class="border-t border-white/10 my-3" />

        {#each bottomItems as item}
          <a
            href={item.href}
            on:click={() => { sidebarOpen = false; }}
            class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400
                   hover:bg-white/5 hover:text-gray-200 transition-colors"
          >
            {#if item.icon === 'users'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            {:else if item.icon === 'settings'}
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            {/if}
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>

      <!-- User Info -->
      {#if $currentUser}
        <div class="p-4 border-t border-white/10">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-mail-accent flex items-center justify-center text-sm font-bold">
              {($currentUser.profile?.name || 'U')[0].toUpperCase()}
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">
                {$currentUser.profile?.name || truncatePubkey($currentUser.pubkey)}
              </p>
              <p class="text-xs text-gray-400 truncate">
                {$currentUser.profile?.nip05 || $currentUser.npub.slice(0, 16) + '...'}
              </p>
            </div>
          </div>
        </div>
      {/if}
    </aside>

    <!-- Main content area -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Top bar -->
      <header class="h-14 bg-white border-b border-mail-border flex items-center px-4 gap-4 shrink-0">
        <!-- Mobile menu button -->
        <button
          class="lg:hidden p-1 rounded-md hover:bg-gray-100"
          on:click={() => sidebarOpen = !sidebarOpen}
          aria-label="Toggle sidebar"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <!-- Search -->
        <div class="flex-1 max-w-xl">
          <div class="relative">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search mail..."
              class="w-full pl-10 pr-4 py-1.5 bg-gray-100 rounded-lg text-sm border-0
                     focus:outline-none focus:ring-2 focus:ring-mail-accent focus:bg-white
                     transition-colors"
              bind:value={$searchQuery}
            />
          </div>
        </div>

        <!-- Right side: compose + connection status -->
        <div class="flex items-center gap-3">
          <button
            on:click={handleCompose}
            class="hidden sm:flex btn-primary text-sm py-1.5 items-center gap-2"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M12 4v16m8-8H4" />
            </svg>
            Compose
          </button>

          <!-- Connection indicator -->
          <div class="flex items-center gap-1.5" title="{$connectionStatus.connected ? 'Connected' : 'Disconnected'}">
            <div class="w-2 h-2 rounded-full {$connectionStatus.connected ? 'bg-green-500' : 'bg-red-500'}" />
            {#if $connectionStatus.syncing}
              <svg class="w-4 h-4 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            {/if}
          </div>
        </div>
      </header>

      <!-- Page content -->
      <main class="flex-1 overflow-y-auto">
        <slot />
      </main>
    </div>
  </div>
{/if}
