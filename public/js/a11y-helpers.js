// A11Y TOOLBAR & CONTROLS
(function() {
  const root = document.documentElement;

  // Restaurar preferências salvas
  const savedContrast = localStorage.getItem('a11y_contrast');
  const savedFont = localStorage.getItem('a11y_font_size');
  const savedDyslexia = localStorage.getItem('a11y_dyslexia');

  if (savedContrast === 'high') root.classList.add('high-contrast');
  if (savedFont) root.classList.add(savedFont);
  if (savedDyslexia === 'true') root.classList.add('dyslexia-font');

  window.toggleHighContrast = function() {
    root.classList.toggle('high-contrast');
    const isHigh = root.classList.contains('high-contrast');
    localStorage.setItem('a11y_contrast', isHigh ? 'high' : 'normal');
    announceA11y(`Modo alto contraste ${isHigh ? 'ativado' : 'desativado'}`);
  };

  window.changeFontSize = function(delta) {
    root.classList.remove('font-lg', 'font-xl');
    let msg = 'Tamanho da fonte normal';
    if (delta === 1) {
      root.classList.add('font-lg');
      localStorage.setItem('a11y_font_size', 'font-lg');
      msg = 'Tamanho da fonte aumentado para médio';
    } else if (delta === 2) {
      root.classList.add('font-xl');
      localStorage.setItem('a11y_font_size', 'font-xl');
      msg = 'Tamanho da fonte aumentado para grande';
    } else {
      localStorage.removeItem('a11y_font_size');
    }
    announceA11y(msg);
  };

  window.toggleDyslexiaFont = function() {
    root.classList.toggle('dyslexia-font');
    const isDyslexia = root.classList.contains('dyslexia-font');
    localStorage.setItem('a11y_dyslexia', isDyslexia ? 'true' : 'false');
    announceA11y(`Fonte amigável para dislexia ${isDyslexia ? 'ativada' : 'desativada'}`);
  };

  function announceA11y(text) {
    const announcer = document.getElementById('aria-status-announcer');
    if (announcer) {
      announcer.textContent = text;
    }
  }

  // CONEXÃO COM O CANAL SSE DE NOTIFICAÇÕES EM TEMPO REAL
  if (typeof EventSource !== 'undefined') {
    try {
      const evtSource = new EventSource('/api/v1/notifications/stream');
      evtSource.onmessage = function(event) {
        try {
          const data = JSON.parse(event.data);
          if (data.type && data.type !== 'CONNECTED') {
            const msg = `Nova notificação: ${data.title || ''} - ${data.message || ''}`;
            announceA11y(msg);

            // Exibir toast visual acessível temporário se houver corpo
            showToast(data.title, data.message);
          }
        } catch (e) {}
      };
    } catch (err) {}
  }

  function showToast(title, message) {
    const toast = document.createElement('div');
    toast.setAttribute('role', 'alert');
    toast.className = 'alert alert-success';
    toast.style.position = 'fixed';
    toast.style.bottom = '1.5rem';
    toast.style.right = '1.5rem';
    toast.style.zIndex = '99999';
    toast.style.boxShadow = 'var(--shadow-md)';
    toast.style.maxWidth = '360px';
    toast.innerHTML = `<strong>${title || 'Aviso'}</strong><br>${message || ''}`;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 6000);
  }
})();
