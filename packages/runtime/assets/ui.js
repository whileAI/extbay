(() => {
  'use strict';
  const main = document.querySelector('main');
  let state;
  document.querySelector('.close').onclick = () => parent.postMessage({ type: 'extbay.close' }, location.origin);
  document.querySelectorAll('[data-tab]').forEach((button) => button.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b === button));
    render(button.dataset.tab);
  });
  const initialTab = new URLSearchParams(location.search).get('tab') || 'installed';
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === initialTab));
  fetch('/extbay/api/extensions', { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((value) => { state = value; render(initialTab); }).catch((error) => { main.innerHTML = `<p class="empty">${escapeText(error.message)}</p>`; });

  function render(tab) {
    if (!state) return;
    if (tab === 'updates') { main.innerHTML = '<p class="empty">Update checks are performed by <code>extbay update</code>.</p>'; return; }
    if (tab === 'settings') { main.innerHTML = `<div class="card"><div><b>State revision</b><div class="muted">${state.revision}</div></div></div>`; return; }
    const items = Object.values(state.extensions);
    main.innerHTML = items.length ? items.map(card).join('') : '<p class="empty">No extensions installed.</p>';
    main.querySelectorAll('[data-open]').forEach((button) => button.onclick = () => openExtension(button.dataset.open));
    main.querySelectorAll('[data-toggle]').forEach((button) => button.onclick = () => toggleExtension(button.dataset.toggle, button.dataset.enabled !== 'true'));
  }
  function card(extension) {
    const version = extension.versions[extension.activeVersion];
    return `<article class="card"><div class="grow"><b>${escapeText(version.manifest.name)}</b><div class="muted">${escapeText(extension.id)} · ${escapeText(extension.activeVersion)} · ${extension.enabled ? 'enabled' : 'disabled'} · ${escapeText(version.signature)}</div><div class="muted">Permissions: ${extension.grantedPermissions.map(escapeText).join(', ') || 'none'}</div></div><button class="action" data-toggle="${escapeText(extension.id)}" data-enabled="${extension.enabled}">${extension.enabled ? 'Disable' : 'Enable'}</button>${extension.enabled ? `<button class="action" data-open="${escapeText(extension.id)}">Open</button>` : ''}</article>`;
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
  function escapeText(value) { const span = document.createElement('span'); span.textContent = String(value); return span.innerHTML; }
})();
