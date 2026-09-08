(() => {
  'use strict';
  function mount(root = document, runtimeOverride) {
  const main = root.querySelector('main');
  const notice = root.querySelector('.notice');
  const runtime = runtimeOverride || new URLSearchParams(location.search).get('runtime') || location.origin;
  const endpoint = (path) => `${runtime}${path}`;
  let bridgeMode = false;
  let bridgeContext;
  let runtimeRpcUnavailable = false;
  let state;
  let updates = [];
  let currentTab = new URLSearchParams(location.search).get('tab') || 'installed';

  root.querySelector('.close').onclick = () => root.dispatchEvent(new CustomEvent('extbay.close'));
  root.querySelectorAll('[data-tab]').forEach((button) => button.onclick = () => selectTab(button.dataset.tab));
  selectTab(currentTab, false);
  refresh().catch(showError);

  async function refresh() {
    const stateResponse = await apiRequest('/extbay/api/extensions');
    if (!stateResponse.ok) throw new Error(`Unable to load extensions (HTTP ${stateResponse.status})`);
    state = await stateResponse.json();
    render(currentTab);
    if (state.settings?.automaticUpdateChecks === false) {
      updates = [];
      renderNotice();
      return;
    }
    const updateResponse = await apiRequest('/extbay/api/updates');
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
      const checked = state.settings?.automaticUpdateChecks !== false ? ' checked' : '';
      const sourceCount = Object.values(state.extensions).filter((extension) => {
        const source = extension.versions[extension.activeVersion]?.source || '';
        return source.startsWith('https://') || /^github:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source);
      }).length;
      const sourceStatus = sourceCount ? `${sourceCount} installed extension${sourceCount === 1 ? '' : 's'} will be checked.` : 'No installed GitHub/HTTPS extensions to check yet.';
      main.innerHTML = `<h2 class="section-title">${settingsIcon()}ExtBay settings</h2><div class="list"><div class="setting"><label class="checkbox-row"><input type="checkbox" data-auto-updates${checked}><span class="checkbox-copy"><span class="setting-title">Automatically check installed extensions for updates</span><span class="muted setting-copy">${sourceStatus} Updates are never installed without confirmation.</span></span></label></div></div>`;
      main.querySelector('[data-auto-updates]').onchange = (event) => saveAutomaticUpdates(event.target.checked);
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
      const response = await apiRequest(`/extbay/api/updates/${encodeURIComponent(id)}/install`, { method: 'POST', body: JSON.stringify({ approvedPermissions: update.permissions }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      await refresh();
    } catch (error) { alert(error.message); } finally { setBusy(false); }
  }

  async function deferUpdate(id) {
    setBusy(true);
    try {
      const response = await apiRequest(`/extbay/api/updates/${encodeURIComponent(id)}/defer`, { method: 'POST' });
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
      try { const result = await rpcRequest(id, method, params); frame.contentWindow.postMessage({ type: 'extbay.rpc.result', nonce, requestId, ...result }, '*'); }
      catch (error) { frame.contentWindow.postMessage({ type: 'extbay.rpc.result', nonce, requestId, ok: false, error: error.message }, '*'); }
    };
    const back = document.createElement('button'); back.className = 'back'; back.textContent = 'Back to Extensions';
    const close = () => { window.removeEventListener('message', listener); frame.remove(); back.remove(); };
    back.onclick = close;
    window.addEventListener('message', listener); frame.onload = async () => {
      const endpointId = await preferredEndpointId();
      frame.contentWindow.postMessage({ type: 'extbay.init', version: 1, nonce, context: endpointId ? { endpointId } : {} }, '*');
    };
    root.append(frame, back);
  }

  async function preferredEndpointId() {
    try {
      const response = await fetch('/api/endpoints?start=1&limit=100', { credentials: 'same-origin' });
      if (!response.ok) return undefined;
      const payload = await response.json();
      const endpoints = Array.isArray(payload) ? payload : payload.value || [];
      const active = endpoints.filter((item) => item.Status === 1 && Number.isSafeInteger(item.Id) && item.Id > 0);
      return (active.find((item) => String(item.URL || '').startsWith('unix://')) || active[0])?.Id;
    } catch { return undefined; }
  }

  async function toggleExtension(id, enabled) {
    const response = await apiRequest(`/extbay/api/extensions/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' });
    const body = await response.json(); if (!response.ok) return alert(body.error || `HTTP ${response.status}`);
    state = body; render('installed');
  }
  async function saveAutomaticUpdates(enabled) {
    setBusy(true);
    try {
      const response = await apiRequest('/extbay/api/settings', { method: 'POST', body: JSON.stringify({ automaticUpdateChecks: enabled }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      state = body;
      if (!enabled) { updates = []; renderNotice(); }
      render('settings');
      if (enabled) await refresh();
    } catch (error) { alert(error.message); render('settings'); } finally { setBusy(false); }
  }
  function setBusy(value) { root.querySelectorAll('button,input').forEach((control) => { control.disabled = value; }); }
  function showError(error) {
    main.innerHTML = `<h2 class="section-title">${warningIcon()}Runtime unavailable</h2><div class="list"><div class="setting"><div class="setting-title">ExtBay could not connect to its runtime API</div><div class="muted setting-copy">${escapeText(error.message)} · Expected endpoint: ${escapeText(runtime)}</div><div class="warning">Run <code>extbay doctor</code> on the server, then reinstall ExtBay if the runtime ports or TLS certificate changed.</div></div></div>`;
  }
  function emptyState(message) { return `<div class="empty">${boxIcon('empty-icon')}<div>${escapeText(message)}</div></div>`; }
  function boxIcon(className = '') { return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>`; }
  function updateIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5M3 12A9 9 0 0 1 18.5 5.8L21 8"/><path d="M21 3v5h-5"/></svg>'; }
  function settingsIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3v-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3h4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1 2.8 2.8-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1h.2v4h-.2a1.7 1.7 0 0 0-1.4 1Z"/></svg>'; }
  function warningIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>'; }
  async function apiRequest(path, options = {}) {
    if (!bridgeMode) {
      try {
        return await fetch(endpoint(path), { ...options, credentials: 'include', headers: { ...(options.headers || {}), ...(options.body ? { 'content-type': 'application/json' } : {}) } });
      } catch {
        bridgeMode = true;
      }
    }
    return bridgeRequest(path, options);
  }
  async function rpcRequest(extensionId, method, params) {
    if (!runtimeRpcUnavailable) {
      try {
        const response = await fetch(endpoint('/extbay/api/rpc'), { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ extensionId, method, params }) });
        const body = await response.json();
        return { ok: response.ok, value: response.ok ? body : undefined, error: response.ok ? undefined : body.error };
      } catch {
        runtimeRpcUnavailable = true;
      }
    }
    return browserRPC(extensionId, method, params ?? {});
  }
  async function browserRPC(extensionId, method, params) {
    const extension = state.extensions[extensionId];
    if (!extension?.enabled) return { ok: false, error: 'extension is not enabled' };
    const permissions = {
      'containers.list': 'containers.read', 'containers.inspect': 'containers.read', 'containers.restart': 'containers.control',
      'stacks.list': 'stacks.read', 'volumes.list': 'volumes.read', 'metrics.host': 'host.metrics',
      'storage.get': 'extension.storage', 'storage.set': 'extension.storage',
    };
    const required = permissions[method];
    if (!required) return { ok: false, error: `RPC method is not available through the same-origin bridge: ${method}` };
    if (!extension.grantedPermissions.includes(required)) return { ok: false, error: `permission denied: ${required}` };
    try {
      if (method === 'storage.get' || method === 'storage.set') {
        const response = await bridgeRequest('/extbay/api/rpc', { method: 'POST', body: JSON.stringify({ extensionId, method, params }) });
        const body = await response.json();
        return { ok: response.ok, value: response.ok ? body : undefined, error: response.ok ? undefined : body.error };
      }
      const endpointId = positiveId(params.endpointId, 'endpointId');
      let requestMethod = 'GET'; let path;
      if (method === 'containers.list') path = `/api/endpoints/${endpointId}/docker/containers/json?all=1`;
      if (method === 'containers.inspect') path = `/api/endpoints/${endpointId}/docker/containers/${encodeURIComponent(objectId(params.id, 'id'))}/json`;
      if (method === 'containers.restart') { requestMethod = 'POST'; path = `/api/endpoints/${endpointId}/docker/containers/${encodeURIComponent(objectId(params.id, 'id'))}/restart`; }
      if (method === 'stacks.list') path = `/api/stacks?filters=${encodeURIComponent(JSON.stringify({ EndpointID: endpointId }))}`;
      if (method === 'volumes.list') path = `/api/endpoints/${endpointId}/docker/volumes`;
      if (method === 'metrics.host') path = `/api/endpoints/${endpointId}/docker/info`;
      if (!path) return { ok: false, error: `unsupported RPC method: ${method}` };
      const response = await fetch(path, { method: requestMethod, credentials: 'same-origin' });
      if (!response.ok) return { ok: false, error: `Portainer API rejected request (${response.status})` };
      if (response.status === 204) return { ok: true, value: null };
      const contentType = response.headers.get('content-type') || '';
      return { ok: true, value: contentType.includes('json') ? await response.json() : await response.text() };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
  function positiveId(value, name) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid ${name}`);
    return value;
  }
  function objectId(value, name) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_.:@+-]{1,128}$/.test(value)) throw new Error(`invalid ${name}`);
    return value;
  }
  async function bridgeRequest(path, options) {
    const context = await getBridgeContext();
    const request = { path, method: options.method || 'GET', userId: context.userId, body: options.body ? JSON.parse(options.body) : undefined };
    const encoded = base64Url(JSON.stringify(request));
    const create = await fetch(`/api/endpoints/${context.endpointId}/docker/containers/extbay/exec`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ AttachStdout: true, AttachStderr: true, Tty: false, Cmd: ['node', '/app/packages/runtime/dist/bridge.js', encoded] }),
    });
    if (!create.ok) throw new Error(`Portainer bridge unavailable (HTTP ${create.status})`);
    const exec = await create.json();
    const start = await fetch(`/api/endpoints/${context.endpointId}/docker/exec/${encodeURIComponent(exec.Id)}/start`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Detach: false, Tty: false }),
    });
    if (!start.ok) throw new Error(`Portainer bridge failed (HTTP ${start.status})`);
    const bytes = new Uint8Array(await start.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) throw new Error('Portainer bridge response is too large');
    const result = JSON.parse(decodeDockerStream(bytes));
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
  }
  async function getBridgeContext() {
    if (bridgeContext) return bridgeContext;
    const [userResponse, endpointsResponse] = await Promise.all([
      fetch('/api/users/me', { credentials: 'same-origin' }),
      fetch('/api/endpoints?start=1&limit=100', { credentials: 'same-origin' }),
    ]);
    if (!userResponse.ok || !endpointsResponse.ok) throw new Error('Portainer administrator authentication is required');
    const user = await userResponse.json();
    if (user.Role !== 1) throw new Error('Portainer administrator is required while the direct runtime connection is unavailable');
    const payload = await endpointsResponse.json();
    const endpoints = Array.isArray(payload) ? payload : payload.value || [];
    const local = endpoints.find((item) => item.Status === 1 && String(item.URL || '').startsWith('unix://')) || endpoints.find((item) => item.Status === 1);
    if (!local) throw new Error('No active Portainer environment was found for the runtime bridge');
    bridgeContext = { userId: user.Id, endpointId: local.Id };
    return bridgeContext;
  }
  function decodeDockerStream(bytes) {
    const decoder = new TextDecoder();
    let offset = 0; let output = ''; let framed = false;
    while (offset + 8 <= bytes.length && bytes[offset] <= 2 && bytes[offset + 1] === 0 && bytes[offset + 2] === 0 && bytes[offset + 3] === 0) {
      framed = true;
      const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0);
      if (offset + 8 + size > bytes.length) throw new Error('Invalid Docker bridge response');
      output += decoder.decode(bytes.slice(offset + 8, offset + 8 + size));
      offset += 8 + size;
    }
    return (framed ? output : decoder.decode(bytes)).trim();
  }
  function base64Url(value) {
    const bytes = new TextEncoder().encode(value); let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function escapeText(value) { const span = document.createElement('span'); span.textContent = String(value); return span.innerHTML; }
  return { selectTab, refresh };
  }
  window.ExtBayUI = { mount };
  if (document.querySelector('main') && location.pathname.startsWith('/extbay/')) mount(document);
})();
