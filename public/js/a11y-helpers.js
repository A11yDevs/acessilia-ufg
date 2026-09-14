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
    syncPreferencesToServer();
  };

  window.changeFontSize = function(delta) {
    root.classList.remove('font-lg', 'font-xl');
    let msg = 'Tamanho da fonte normal';
    let size = 'normal';
    if (delta === 1) {
      root.classList.add('font-lg');
      localStorage.setItem('a11y_font_size', 'font-lg');
      msg = 'Tamanho da fonte aumentado para médio';
      size = 'font-lg';
    } else if (delta === 2) {
      root.classList.add('font-xl');
      localStorage.setItem('a11y_font_size', 'font-xl');
      msg = 'Tamanho da fonte aumentado para grande';
      size = 'font-xl';
    } else {
      localStorage.removeItem('a11y_font_size');
    }
    announceA11y(msg);
    syncPreferencesToServer();
  };

  window.toggleDyslexiaFont = function() {
    root.classList.toggle('dyslexia-font');
    const isDyslexia = root.classList.contains('dyslexia-font');
    localStorage.setItem('a11y_dyslexia', isDyslexia ? 'true' : 'false');
    announceA11y(`Fonte amigável para dislexia ${isDyslexia ? 'ativada' : 'desativada'}`);
    syncPreferencesToServer();
  };

  function syncPreferencesToServer() {
    try {
      const contrastMode = root.classList.contains('high-contrast') ? 'high' : 'normal';
      const fontSize = root.classList.contains('font-xl') ? 'font-xl' : (root.classList.contains('font-lg') ? 'font-lg' : 'normal');
      const dyslexiaFont = root.classList.contains('dyslexia-font');
      fetch('/api/v1/usuarios/preferencias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contrastMode, fontSize, dyslexiaFont })
      }).catch(() => {});
    } catch (_) {}
  }

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

            // Se for atualização de material, dispara evento interno para atualizar DOM sem F5
            if (data.type === 'MATERIAL_UPDATED' && data.materialId) {
              window.dispatchEvent(new CustomEvent('materialStatusUpdated', {
                detail: { materialId: data.materialId, status: data.status }
              }));
            }

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

  // MONITOR DE INATIVIDADE DE SESSÃO (LGPD / MÁQUINAS COMPARTILHADAS)
  // Alerta com 25 minutos e encerra sessão com 30 minutos
  (function initSessionInactivityMonitor() {
    let warningTimer;
    let logoutTimer;
    const WARNING_MS = 25 * 60 * 1000; // 25 min
    const LOGOUT_MS = 30 * 60 * 1000;  // 30 min

    function resetTimers() {
      clearTimeout(warningTimer);
      clearTimeout(logoutTimer);

      const modal = document.getElementById('modal-inactivity-warning');
      if (modal) modal.style.display = 'none';

      warningTimer = setTimeout(showInactivityWarning, WARNING_MS);
      logoutTimer = setTimeout(performAutoLogout, LOGOUT_MS);
    }

    function showInactivityWarning() {
      let modal = document.getElementById('modal-inactivity-warning');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-inactivity-warning';
        modal.setAttribute('role', 'alertdialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'tit-inactivity');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;padding:1rem;';
        modal.innerHTML = `
          <div class="auth-card" style="max-width:440px;background:var(--bg-surface);border:2px solid var(--color-warning);box-shadow:var(--shadow-lg);padding:2rem;">
            <h2 id="tit-inactivity" style="font-size:1.25rem;font-weight:700;margin-bottom:0.75rem;color:var(--color-primary);">⏳ Aviso de Inatividade</h2>
            <p style="margin-bottom:1.5rem;color:var(--text-secondary);line-height:1.6;">
              Por motivos de segurança e proteção de dados (LGPD em computadores acadêmicos compartilhados), sua sessão será encerrada em <strong>5 minutos</strong>.
            </p>
            <div style="display:flex;justify-content:flex-end;gap:1rem;">
              <button type="button" class="btn btn-primary" onclick="resetUserInactivity()">Continuar Conectado</button>
            </div>
          </div>
        `;
        document.body.appendChild(modal);
      }
      modal.style.display = 'flex';
      announceA11y('Aviso de inatividade: sua sessão irá expirar em 5 minutos.');
    }

    function performAutoLogout() {
      announceA11y('Sua sessão expirou por inatividade. Redirecionando...');
      window.location.href = '/login?reason=timeout';
    }

    window.resetUserInactivity = resetTimers;

    // Monitorar eventos de interação do usuário
    ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
      document.addEventListener(evt, resetTimers, { passive: true });
    });

    resetTimers();
  })();
})();
