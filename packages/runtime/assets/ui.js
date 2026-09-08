(() => {
  'use strict';
  const main = document.querySelector('main');
  const notice = document.querySelector('.notice');
  let state;
  let updates = [];
  let currentTab = new URLSearchParams(location.search).get('tab') || 'installed';

  document.querySelector('.close').onclick = () => parent.postMessage({ type: 'extbay.close' }, location.origin);
  document.querySelectorAll('[data-tab]').forEach((button) => button.onclick = () => selectTab(button.dataset.tab));
  selectTab(currentTab, false);
  refresh().catch(showError);

  async function refresh() {
    const stateResponse = await fetch('/extbay/api/extensions', { credentials: 'same-origin' });
    if (!stateResponse.ok) throw new Error(`Unable to load extensions (HTTP ${stateResponse.status})`);
    state = await stateResponse.json();
    render(currentTab);
    const updateResponse = await fetch('/extbay/api/updates', { credentials: 'same-origin' });
    updates = updateResponse.ok ? await updateResponse.json() : [];
    render(currentTab);
    renderNotice();
  }

  function selectTab(tab, shouldRender = true) {
    currentTab = tab;
    document.querySelectorAll('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    if (shouldRender) render(tab);
  }

  function render(tab) {
    if (!state) return;
    if (tab === 'updates') {
      main.innerHTML = updates.length ? updates.map(updateCard).join('') : '<p class="empty">All extensions are up to date.</p>';
      bindUpdateActions(main);
      return;
    }
    if (tab === 'settings') {
      main.innerHTML = `<div class="card"><div><b>Automatic update checks</b><div class="muted">Enabled. ExtBay checks supported sources when this page opens. Installation always requires confirmation.</div></div></div><div class="card"><div><b>State revision</b><div class="muted">${state.revision}</div></div></div>`;
      return;
    }
    const items = Object.values(state.extensions);
    main.innerHTML = items.length ? items.map(card).join('') : '<p class="empty">No extensions installed.</p>';
    main.querySelectorAll('[data-open]').forEach((button) => button.onclick = () => openExtension(button.dataset.open));
    main.querySelectorAll('[data-toggle]').forEach((button) => button.onclick = () => toggleExtension(button.dataset.toggle, button.dataset.enabled !== 'true'));
  }

  function renderNotice() {
    if (!updates.length) { notice.hidden = true; notice.innerHTML = ''; return; }
    const update = updates[0];
    notice.hidden = false;
    notice.innerHTML = `<div class="grow"><b>${escapeText(update.name)} ${escapeText(update.availableVersion)} is available</b><div class="muted">Installed: ${escapeText(update.currentVersion)}${update.newPermissions.length ? ` · New permissions: ${update.newPermissions.map(escapeText).join(', ')}` : ''}</div></div><button class="primary" data-install="${escapeText(update.id)}">Install update</button><button class="action" data-defer="${escapeText(update.id)}">Later (1 day)</button>`;
    bindUpdateActions(notice);
  }

  function card(extension) {
    const version = extension.versions[extension.activeVersion];
    return `<article class="card"><div class="grow"><b>${escapeText(version.manifest.name)}</b><div class="muted">${escapeText(extension.id)} · ${escapeText(extension.activeVersion)} · ${extension.enabled ? 'enabled' : 'disabled'} · ${escapeText(version.signature)}</div><div class="muted">Permissions: ${extension.grantedPermissions.map(escapeText).join(', ') || 'none'}</div>${extension.pendingRestart ? '<div class="warning">Portainer restart is pending and requires your explicit confirmation outside ExtBay.</div>' : ''}</div><button class="action" data-toggle="${escapeText(extension.id)}" data-enabled="${extension.enabled}">${extension.enabled ? 'Disable' : 'Enable'}</button>${extension.enabled ? `<button class="action" data-open="${escapeText(extension.id)}">Open</button>` : ''}</article>`;
  }

  function updateCard(update) {
    return `<article class="card"><div class="grow"><b>${escapeText(update.name)}</b><div class="muted">${escapeText(update.currentVersion)} → ${escapeText(update.availableVersion)} · ${escapeText(update.signature)} · ${escapeText(update.reload)}</div>${update.newPermissions.length ? `<div class="warning">New permissions: ${update.newPermissions.map(escapeText).join(', ')}</div>` : ''}</div><button class="primary" data-install="${escapeText(update.id)}">Install update</button><button class="action" data-defer="${escapeText(update.id)}">Later (1 day)</button></article>`;
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
      const response = await fetch(`/extbay/api/updates/${encodeURIComponent(id)}/install`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvedPermissions: update.permissions }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      await refresh();
    } catch (error) { alert(error.message); } finally { setBusy(false); }
  }

  async function deferUpdate(id) {
    setBusy(true);
    try {
      const response = await fetch(`/extbay/api/updates/${encodeURIComponent(id)}/defer`, { method: 'POST', credentials: 'same-origin' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      updates = updates.filter((update) => update.id !== id);
      render(currentTab); renderNotice();
    } catch (error) { alert(error.message); } finally { setBusy(false); }
  }

  function openExtension(id) {
    const extension = state.extensions[id]; const version = extension.versions[extension.activeVersion];
    const frame = document.createElement('iframe'); frame.className = 'extension'; frame.title = version.manifest.name;
    frame.sandbox = 'allow-scripts'; frame.src = `/extbay/extensions/${encodeURIComponent(id)}/${encodeURIComponent(extension.activeVersion)}/${version.manifest.ui.entry}?sha256=${version.sha256}`;
    const nonce = crypto.randomUUID();
    const listener = async (event) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'extbay.rpc' || event.data?.nonce !== nonce) return;
      const { requestId, method, params } = event.data;
      try { const response = await fetch('/extbay/api/rpc', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extensionId: id, method, params }) }); const body = await response.json(); frame.contentWindow.postMessage({ type: 'extbay.rpc.result', nonce, requestId, ok: response.ok, value: response.ok ? body : undefined, error: response.ok ? undefined : body.error }, '*'); }
      catch (error) { frame.contentWindow.postMessage({ type: 'extbay.rpc.result', nonce, requestId, ok: false, error: error.message }, '*'); }
    };
    const back = document.createElement('button'); back.className = 'back'; back.textContent = 'Back to Extensions';
    const close = () => { window.removeEventListener('message', listener); frame.remove(); back.remove(); };
    back.onclick = close;
    window.addEventListener('message', listener); frame.onload = () => frame.contentWindow.postMessage({ type: 'extbay.init', version: 1, nonce }, '*');
    document.body.append(frame, back);
  }

  async function toggleExtension(id, enabled) {
    const response = await fetch(`/extbay/api/extensions/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST', credentials: 'same-origin' });
    const body = await response.json(); if (!response.ok) return alert(body.error || `HTTP ${response.status}`);
    state = body; render('installed');
  }
  function setBusy(value) { document.querySelectorAll('button').forEach((button) => { button.disabled = value; }); }
  function showError(error) { main.innerHTML = `<p class="empty">${escapeText(error.message)}</p>`; }
  function escapeText(value) { const span = document.createElement('span'); span.textContent = String(value); return span.innerHTML; }
})();
