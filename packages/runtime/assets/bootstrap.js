(() => {
  'use strict';
  if (window.top !== window || window.__extbayMounted) return;
  window.__extbayMounted = true;

  fetch('/api/users/me', { credentials: 'same-origin' }).then((response) => {
    if (response.ok) mount();
  }).catch(() => undefined);

  function mount() {
    const runtimeOrigin = window.__EXTBAY_RUNTIME_ORIGIN__ || location.origin;
    const uiPath = window.__EXTBAY_RUNTIME_ORIGIN__ ? '/extbay-ui.html' : '/extbay/ui';
    let panel;
    let hiddenView;
    let oldTitle = document.title;
    let ui;
    let loading;

    const loadUI = async (tab) => {
      if (ui) { ui.selectTab(tab); return; }
      if (!loading) loading = (async () => {
        const response = await fetch(uiPath, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`ExtBay UI failed to load (${response.status})`);
        const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
        parsed.querySelectorAll('script').forEach((script) => script.remove());
        const shadow = panel.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `${parsed.head.querySelector('style')?.outerHTML || ''}${parsed.body.innerHTML}`;
        await new Promise((resolve, reject) => {
          if (window.ExtBayUI) return resolve();
          const script = document.createElement('script');
          script.src = window.__EXTBAY_RUNTIME_ORIGIN__ ? '/extbay-ui.js' : '/extbay/ui.js';
          script.onload = resolve; script.onerror = () => reject(new Error('ExtBay UI script failed to load'));
          document.head.append(script);
        });
        ui = window.ExtBayUI.mount(shadow, runtimeOrigin);
        shadow.addEventListener('extbay.close', close);
      })();
      await loading;
      ui.selectTab(tab);
    };

    const open = (tab = 'installed') => {
      const wasOpen = panel && !panel.hidden;
      const host = document.querySelector('.page-content') || document.querySelector('#content-wrapper') || document.body;
      hiddenView = document.querySelector('#view');
      if (!panel) {
        panel = document.createElement('section');
        panel.id = 'extbay-panel';
        panel.setAttribute('aria-label', 'Extensions');
        Object.assign(panel.style, { width: '100%', height: '100%', minHeight: 'calc(100vh - 55px)', overflow: 'hidden', background: '#0f172a', color: '#e2e8f0', fontFamily: 'Inter,system-ui,sans-serif' });
      }
      if (panel.parentElement !== host) host.append(panel);
      void loadUI(tab).catch((error) => { panel.textContent = error.message; });
      if (hiddenView) hiddenView.style.display = 'none';
      panel.hidden = false;
      if (!wasOpen) oldTitle = document.title;
      document.title = 'Extensions · ' + oldTitle.replace(/^Extensions · /, '');
      const sidebarLink = document.querySelector('#extbay-sidebar a');
      if (sidebarLink) { sidebarLink.setAttribute('aria-current', 'page'); sidebarLink.style.background = 'rgba(255,255,255,.10)'; }
    };

    const close = () => {
      if (panel) panel.hidden = true;
      if (hiddenView) hiddenView.style.display = '';
      document.title = oldTitle.replace(/^Extensions · /, '');
      const sidebarLink = document.querySelector('#extbay-sidebar a');
      if (sidebarLink) { sidebarLink.setAttribute('aria-current', 'false'); sidebarLink.style.background = ''; }
    };

    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (link && !link.closest('#extbay-sidebar')) close();
    }, true);

    const addSidebar = () => {
      const list = document.querySelector('.sidebar nav ul') || document.querySelector('#sideview nav ul');
      if (!list || document.getElementById('extbay-sidebar')) return;
      const item = document.createElement('li');
      item.id = 'extbay-sidebar';
      item.className = 'min-h-8 flex text-gray-3';
      item.setAttribute('aria-label', 'Extensions');
      const link = document.createElement('a');
      link.href = '#';
      link.title = 'Extensions';
      link.className = '!text-inherit no-underline flex h-8 w-full flex-1 items-center space-x-4 rounded-md text-sm transition-colors duration-200 hover:bg-graphite-500 px-3';
      Object.assign(link.style, { display: 'flex', alignItems: 'center', width: '100%', minHeight: '32px', gap: '16px', borderRadius: '6px', padding: '0 12px', color: 'inherit', textDecoration: 'none', fontSize: '14px' });
      link.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></svg><span>Extensions</span>';
      link.onclick = (event) => { event.preventDefault(); open('installed'); };
      item.append(link);
      list.append(item);
      const label = link.querySelector('span');
      const syncSidebarWidth = () => {
        const compact = list.getBoundingClientRect().width < 90;
        label.hidden = compact;
        link.style.justifyContent = compact ? 'center' : 'flex-start';
        link.style.padding = compact ? '0' : '0 12px';
      };
      syncSidebarWidth();
      if ('ResizeObserver' in window) new ResizeObserver(syncSidebarWidth).observe(list);
    };

    addSidebar();
    new MutationObserver(addSidebar).observe(document.body, { childList: true, subtree: true });
  }
})();
