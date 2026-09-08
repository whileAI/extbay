(() => {
  'use strict';
  function mount(root = document, runtimeOverride) {
  const main = root.querySelector('main');
  const notice = root.querySelector('.notice');
  const runtime = runtimeOverride || new URLSearchParams(location.search).get('runtime') || location.origin;
  const endpoint = (path) => `${runtime}${path}`;
  let state;
  let updates = [];
  let currentTab = new URLSearchParams(location.search).get('tab') || 'installed';

  root.querySelector('.close').onclick = () => root.dispatchEvent(new CustomEvent('extbay.close'));
  root.querySelectorAll('[data-tab]').forEach((button) => button.onclick = () => selectTab(button.dataset.tab));
  selectTab(currentTab, false);
  refresh().catch(showError);

  async function refresh() {
    const stateResponse = await fetch(endpoint('/extbay/api/extensions'), { credentials: 'include' });
    if (!stateResponse.ok) throw new Error(`Unable to load extensions (HTTP ${stateResponse.status})`);
    state = await stateResponse.json();
    render(currentTab);
    const updateResponse = await fetch(endpoint('/extbay/api/updates'), { credentials: 'include' });
    updates = updateResponse.ok ? await updateResponse.json() : [];
    render(currentTab);
    renderNotice();
  }

  function selectTab(tab, shouldRender = true) {
    currentTab = tab;
    root.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    if (shouldRender) render(tab);
  }

  function render(tab) {
    if (!state) return;
    if (tab === 'updates') {
      main.innerHTML = `<h2 class="section-title">${updateIcon()}Available updates</h2>${updates.length ? `<div class="list">${updates.map(updateCard).join('')}</div>` : emptyState('All extensions are up to date.')}`;
      bindUpdateActions(main);
      return;
    }
    if (tab === 'settings') {
      main.innerHTML = `<h2 class="section-title">${settingsIcon()}ExtBay settings</h2><div class="list"><div class="setting"><div class="setting-title">Automatic update checks</div><div class="muted setting-copy">Enabled. ExtBay checks supported sources when this page opens. Installation always requires confirmation.</div></div><div class="setting"><div class="setting-title">State revision</div><div class="muted setting-copy">${state.revision}</div></div></div>`;
      return;
    }
    const items = Object.values(state.extensions);
    main.innerHTML = `<h2 class="section-title">${boxIcon()}Installed extensions</h2>${items.length ? `<div class="list">${items.map(card).join('')}</div>` : emptyState('No extensions installed.')}`;
    main.querySelectorAll('[data-open]').forEach((button) => button.onclick = () => openExtension(button.dataset.open));
    main.querySelectorAll('[data-toggle]').forEach((button) => button.onclick = () => toggleExtension(button.dataset.toggle, button.dataset.enabled !== 'true'));
  }

  function renderNotice() {
    if (!updates.length) { notice.hidden = true; notice.innerHTML = ''; return; }
    const update = updates[0];
    notice.hidden = false;
    notice.innerHTML = `<div class="grow"><div class="name">${escapeText(update.name)} ${escapeText(update.availableVersion)} is available</div><div class="muted">Installed: ${escapeText(update.currentVersion)}${update.newPermissions.length ? ` · New permissions: ${update.newPermissions.map(escapeText).join(', ')}` : ''}</div></div><div class="actions"><button class="primary" data-install="${escapeText(update.id)}">Install update</button><button class="action" data-defer="${escapeText(update.id)}">Later (1 day)</button></div>`;
    bindUpdateActions(notice);
  }

  function card(extension) {
    const version = extension.versions[extension.activeVersion];
    const permissions = extension.grantedPermissions.length ? extension.grantedPermissions.map((permission) => `<span class="permission">${escapeText(permission)}</span>`).join('') : '<span class="muted">No permissions</span>';
    return `<article class="card"><div class="grow"><div class="name">${escapeText(version.manifest.name)}</div><div class="meta"><span class="muted">${escapeText(extension.id)} · ${escapeText(extension.activeVersion)}</span><span class="badge ${extension.enabled ? 'enabled' : 'disabled'}">${extension.enabled ? 'Enabled' : 'Disabled'}</span><span class="badge verified">${escapeText(version.signature)}</span></div><div class="permissions">${permissions}</div>${extension.pendingRestart ? '<div class="warning">Portainer restart is pending and requires your explicit confirmation.</div>' : ''}</div><div class="actions"><button class="action" data-toggle="${escapeText(extension.id)}" data-enabled="${extension.enabled}">${extension.enabled ? 'Disable' : 'Enable'}</button>${extension.enabled ? `<button class="primary" data-open="${escapeText(extension.id)}">Open</button>` : ''}</div></article>`;
  }

  function updateCard(update) {
    return `<article class="card"><div class="grow"><div class="name">${escapeText(update.name)}</div><div class="meta"><span class="muted">${escapeText(update.currentVersion)} → ${escapeText(update.availableVersion)}</span><span class="badge verified">${escapeText(update.signature)}</span><span class="permission">${escapeText(update.reload)}</span></div>${update.newPermissions.length ? `<div class="warning">New permissions: ${update.newPermissions.map(escapeText).join(', ')}</div>` : ''}</div><div class="actions"><button class="primary" data-install="${escapeText(update.id)}">Install update</button><button class="action" data-defer="${escapeText(update.id)}">Later (1 day)</button></div></article>`;
  }

  function bindUpdateActions(root) {
    root.querySelectorAll('[data-install]').forEach((button) => button.onclick = () => installUpdate(button.dataset.install));
    root.querySelectorAll('[data-defer]').forEach((button) => button.onclick = () => deferUpdate(button.dataset.defer));
  }

  async function installUpdate(id) {
    const update = updates.find((item) => item.id === id);
    if (!update) return;
    const permissions = update.newPermissions.length ? `\n\nNew permissions requested:\n${update.newPermissions.map((permission) => `• ${permission}`).join('\n')}` : '';
    const restart = update.reload === 'portainer-restart' ? '\n\nThis update requires a Portainer restart. ExtBay will not restart it automatically.' : '';
    if (!confirm(`Install ${update.name} ${update.availableVersion}?${permissions}${restart}`)) return;
    setBusy(true);
    try {
      const response = await fetch(endpoint(`/extbay/api/updates/${encodeURIComponent(id)}/install`), { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvedPermissions: update.permissions }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      await refresh();
    } catch (error) { alert(error.message); } finally { setBusy(false); }
  }

  async function deferUpdate(id) {
    setBusy(true);
    try {
      const response = await fetch(endpoint(`/extbay/api/updates/${encodeURIComponent(id)}/defer`), { method: 'POST', credentials: 'include' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      updates = updates.filter((update) => update.id !== id);
      render(currentTab); renderNotice();
    } catch (error) { alert(error.message); } finally { setBusy(false); }
  }

  function openExtension(id) {
    const extension = state.extensions[id]; const version = extension.versions[extension.activeVersion];
    const frame = document.createElement('iframe'); frame.className = 'extension'; frame.title = version.manifest.name;
    const assetPath = runtime === location.origin ? '/extbay/extensions' : '/extbay-extensions';
    frame.sandbox = 'allow-scripts'; frame.src = `${location.origin}${assetPath}/${encodeURIComponent(id)}/${encodeURIComponent(extension.activeVersion)}/${version.manifest.ui.entry}?sha256=${version.sha256}`;
    const nonce = crypto.randomUUID();
    const listener = async (event) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'extbay.rpc' || event.data?.nonce !== nonce) return;
      const { requestId, method, params } = event.data;
      try { const response = await fetch(endpoint('/extbay/api/rpc'), { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extensionId: id, method, params }) }); const body = await response.json(); frame.contentWindow.postMessage({ type: 'extbay.rpc.result', nonce, requestId, ok: response.ok, value: response.ok ? body : undefined, error: response.ok ? undefined : body.error }, '*'); }
      catch (error) { frame.contentWindow.postMessage({ type: 'extbay.rpc.result', nonce, requestId, ok: false, error: error.message }, '*'); }
    };
    const back = document.createElement('button'); back.className = 'back'; back.textContent = 'Back to Extensions';
    const close = () => { window.removeEventListener('message', listener); frame.remove(); back.remove(); };
    back.onclick = close;
    window.addEventListener('message', listener); frame.onload = () => frame.contentWindow.postMessage({ type: 'extbay.init', version: 1, nonce }, '*');
    root.append(frame, back);
  }

  async function toggleExtension(id, enabled) {
    const response = await fetch(endpoint(`/extbay/api/extensions/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`), { method: 'POST', credentials: 'include' });
    const body = await response.json(); if (!response.ok) return alert(body.error || `HTTP ${response.status}`);
    state = body; render('installed');
  }
  function setBusy(value) { root.querySelectorAll('button').forEach((button) => { button.disabled = value; }); }
  function showError(error) {
    main.innerHTML = `<h2 class="section-title">${warningIcon()}Runtime unavailable</h2><div class="list"><div class="setting"><div class="setting-title">ExtBay could not connect to its runtime API</div><div class="muted setting-copy">${escapeText(error.message)} · Expected endpoint: ${escapeText(runtime)}</div><div class="warning">Run <code>extbay doctor</code> on the server, then reinstall ExtBay if the runtime ports or TLS certificate changed.</div></div></div>`;
  }
  function emptyState(message) { return `<div class="empty">${boxIcon('empty-icon')}<div>${escapeText(message)}</div></div>`; }
  function boxIcon(className = '') { return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>`; }
  function updateIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/></svg>'; }
  function settingsIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3v-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3h4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.2v4h-.2a1.7 1.7 0 0 0-1.4 1Z"/></svg>'; }
  function warningIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>'; }
  function escapeText(value) { const span = document.createElement('span'); span.textContent = String(value); return span.innerHTML; }
  return { selectTab, refresh };
  }
  window.ExtBayUI = { mount };
  if (document.querySelector('main') && location.pathname.startsWith('/extbay/')) mount(document);
})();
