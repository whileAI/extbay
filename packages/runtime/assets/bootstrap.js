(() => {
  'use strict';
  if (window.top !== window || document.getElementById('extbay-launcher')) return;

  fetch('/api/users/me', { credentials: 'same-origin' }).then((response) => {
    if (response.ok) mount();
  }).catch(() => undefined);

  function mount() {

  const button = document.createElement('button');
  button.id = 'extbay-launcher';
  button.type = 'button';
  button.textContent = 'Extensions';
  button.setAttribute('aria-label', 'Open ExtBay Extensions');
  Object.assign(button.style, {
    position: 'fixed', left: '18px', bottom: '18px', zIndex: '2147483646',
    padding: '9px 13px', border: '1px solid #64748b', borderRadius: '8px',
    background: '#111827', color: '#f8fafc', font: '600 13px system-ui', cursor: 'pointer'
  });

  const overlay = document.createElement('div');
  overlay.hidden = true;
  Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: '#0f172acc' });
  const frame = document.createElement('iframe');
  frame.title = 'ExtBay Extensions';
  frame.src = '/extbay/ui';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  Object.assign(frame.style, { width: 'min(1100px, 94vw)', height: 'min(760px, 92vh)', border: '0', borderRadius: '12px', position: 'absolute', inset: '4vh 3vw', margin: 'auto', background: '#fff' });
  overlay.append(frame);
  const open = (tab = 'installed') => { frame.src = `/extbay/ui?tab=${encodeURIComponent(tab)}`; overlay.hidden = false; };
  button.onclick = () => open();
  overlay.onclick = (event) => { if (event.target === overlay) overlay.hidden = true; };
  window.addEventListener('message', (event) => { if (event.source === frame.contentWindow && event.data?.type === 'extbay.close') overlay.hidden = true; });
  document.body.append(button, overlay);
  const addSidebar = () => {
    const list = document.querySelector('.sidebar nav ul');
    if (!list || document.getElementById('extbay-sidebar')) return;
    const item = document.createElement('li'); item.id = 'extbay-sidebar';
    item.innerHTML = '<div style="font:600 12px system-ui;color:inherit;margin:0 0 7px">Extensions</div>';
    for (const [label, tab] of [['Installed', 'installed'], ['Updates', 'updates'], ['Settings', 'settings']]) {
      const link = document.createElement('button'); link.type = 'button'; link.textContent = label;
      Object.assign(link.style, { display: 'block', width: '100%', border: '0', background: 'transparent', color: 'inherit', textAlign: 'left', padding: '5px 8px', cursor: 'pointer' });
      link.onclick = () => open(tab); item.append(link);
    }
    list.append(item); button.style.display = 'none';
  };
  addSidebar(); new MutationObserver(addSidebar).observe(document.body, { childList: true, subtree: true });
  }
})();
