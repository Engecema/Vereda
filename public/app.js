'use strict';

(function () {
  const state = {
    authenticated: false,
    needsBootstrap: false,
    csrfToken: '',
    admin: null,
    overview: null,
    authTab: 'login',
    nodeFilter: 'all',
    nodeSearch: '',
    cmdTarget: 'windows',
    pendingPostRecoveryAction: 'dashboard'
  };

  function getCookie(name) {
    const prefix = `${name}=`;
    const parts = document.cookie ? document.cookie.split(';') : [];
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
    return '';
  }

  async function apiRequest(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrf = state.csrfToken || getCookie('vereda_csrf');
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }
    }

    const res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const message = typeof data === 'object' && data && data.error
        ? data.error
        : `Erro HTTP ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function showNotice(elementId, message, tone) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = `notice-banner notice-${tone}`;
  }

  function hideNotice(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = '';
    el.className = 'notice-banner hidden';
  }

  async function copyText(text, buttonEl, defaultLabel) {
    try {
      await navigator.clipboard.writeText(text);
      if (buttonEl) {
        buttonEl.textContent = 'Copiado';
        setTimeout(() => {
          buttonEl.textContent = defaultLabel;
        }, 1600);
      }
    } catch {
      showNotice('dash-feedback', 'Não foi possível acessar a área de transferência do navegador.', 'error');
    }
  }

  function formatTimestamp(isoString) {
    if (!isoString) return '--';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '--';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function sanitizeShellArg(value, pattern, fallback) {
    const cleaned = String(value || '').trim();
    return pattern.test(cleaned) ? cleaned : fallback;
  }

  // ============================================================================
  // Auth View Logic
  // ============================================================================

  function setAuthTab(tab) {
    state.authTab = tab;
    hideNotice('auth-feedback');

    document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
      const isActive = btn.getAttribute('data-auth-tab') === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
    document.getElementById('forgot-form').classList.toggle('hidden', tab !== 'forgot');

    const inviteGroup = document.getElementById('reg-invite-group');
    inviteGroup.classList.toggle('hidden', state.needsBootstrap);
  }

  function evaluatePasswordStrength(pw) {
    let score = 0;
    if (pw.length >= 10) score += 1;
    if (/[A-Z]/.test(pw)) score += 1;
    if (/[a-z]/.test(pw)) score += 1;
    if (/[0-9]/.test(pw)) score += 1;
    if (/[^A-Za-z0-9]/.test(pw)) score += 1;
    return score;
  }

  function showRecoveryKeyPanel(keyValue, postAction, bannerMsg) {
    state.pendingPostRecoveryAction = postAction;
    document.getElementById('auth-forms-container').classList.add('hidden');
    document.getElementById('recovery-key-panel').classList.remove('hidden');
    document.getElementById('issued-recovery-key').textContent = keyValue;
    const continueBtn = document.getElementById('continue-after-recovery-btn');
    continueBtn.textContent = postAction === 'dashboard' ? 'Acessar Painel' : 'Voltar ao Login';
    if (bannerMsg) {
      showNotice('auth-feedback', bannerMsg, 'success');
    }
  }

  function resetRecoveryKeyPanel() {
    document.getElementById('recovery-key-panel').classList.add('hidden');
    document.getElementById('auth-forms-container').classList.remove('hidden');
    document.getElementById('issued-recovery-key').textContent = '';
  }

  function renderAuthView() {
    document.getElementById('app-loading').classList.add('hidden');
    document.getElementById('dashboard-view').classList.add('hidden');
    document.getElementById('auth-view').classList.remove('hidden');

    const bootstrapBanner = document.getElementById('auth-bootstrap-banner');
    bootstrapBanner.classList.toggle('hidden', !state.needsBootstrap);

    resetRecoveryKeyPanel();
    setAuthTab(state.needsBootstrap ? 'register' : state.authTab);
  }

  // ============================================================================
  // Dashboard Rendering (Strict textContent / createElement — Zero innerHTML)
  // ============================================================================

  function renderOverview() {
    const data = state.overview;
    if (!data) return;

    const t = data.tunnel;
    document.getElementById('tunnel-meta-line').textContent =
      `${t.engine} · Banco ${t.databaseType.toUpperCase()} (${t.databasePath}) · DNS ${t.nameservers.join(' / ')}`;

    const statusEl = document.getElementById('kpi-tunnel-status');
    statusEl.textContent = t.status;
    statusEl.className = `kpi-value ${t.onlineCount > 0 ? 'status-online' : 'status-offline'}`;

    document.getElementById('kpi-engine').textContent = `Escuta ${t.listenAddr}`;
    document.getElementById('kpi-nodes-online').textContent = `${t.onlineCount} / ${t.totalNodes}`;
    document.getElementById('kpi-nodes-offline').textContent = `${t.offlineCount} offline`;
    document.getElementById('kpi-server-url').textContent = t.serverUrl;
    document.getElementById('kpi-listen-addr').textContent = `Métricas ${t.metricsAddr}`;
    document.getElementById('kpi-prefix-v4').textContent = t.ipv4Prefix;
    document.getElementById('kpi-base-domain').textContent = `MagicDNS: ${t.baseDomain}`;

    renderNodesTable();
    renderPreauthKeys();
    renderCommandPreview();
    renderSecuritySection();
  }

  function renderNodesTable() {
    const tbody = document.getElementById('nodes-tbody');
    const emptyState = document.getElementById('nodes-empty-state');
    tbody.replaceChildren();

    const allNodes = state.overview ? state.overview.nodes : [];
    const q = state.nodeSearch.trim().toLowerCase();

    const filtered = allNodes.filter((node) => {
      const envMatch = state.nodeFilter === 'all' || node.environment === state.nodeFilter;
      if (!envMatch) return false;
      if (!q) return true;
      const haystack = [
        node.hostname,
        node.role,
        node.os,
        node.tailscaleIp,
        node.endpoint,
        ...(node.advertisedRoutes || [])
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });

    if (filtered.length === 0) {
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    for (const node of filtered) {
      const tr = document.createElement('tr');

      // Col 1: Nó / Ambiente
      const tdName = document.createElement('td');
      const primary = document.createElement('div');
      primary.className = 'node-primary';
      primary.textContent = `${node.hostname}.${state.overview.tunnel.baseDomain}`;
      const meta = document.createElement('div');
      meta.className = 'node-meta';
      meta.textContent = `${node.role} · ${node.os}`;
      tdName.append(primary, meta);

      // Col 2: IP Privado
      const tdIp = document.createElement('td');
      tdIp.className = 'mono';
      tdIp.textContent = node.tailscaleIp;

      // Col 3: Rotas & Endpoint
      const tdRoutes = document.createElement('td');
      const endpointDiv = document.createElement('div');
      endpointDiv.className = 'mono';
      endpointDiv.textContent = node.endpoint;
      tdRoutes.appendChild(endpointDiv);
      if (node.advertisedRoutes && node.advertisedRoutes.length > 0) {
        const routeDiv = document.createElement('div');
        routeDiv.className = 'node-meta mono';
        routeDiv.textContent = `Rotas: ${node.advertisedRoutes.join(', ')}`;
        tdRoutes.appendChild(routeDiv);
      }

      // Col 4: Status do Túnel
      const tdStatus = document.createElement('td');
      const statusSpan = document.createElement('span');
      const isOnline = node.status === 'online';
      statusSpan.className = `status-label ${isOnline ? 'status-online' : 'status-offline'}`;
      statusSpan.textContent = isOnline ? 'Online · Criptografado' : 'Offline · Desconectado';
      tdStatus.appendChild(statusSpan);

      // Col 5: Latência
      const tdLat = document.createElement('td');
      tdLat.className = 'num-col mono';
      tdLat.textContent = typeof node.latencyMs === 'number' ? `${node.latencyMs} ms` : '--';

      // Col 6: Última atividade
      const tdSeen = document.createElement('td');
      tdSeen.className = 'mono';
      tdSeen.textContent = formatTimestamp(node.lastSeen);

      // Col 7: Ações
      const tdActions = document.createElement('td');
      tdActions.className = 'actions-col';
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'row-actions';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-secondary btn-compact';
      toggleBtn.textContent = isOnline ? 'Desconectar' : 'Ativar';
      toggleBtn.addEventListener('click', () => handleToggleNodeStatus(node));

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-danger-ghost';
      removeBtn.textContent = 'Revogar';
      removeBtn.addEventListener('click', () => handleRemoveNode(node));

      actionsWrap.append(toggleBtn, removeBtn);
      tdActions.appendChild(actionsWrap);

      tr.append(tdName, tdIp, tdRoutes, tdStatus, tdLat, tdSeen, tdActions);
      tbody.appendChild(tr);
    }
  }

  function renderPreauthKeys() {
    const container = document.getElementById('keys-list');
    container.replaceChildren();
    const keys = state.overview ? state.overview.preauthKeys : [];

    if (keys.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'muted-text';
      empty.textContent = 'Nenhuma chave Pre-Auth emitida nesta sessão.';
      container.appendChild(empty);
      return;
    }

    for (const k of keys.slice(0, 6)) {
      const row = document.createElement('div');
      row.className = 'list-row';

      const left = document.createElement('div');
      const code = document.createElement('div');
      code.className = 'mono';
      code.textContent = k.prefix;
      const meta = document.createElement('div');
      meta.className = 'node-meta';
      meta.textContent = `Namespace: ${k.user} · ${k.reusable ? 'Reutilizável' : 'Uso único'} · ${k.createdBy}`;
      left.append(code, meta);

      const right = document.createElement('div');
      right.className = 'node-meta mono';
      right.textContent = `Expira ${formatTimestamp(k.expiresAt)}`;

      row.append(left, right);
      container.appendChild(row);
    }
  }

  function renderCommandPreview() {
    const serverUrl = state.overview?.tunnel?.serverUrl || 'https://engecema.com.br';
    const hostname = sanitizeShellArg(
      document.getElementById('cmd-hostname').value,
      /^[a-zA-Z0-9-]{2,63}$/,
      'no-engecema-01'
    );
    const route = sanitizeShellArg(
      document.getElementById('cmd-route').value,
      /^(\d{1,3}\.){3}\d{1,3}\/(\d{1,2})$/,
      '192.168.10.0/24'
    );
    const authKey = sanitizeShellArg(
      document.getElementById('cmd-authkey').value,
      /^[a-zA-Z0-9_-]{8,128}$/,
      ''
    );

    const authFlag = authKey ? ` --authkey=${authKey}` : '';
    let cmd = '';

    if (state.cmdTarget === 'windows') {
      const psAuth = authKey ? ` -AuthKey "${authKey}"` : '';
      cmd = `# Execute no PowerShell como Administrador (Windows 10/11)\n.\\scripts\\conectar_windows.ps1 -ServerUrl "${serverUrl}" -Hostname "${hostname}"${psAuth}`;
    } else if (state.cmdTarget === 'linux') {
      cmd = `# Instalar Headscale na VPS Ubuntu/Debian:\nsudo bash scripts/instalar_vereda_vps.sh\n\n# Conectar servidor Linux cliente ao tunel Vereda:\nsudo tailscale up --login-server=${serverUrl} --hostname=${hostname} --accept-routes --accept-dns=true${authFlag}`;
    } else if (state.cmdTarget === 'datacenter') {
      cmd = `# Habilitar encaminhamento IP no Gateway do Data Center Local:\necho 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-vereda.conf\nsudo sysctl -p /etc/sysctl.d/99-vereda.conf\n\n# Anunciar sub-rede do Data Center Local na malha:\nsudo tailscale up --login-server=${serverUrl} --hostname=${hostname} --advertise-routes=${route} --accept-routes${authFlag}`;
    } else {
      cmd = `# Comandos administrativos na VPS Headscale:\nsudo headscale users list\nsudo headscale preauthkeys create --user engecema --reusable --expiration 24h\nsudo headscale nodes list\nsudo headscale routes list`;
    }

    document.getElementById('command-output').textContent = cmd;
  }

  function renderSecuritySection() {
    const checksList = document.getElementById('security-checks-list');
    checksList.replaceChildren();
    for (const item of state.overview.securityChecks) {
      const li = document.createElement('li');
      li.className = 'check-item';
      const label = document.createElement('span');
      label.textContent = item.label;
      const badge = document.createElement('span');
      badge.className = 'check-badge';
      badge.textContent = item.active ? 'Ativo' : 'Inativo';
      li.append(label, badge);
      checksList.appendChild(li);
    }

    const adminsList = document.getElementById('admins-list');
    adminsList.replaceChildren();
    for (const adm of state.overview.admins) {
      const row = document.createElement('div');
      row.className = 'list-row';
      const left = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'node-primary';
      nameEl.textContent = adm.name;
      const mailEl = document.createElement('div');
      mailEl.className = 'node-meta';
      mailEl.textContent = `${adm.email} · ${adm.role}`;
      left.append(nameEl, mailEl);

      const right = document.createElement('div');
      right.className = 'node-meta mono';
      right.textContent = formatTimestamp(adm.createdAt);

      row.append(left, right);
      adminsList.appendChild(row);
    }

    const auditBody = document.getElementById('audit-tbody');
    auditBody.replaceChildren();
    for (const log of state.overview.auditLogs) {
      const tr = document.createElement('tr');

      const tdTime = document.createElement('td');
      tdTime.className = 'mono';
      tdTime.textContent = formatTimestamp(log.timestamp);

      const tdEvent = document.createElement('td');
      tdEvent.className = 'mono';
      tdEvent.textContent = log.event;

      const tdActor = document.createElement('td');
      tdActor.textContent = log.actor;

      const tdIp = document.createElement('td');
      tdIp.className = 'mono';
      tdIp.textContent = log.ip;

      const tdDetail = document.createElement('td');
      tdDetail.textContent = log.detail;

      tr.append(tdTime, tdEvent, tdActor, tdIp, tdDetail);
      auditBody.appendChild(tr);
    }
  }

  async function loadDashboard() {
    document.getElementById('app-loading').classList.add('hidden');
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.remove('hidden');

    try {
      state.overview = await apiRequest('/api/overview');
      renderOverview();
    } catch (err) {
      if (err.status === 401) {
        state.authenticated = false;
        renderAuthView();
      } else {
        showNotice('dash-feedback', err.message, 'error');
      }
    }
  }

  // ============================================================================
  // Action Handlers
  // ============================================================================

  async function handleToggleNodeStatus(node) {
    const nextStatus = node.status === 'online' ? 'offline' : 'online';
    try {
      await apiRequest(`/api/nodes/${encodeURIComponent(node.id)}/status`, {
        method: 'PATCH',
        body: { status: nextStatus }
      });
      await loadDashboard();
    } catch (err) {
      showNotice('dash-feedback', err.message, 'error');
    }
  }

  async function handleRemoveNode(node) {
    try {
      await apiRequest(`/api/nodes/${encodeURIComponent(node.id)}`, {
        method: 'DELETE'
      });
      showNotice('dash-feedback', `Nó ${node.hostname} revogado da malha.`, 'success');
      await loadDashboard();
    } catch (err) {
      showNotice('dash-feedback', err.message, 'error');
    }
  }

  async function handlePreviewScript(scriptName) {
    try {
      const content = await apiRequest(`/api/scripts/${encodeURIComponent(scriptName)}`);
      document.getElementById('script-viewer-title').textContent = `scripts/${scriptName}`;
      document.getElementById('script-viewer-content').textContent = content;
      document.getElementById('script-viewer-panel').classList.remove('hidden');
    } catch (err) {
      showNotice('dash-feedback', err.message, 'error');
    }
  }

  function handleDownloadScript(scriptName) {
    window.location.href = `/api/scripts/${encodeURIComponent(scriptName)}?download=1`;
  }

  // ============================================================================
  // Event Wiring
  // ============================================================================

  function bindEvents() {
    document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
      btn.addEventListener('click', () => setAuthTab(btn.getAttribute('data-auth-tab')));
    });

    document.querySelectorAll('[data-switch-auth]').forEach((btn) => {
      btn.addEventListener('click', () => setAuthTab(btn.getAttribute('data-switch-auth')));
    });

    document.getElementById('reg-password').addEventListener('input', (e) => {
      const score = evaluatePasswordStrength(e.target.value);
      const hint = document.getElementById('reg-strength-text');
      const labels = [
        'Mínimo de 10 caracteres com maiúscula, minúscula, número e símbolo.',
        'Força baixa — adicione letras maiúsculas, números e símbolos.',
        'Força moderada — continue completando os requisitos.',
        'Força boa — verifique se possui todos os tipos de caractere.',
        'Força elevada — quase completa.',
        'Senha forte aprovada pela política de segurança.'
      ];
      hint.textContent = labels[score];
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideNotice('auth-feedback');
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;
      try {
        const res = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: { email, password }
        });
        state.authenticated = true;
        state.needsBootstrap = false;
        state.csrfToken = res.csrfToken;
        state.admin = res.admin;
        document.getElementById('login-password').value = '';
        await loadDashboard();
      } catch (err) {
        showNotice('auth-feedback', err.message, 'error');
      }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideNotice('auth-feedback');
      const payload = {
        name: document.getElementById('reg-name').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        role: document.getElementById('reg-role').value.trim(),
        inviteCode: document.getElementById('reg-invite').value.trim(),
        password: document.getElementById('reg-password').value,
        confirmPassword: document.getElementById('reg-confirm').value
      };
      try {
        const res = await apiRequest('/api/auth/register', {
          method: 'POST',
          body: payload
        });
        state.authenticated = true;
        state.needsBootstrap = false;
        state.csrfToken = res.csrfToken;
        state.admin = res.admin;
        e.target.reset();
        showRecoveryKeyPanel(
          res.recoveryKey,
          'dashboard',
          'Administrador cadastrado com sucesso. Salve a chave de recuperação abaixo.'
        );
      } catch (err) {
        showNotice('auth-feedback', err.message, 'error');
      }
    });

    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideNotice('auth-feedback');
      const payload = {
        email: document.getElementById('forgot-email').value.trim(),
        recoveryKey: document.getElementById('forgot-key').value.trim(),
        newPassword: document.getElementById('forgot-new-password').value,
        confirmPassword: document.getElementById('forgot-confirm').value
      };
      try {
        const res = await apiRequest('/api/auth/forgot-password', {
          method: 'POST',
          body: payload
        });
        e.target.reset();
        showRecoveryKeyPanel(
          res.newRecoveryKey,
          'login',
          `${res.message} Guarde sua nova chave de recuperação.`
        );
      } catch (err) {
        showNotice('auth-feedback', err.message, 'error');
      }
    });

    document.getElementById('copy-recovery-key-btn').addEventListener('click', (e) => {
      const val = document.getElementById('issued-recovery-key').textContent;
      copyText(val, e.currentTarget, 'Copiar Chave');
    });

    document.getElementById('continue-after-recovery-btn').addEventListener('click', async () => {
      resetRecoveryKeyPanel();
      if (state.pendingPostRecoveryAction === 'dashboard' && state.authenticated) {
        await loadDashboard();
      } else {
        setAuthTab('login');
      }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
      } catch {
        // Proceed to clear local state regardless
      }
      state.authenticated = false;
      state.csrfToken = '';
      state.admin = null;
      state.overview = null;
      state.authTab = 'login';
      renderAuthView();
    });

    // Nodes toolbar & form
    document.getElementById('toggle-add-node-btn').addEventListener('click', () => {
      document.getElementById('add-node-form').classList.toggle('hidden');
    });

    document.getElementById('cancel-add-node-btn').addEventListener('click', () => {
      document.getElementById('add-node-form').classList.add('hidden');
    });

    document.getElementById('add-node-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideNotice('dash-feedback');
      const payload = {
        hostname: document.getElementById('node-hostname').value.trim(),
        environment: document.getElementById('node-env').value,
        os: document.getElementById('node-os').value.trim(),
        endpoint: document.getElementById('node-endpoint').value.trim(),
        advertisedRoute: document.getElementById('node-route').value.trim()
      };
      try {
        await apiRequest('/api/nodes', { method: 'POST', body: payload });
        e.target.reset();
        document.getElementById('node-os').value = 'Ubuntu 24.04 LTS';
        document.getElementById('node-endpoint').value = 'Conexão direta WireGuard';
        document.getElementById('add-node-form').classList.add('hidden');
        showNotice('dash-feedback', `Nó ${payload.hostname} provisionado na malha Vereda.`, 'success');
        await loadDashboard();
      } catch (err) {
        showNotice('dash-feedback', err.message, 'error');
      }
    });

    document.getElementById('node-search').addEventListener('input', (e) => {
      state.nodeSearch = e.target.value;
      renderNodesTable();
    });

    document.querySelectorAll('[data-node-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.nodeFilter = btn.getAttribute('data-node-filter');
        document.querySelectorAll('[data-node-filter]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        renderNodesTable();
      });
    });

    document.getElementById('reset-node-filters-btn').addEventListener('click', () => {
      state.nodeFilter = 'all';
      state.nodeSearch = '';
      document.getElementById('node-search').value = '';
      document.querySelectorAll('[data-node-filter]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-node-filter') === 'all');
      });
      renderNodesTable();
    });

    // Pre-Auth Keys & Command Builder
    document.getElementById('preauth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideNotice('dash-feedback');
      const payload = {
        user: document.getElementById('key-user').value.trim(),
        expirationHours: Number(document.getElementById('key-hours').value),
        reusable: document.getElementById('key-reusable').checked,
        ephemeral: document.getElementById('key-ephemeral').checked
      };
      try {
        const res = await apiRequest('/api/preauth-keys', { method: 'POST', body: payload });
        document.getElementById('generated-key-value').textContent = res.rawKey;
        document.getElementById('generated-key-box').classList.remove('hidden');
        document.getElementById('cmd-authkey').value = res.rawKey;
        renderCommandPreview();
        await loadDashboard();
      } catch (err) {
        showNotice('dash-feedback', err.message, 'error');
      }
    });

    document.getElementById('copy-generated-key-btn').addEventListener('click', (e) => {
      const val = document.getElementById('generated-key-value').textContent;
      copyText(val, e.currentTarget, 'Copiar Chave');
    });

    document.querySelectorAll('[data-cmd-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.cmdTarget = btn.getAttribute('data-cmd-target');
        document.querySelectorAll('[data-cmd-target]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        renderCommandPreview();
      });
    });

    ['cmd-hostname', 'cmd-route', 'cmd-authkey'].forEach((id) => {
      document.getElementById(id).addEventListener('input', renderCommandPreview);
    });

    document.getElementById('copy-command-btn').addEventListener('click', (e) => {
      const cmd = document.getElementById('command-output').textContent;
      copyText(cmd, e.currentTarget, 'Copiar Comando');
    });

    // Scripts
    document.querySelectorAll('[data-preview-script]').forEach((btn) => {
      btn.addEventListener('click', () => {
        handlePreviewScript(btn.getAttribute('data-preview-script'));
      });
    });

    document.querySelectorAll('[data-download-script]').forEach((btn) => {
      btn.addEventListener('click', () => {
        handleDownloadScript(btn.getAttribute('data-download-script'));
      });
    });

    document.getElementById('copy-script-btn').addEventListener('click', (e) => {
      const content = document.getElementById('script-viewer-content').textContent;
      copyText(content, e.currentTarget, 'Copiar Conteúdo');
    });

    document.getElementById('close-script-btn').addEventListener('click', () => {
      document.getElementById('script-viewer-panel').classList.add('hidden');
    });

    // Admin Invites
    document.getElementById('generate-invite-btn').addEventListener('click', async () => {
      hideNotice('dash-feedback');
      try {
        const res = await apiRequest('/api/admin/invites', { method: 'POST', body: {} });
        document.getElementById('invite-code-value').textContent = res.inviteCode;
        document.getElementById('invite-result-box').classList.remove('hidden');
        await loadDashboard();
      } catch (err) {
        showNotice('dash-feedback', err.message, 'error');
      }
    });

    document.getElementById('copy-invite-btn').addEventListener('click', (e) => {
      const val = document.getElementById('invite-code-value').textContent;
      copyText(val, e.currentTarget, 'Copiar Convite');
    });
  }

  async function bootstrap() {
    bindEvents();
    try {
      const session = await apiRequest('/api/auth/session');
      state.authenticated = Boolean(session.authenticated);
      state.needsBootstrap = Boolean(session.needsBootstrap);
      state.csrfToken = session.csrfToken || '';
      state.admin = session.admin || null;

      if (state.authenticated) {
        await loadDashboard();
      } else {
        renderAuthView();
      }
    } catch {
      state.authenticated = false;
      renderAuthView();
      showNotice('auth-feedback', 'Não foi possível comunicar com o servidor Vereda.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', bootstrap);
})();
