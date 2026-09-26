// A11Y TOOLBAR & CONTROLS
(function() {
  const root = document.documentElement;

  // Restaurar preferências salvas
  const savedContrast = localStorage.getItem('a11y_contrast');
  const savedFont = localStorage.getItem('a11y_font_size');
  const savedDyslexia = localStorage.getItem('a11y_dyslexia');
  const savedDarkSlate = localStorage.getItem('a11y_dark_slate');

  if (savedContrast === 'high') root.classList.add('high-contrast');
  if (savedDarkSlate === 'true') root.classList.add('dark-slate-theme');
  if (savedFont) root.classList.add(savedFont);
  if (savedDyslexia === 'true') root.classList.add('dyslexia-font');

  window.toggleHighContrast = function() {
    root.classList.remove('dark-slate-theme');
    localStorage.removeItem('a11y_dark_slate');
    root.classList.toggle('high-contrast');
    const isHigh = root.classList.contains('high-contrast');
    localStorage.setItem('a11y_contrast', isHigh ? 'high' : 'normal');
    announceA11y(`Modo alto contraste amarelo e preto ${isHigh ? 'ativado' : 'desativado'}`);
    syncPreferencesToServer();
  };

  window.toggleDarkSlateTheme = function() {
    root.classList.remove('high-contrast');
    localStorage.removeItem('a11y_contrast');
    root.classList.toggle('dark-slate-theme');
    const isDark = root.classList.contains('dark-slate-theme');
    localStorage.setItem('a11y_dark_slate', isDark ? 'true' : 'false');
    announceA11y(`Modo noturno dark slate suave ${isDark ? 'ativado' : 'desativado'}`);
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

  // RÉGUA DE LEITURA VISUAL (READING GUIDE)
  const readingRuler = document.getElementById('a11y-reading-ruler');
  let rulerActive = false;

  window.toggleReadingGuide = function() {
    if (!readingRuler) return;
    rulerActive = !rulerActive;
    readingRuler.style.display = rulerActive ? 'block' : 'none';
    announceA11y(`Régua de leitura visual ${rulerActive ? 'ativada' : 'desativada'}`);
  };

  document.addEventListener('mousemove', function(e) {
    if (rulerActive && readingRuler) {
      readingRuler.style.top = `${e.clientY - 24}px`;
    }
  }, { passive: true });

  // GAVETA MÓVEL ACESSÍVEL (MOBILE SIDEBAR DRAWER)
  window.toggleMobileSidebar = function() {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    const toggleBtn = document.querySelector('.btn-mobile-menu');
    if (!sidebar) return;

    const isOpen = sidebar.classList.contains('sidebar-open');
    if (isOpen) {
      sidebar.classList.remove('sidebar-open');
      if (backdrop) backdrop.classList.remove('active');
      if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.focus();
      }
      announceA11y('Menu de navegação fechado');
    } else {
      sidebar.classList.add('sidebar-open');
      if (backdrop) backdrop.classList.add('active');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
      announceA11y('Menu de navegação aberto');
    }
  };

  // MODAL DE ATALHOS DE TECLADO
  window.openKeyboardShortcutsModal = function() {
    const modal = document.getElementById('modal-keyboard-shortcuts');
    if (modal) {
      modal.style.display = 'flex';
      announceA11y('Guia de atalhos de teclado aberto');
      const closeBtn = modal.querySelector('button');
      if (closeBtn) closeBtn.focus();
    }
  };

  window.closeKeyboardShortcutsModal = function() {
    const modal = document.getElementById('modal-keyboard-shortcuts');
    if (modal) {
      modal.style.display = 'none';
      announceA11y('Guia de atalhos fechado');
    }
  };

  // CENTRAL DE NOTIFICAÇÕES PERSISTENTE
  const notifications = [];
  window.toggleNotificationDropdown = function() {
    const panel = document.getElementById('notification-dropdown-panel');
    const toggleBtn = document.getElementById('btn-notifications-toggle');
    if (!panel) return;

    const isHidden = panel.getAttribute('aria-hidden') === 'true';
    panel.setAttribute('aria-hidden', isHidden ? 'false' : 'true');
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');

    if (isHidden) {
      // Marcar como lidas
      const counter = document.getElementById('notification-counter');
      if (counter) counter.style.display = 'none';
    }
  };

  window.clearNotifications = function() {
    notifications.length = 0;
    const list = document.getElementById('notification-list');
    if (list) {
      list.innerHTML = '<li id="notification-empty" style="color: var(--text-muted); text-align: center; padding: 0.75rem;">Nenhuma notificação no momento.</li>';
    }
    const counter = document.getElementById('notification-counter');
    if (counter) counter.style.display = 'none';
    announceA11y('Lista de notificações limpa');
  };

  function addNotificationItem(title, message) {
    notifications.unshift({ title, message, date: new Date().toLocaleTimeString('pt-BR') });
    const list = document.getElementById('notification-list');
    const counter = document.getElementById('notification-counter');
    if (counter) {
      counter.textContent = notifications.length;
      counter.style.display = 'inline-block';
    }
    if (list) {
      const emptyMsg = document.getElementById('notification-empty');
      if (emptyMsg) emptyMsg.remove();

      const li = document.createElement('li');
      li.style.cssText = 'padding: 0.5rem 0; border-bottom: 1px solid var(--border-color);';
      li.innerHTML = `<strong>${title}</strong><br><span style="color: var(--text-secondary);">${message}</span>`;
      list.prepend(li);
    }
  }

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
  window.announceA11y = announceA11y;

  // ESCUTA GLOBAL DE ATALHOS DE TECLADO (WCAG 2.1.1 / 2.1.4)
  document.addEventListener('keydown', function(e) {
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);

    if (e.key === 'Escape') {
      window.closeKeyboardShortcutsModal();
      const sidebar = document.getElementById('app-sidebar');
      if (sidebar && sidebar.classList.contains('sidebar-open')) {
        window.toggleMobileSidebar();
      }
      const panel = document.getElementById('notification-dropdown-panel');
      if (panel && panel.getAttribute('aria-hidden') === 'false') {
        window.toggleNotificationDropdown();
      }
      return;
    }

    if (isInput) return; // Não intercepta digitação em campos de formulário

    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      const modal = document.getElementById('modal-keyboard-shortcuts');
      if (modal && modal.style.display === 'flex') {
        window.closeKeyboardShortcutsModal();
      } else {
        window.openKeyboardShortcutsModal();
      }
    } else if (e.key === '/') {
      const searchBox = document.getElementById('input-busca-materiais') || document.querySelector('input[type="search"]');
      if (searchBox) {
        e.preventDefault();
        searchBox.focus();
        announceA11y('Foco na busca de materiais');
      }
    } else if (e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault();
      window.toggleReadingGuide();
    } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      window.toggleHighContrast();
    } else if (e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      window.toggleDyslexiaFont();
    } else if (e.altKey && e.key === '1') {
      e.preventDefault();
      window.location.href = '/dashboard';
    } else if (e.altKey && e.key === '2') {
      e.preventDefault();
      window.location.href = '/materiais';
    } else if (e.altKey && e.key === '3') {
      e.preventDefault();
      window.location.href = '/solicitacoes';
    }
  });

  // REGISTRO DE SERVICE WORKER PARA SUPORTE A PWA
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('/public/sw.js').catch(() => {});
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

            // Adiciona na lista persistente do sino
            addNotificationItem(data.title || 'Aviso', data.message || '');

            // Se for atualização de material, dispara evento interno para atualizar DOM sem F5
            if (data.type === 'MATERIAL_UPDATED' && data.materialId) {
              window.dispatchEvent(new CustomEvent('materialStatusUpdated', {
                detail: { materialId: data.materialId, status: data.status }
              }));
            }

            // Exibir toast visual acessível temporário
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
