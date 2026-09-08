(() => {
  'use strict';
  if (window.top !== window || window.__extbayMounted) return;
  window.__extbayMounted = true;

  fetch('/api/users/me', { credentials: 'same-origin' }).then((response) => {
    if (response.ok) mount();
  }).catch(() => undefined);

  function mount() {
    let panel;
    let frame;
    let hiddenView;
    let oldTitle = document.title;

    const open = (tab = 'installed') => {
      const wasOpen = panel && !panel.hidden;
      const host = document.querySelector('.page-content') || document.querySelector('#content-wrapper') || document.body;
      hiddenView = document.querySelector('#view');
      if (!panel) {
        panel = document.createElement('section');
        panel.id = 'extbay-panel';
        panel.setAttribute('aria-label', 'Extensions');
        Object.assign(panel.style, { width: '100%', height: '100%', minHeight: 'calc(100vh - 55px)', overflow: 'hidden' });
        frame = document.createElement('iframe');
        frame.title = 'ExtBay Extensions';
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        Object.assign(frame.style, { width: '100%', height: '100%', minHeight: 'calc(100vh - 55px)', border: '0', display: 'block', background: '#0f172a' });
        panel.append(frame);
      }
      if (panel.parentElement !== host) host.append(panel);
      frame.src = `/extbay/ui?tab=${encodeURIComponent(tab)}`;
      if (hiddenView) hiddenView.style.display = 'none';
      panel.hidden = false;
      if (!wasOpen) oldTitle = document.title;
      document.title = 'Extensions · ' + oldTitle.replace(/^Extensions · /, '');
      document.querySelectorAll('#extbay-sidebar button').forEach((button) => button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false'));
    };

    const close = () => {
      if (panel) panel.hidden = true;
      if (hiddenView) hiddenView.style.display = '';
      document.title = oldTitle.replace(/^Extensions · /, '');
      document.querySelectorAll('#extbay-sidebar button').forEach((button) => button.setAttribute('aria-current', 'false'));
    };

    window.addEventListener('message', (event) => {
      if (frame && event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === 'extbay.close') close();
    });
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (link && !link.closest('#extbay-sidebar')) close();
    }, true);

    const addSidebar = () => {
      const list = document.querySelector('.sidebar nav ul') || document.querySelector('#sideview nav ul');
      if (!list || document.getElementById('extbay-sidebar')) return;
      const item = document.createElement('li');
      item.id = 'extbay-sidebar';
      item.style.padding = '10px 12px';
      const heading = document.createElement('div');
      heading.textContent = 'Extensions';
      Object.assign(heading.style, { font: '600 12px system-ui', color: 'inherit', margin: '0 0 6px' });
      item.append(heading);
      for (const [label, tab] of [['Installed', 'installed'], ['Updates', 'updates'], ['Settings', 'settings']]) {
        const link = document.createElement('button');
        link.type = 'button'; link.textContent = label; link.dataset.tab = tab;
        Object.assign(link.style, { display: 'block', width: '100%', border: '0', borderRadius: '5px', background: 'transparent', color: 'inherit', textAlign: 'left', padding: '6px 8px', cursor: 'pointer' });
        link.onclick = () => open(tab);
        item.append(link);
      }
      list.append(item);
    };

    addSidebar();
    new MutationObserver(addSidebar).observe(document.body, { childList: true, subtree: true });
  }
})();
