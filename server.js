import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const SECRET_PATH = path.join(__dirname, '.vereda_secret');
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX_PATH = path.join(__dirname, 'index.html');
const CONFIG_EXAMPLE_PATH = path.join(__dirname, 'config', 'config.yaml.example');

const ALLOWED_SCRIPTS = new Map([
  ['instalar_vereda_vps.sh', {
    filePath: path.join(__dirname, 'scripts', 'instalar_vereda_vps.sh'),
    contentType: 'text/plain; charset=utf-8'
  }],
  ['conectar_windows.ps1', {
    filePath: path.join(__dirname, 'scripts', 'conectar_windows.ps1'),
    contentType: 'text/plain; charset=utf-8'
  }]
]);

function ensureSecureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function getSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    return process.env.SESSION_SECRET;
  }
  if (fs.existsSync(SECRET_PATH)) {
    const existing = fs.readFileSync(SECRET_PATH, 'utf8').trim();
    if (existing.length >= 64) return existing;
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_PATH, generated, { mode: 0o600 });
  return generated;
}

const SESSION_SECRET = getSessionSecret();

function loadVeredaConfig() {
  const defaults = {
    serverUrl: process.env.VEREDA_SERVER_URL || 'https://engecema.com.br',
    listenAddr: '0.0.0.0:8080',
    metricsAddr: '127.0.0.1:9090',
    ipv4Prefix: '100.64.0.0/10',
    ipv6Prefix: 'fd7a:115c:a1e0::/48',
    databaseType: 'sqlite',
    databasePath: '/var/lib/vereda/db.sqlite',
    magicDns: true,
    baseDomain: process.env.VEREDA_BASE_DOMAIN || 'engecema.internal',
    nameservers: ['1.1.1.1', '9.9.9.9']
  };

  try {
    if (!fs.existsSync(CONFIG_EXAMPLE_PATH)) return defaults;
    const raw = fs.readFileSync(CONFIG_EXAMPLE_PATH, 'utf8');
    const getMatch = (re) => {
      const m = raw.match(re);
      return m ? m[1].trim() : null;
    };
    return {
      serverUrl: getMatch(/^server_url:\s*(.+)$/m) || defaults.serverUrl,
      listenAddr: getMatch(/^listen_addr:\s*(.+)$/m) || defaults.listenAddr,
      metricsAddr: getMatch(/^metrics_listen_addr:\s*(.+)$/m) || defaults.metricsAddr,
      ipv4Prefix: getMatch(/^\s*v4:\s*(.+)$/m) || defaults.ipv4Prefix,
      ipv6Prefix: getMatch(/^\s*v6:\s*(.+)$/m) || defaults.ipv6Prefix,
      databaseType: getMatch(/^\s*type:\s*(.+)$/m) || defaults.databaseType,
      databasePath: getMatch(/^\s*path:\s*(.+)$/m) || defaults.databasePath,
      magicDns: getMatch(/^\s*magic_dns:\s*(true|false)$/m) !== 'false',
      baseDomain: getMatch(/^\s*base_domain:\s*(.+)$/m) || defaults.baseDomain,
      nameservers: raw.includes('9.9.9.9') ? ['1.1.1.1', '9.9.9.9'] : defaults.nameservers
    };
  } catch {
    return defaults;
  }
}

const VEREDA_CONFIG = loadVeredaConfig();

function createInitialStore() {
  const now = new Date().toISOString();
  return {
    admins: [],
    invites: [],
    revokedSessions: {},
    preauthKeys: [],
    nodes: [
      {
        id: 'node-vps-coord-01',
        hostname: 'vps-coord-01',
        role: 'VPS Coordenadora',
        environment: 'vps',
        os: 'Ubuntu 24.04 LTS',
        veredaIp: '100.64.0.1',
        endpoint: 'engecema.com.br:41641',
        advertisedRoutes: [],
        status: 'online',
        latencyMs: 14,
        lastSeen: now,
        createdAt: now
      },
      {
        id: 'node-dc-local-gw01',
        hostname: 'dc-local-gw01',
        role: 'Data Center Local',
        environment: 'datacenter',
        os: 'Debian 12 (Gateway)',
        veredaIp: '100.64.0.2',
        endpoint: '189.40.12.88:41641',
        advertisedRoutes: ['192.168.10.0/24', '10.20.0.0/16'],
        status: 'online',
        latencyMs: 22,
        lastSeen: now,
        createdAt: now
      },
      {
        id: 'node-dc-erp-01',
        hostname: 'dc-erp-srv01',
        role: 'Data Center Local',
        environment: 'datacenter',
        os: 'Ubuntu 22.04 LTS',
        veredaIp: '100.64.0.3',
        endpoint: '189.40.12.88:41642',
        advertisedRoutes: [],
        status: 'online',
        latencyMs: 24,
        lastSeen: now,
        createdAt: now
      },
      {
        id: 'node-win-eng-01',
        hostname: 'estacao-eng-01',
        role: 'Estação Windows 10',
        environment: 'workstation',
        os: 'Windows 10 Pro',
        veredaIp: '100.64.0.10',
        endpoint: '201.18.94.15:41641',
        advertisedRoutes: [],
        status: 'offline',
        latencyMs: null,
        lastSeen: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
        createdAt: now
      }
    ],
    auditLogs: [
      {
        id: crypto.randomUUID(),
        timestamp: now,
        event: 'SYSTEM_BOOT',
        actor: 'sistema',
        ip: '127.0.0.1',
        detail: 'Painel Vereda inicializado com configuracao Vereda + SQLite3.'
      }
    ]
  };
}

function loadStore() {
  ensureSecureStorage();
  if (!fs.existsSync(STORE_PATH)) {
    const initial = createInitialStore();
    saveStore(initial);
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid store');
    }
    parsed.admins = Array.isArray(parsed.admins) ? parsed.admins : [];
    parsed.invites = Array.isArray(parsed.invites) ? parsed.invites : [];
    parsed.revokedSessions = parsed.revokedSessions && typeof parsed.revokedSessions === 'object' ? parsed.revokedSessions : {};
    parsed.preauthKeys = Array.isArray(parsed.preauthKeys) ? parsed.preauthKeys : [];
    parsed.nodes = Array.isArray(parsed.nodes)
      ? parsed.nodes.map((n) => ({ ...n, veredaIp: n.veredaIp || '100.64.0.1' }))
      : [];
    parsed.auditLogs = Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [];
    return parsed;
  } catch {
    const fallback = createInitialStore();
    saveStore(fallback);
    return fallback;
  }
}

function saveStore(targetStore) {
  ensureSecureStorage();
  const tmpPath = `${STORE_PATH}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(targetStore, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, STORE_PATH);
}

const store = loadStore();

function appendAudit(event, actor, ip, detail) {
  store.auditLogs.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    event: String(event).slice(0, 64),
    actor: String(actor || 'anonimo').slice(0, 120),
    ip: String(ip || 'unknown').slice(0, 64),
    detail: String(detail || '').slice(0, 240)
  });
  if (store.auditLogs.length > 150) {
    store.auditLogs.length = 150;
  }
  saveStore(store);
}

// ==============================================================================
// Security Helpers: Hashing, Tokens, Sanitization, Validation, Rate Limiting
// ==============================================================================

const DUMMY_PASSWORD_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 128) return false;
  if (typeof storedHash !== 'string' || !storedHash.includes(':')) return false;
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex || salt.length !== 32 || expectedHex.length !== 128) return false;
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function getUserAgentFingerprint(req) {
  const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  return sha256Hex(ua).slice(0, 16);
}

function generateRecoveryKey() {
  const bytes = crypto.randomBytes(12).toString('hex').toUpperCase();
  return `VRD-${bytes.slice(0, 4)}-${bytes.slice(4, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20, 24)}`;
}

function isValidRecoveryKeyFormat(key) {
  return typeof key === 'string' && /^VRD-[A-F0-9]{4}(-[A-F0-9]{4}){5}$/.test(key);
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function isValidEmail(email) {
  return typeof email === 'string'
    && email.length >= 5
    && email.length <= 120
    && /^[^\s@<>\\/"';]+@[^\s@<>\\/"';]+\.[^\s@<>\\/"';]{2,}$/.test(email);
}

function validateStrongPassword(password) {
  if (typeof password !== 'string') return 'Senha obrigatória.';
  if (password.length < 10 || password.length > 128) {
    return 'A senha deve ter entre 10 e 128 caracteres.';
  }
  if (!/[A-Z]/.test(password)) return 'A senha deve incluir ao menos uma letra maiúscula.';
  if (!/[a-z]/.test(password)) return 'A senha deve incluir ao menos uma letra minúscula.';
  if (!/[0-9]/.test(password)) return 'A senha deve incluir ao menos um número.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'A senha deve incluir ao menos um caractere especial.';
  return null;
}

function sanitizeText(value, maxLen = 80) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F<>`$\\]/g, '').trim().slice(0, maxLen);
}

function isValidHostname(hostname) {
  return typeof hostname === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]$/.test(hostname);
}

function isValidNodeId(id) {
  return typeof id === 'string' && /^node-[a-zA-Z0-9-]{4,58}$/.test(id);
}

function isValidEndpoint(endpoint) {
  return typeof endpoint === 'string' && /^[a-zA-Z0-9.:/ _\u00C0-\u017F-]{2,80}$/.test(endpoint);
}

function isValidCidr(cidr) {
  if (typeof cidr !== 'string') return false;
  const match = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!match) return false;
  const octets = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  const mask = Number(match[5]);
  return octets.every((o) => o >= 0 && o <= 255) && mask >= 8 && mask <= 32;
}

function allocateNextVeredaIp() {
  const used = new Set(store.nodes.map((n) => n.veredaIp));
  for (let i = 4; i <= 250; i += 1) {
    const candidate = `100.64.0.${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `100.64.1.${crypto.randomInt(10, 240)}`;
}

function signSessionToken(admin, req) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sid: crypto.randomUUID(),
    uid: admin.id,
    ver: admin.tokenVersion || 1,
    uah: getUserAgentFingerprint(req),
    iat: nowSec,
    exp: nowSec + 60 * 60 * 8 // 8 hours
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
  return { token: `${payloadB64}.${sig}`, payload };
}

function verifySessionToken(token, req) {
  if (typeof token !== 'string' || token.length > 512 || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
  const a = Buffer.from(sigB64, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.sid || !payload.uid || !payload.exp || payload.exp < nowSec) return null;
    if (store.revokedSessions[payload.sid]) return null;
    if (payload.uah && payload.uah !== getUserAgentFingerprint(req)) return null;
    const admin = store.admins.find((u) => u.id === payload.uid);
    if (!admin) return null;
    if ((admin.tokenVersion || 1) !== payload.ver) return null;
    return { admin, payload };
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const result = Object.create(null);
  if (typeof cookieHeader !== 'string' || cookieHeader.length > 4096) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        // Ignore malformed cookie encoding
      }
    }
  }
  return result;
}

function buildCookieFlags(req, httpOnly = true, maxAgeSec = 60 * 60 * 8) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'SameSite=Lax'
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function setAuthCookies(req, res, sessionToken, csrfToken) {
  res.setHeader('Set-Cookie', [
    `vereda_session=${encodeURIComponent(sessionToken)}; ${buildCookieFlags(req, true)}`,
    `vereda_csrf=${encodeURIComponent(csrfToken)}; ${buildCookieFlags(req, false)}`
  ]);
}

function clearAuthCookies(req, res) {
  res.setHeader('Set-Cookie', [
    `vereda_session=; ${buildCookieFlags(req, true, 0)}`,
    `vereda_csrf=; ${buildCookieFlags(req, false, 0)}`
  ]);
}

// Bounded sliding-window in-memory rate limiter (anti-brute-force & anti-OOM)
const MAX_RATE_BUCKETS = 10000;
const rateBuckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateBuckets.entries()) {
    if (entry.resetAt < now) rateBuckets.delete(key);
  }
}, 1000 * 60 * 5).unref();

function checkRateLimit(bucketKey, maxAttempts, windowMs) {
  const now = Date.now();
  if (rateBuckets.size >= MAX_RATE_BUCKETS && !rateBuckets.has(bucketKey)) {
    const firstKey = rateBuckets.keys().next().value;
    if (firstKey) rateBuckets.delete(firstKey);
  }
  const current = rateBuckets.get(bucketKey);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (current.count >= maxAttempts) {
    return { allowed: false, retryAfterSec: Math.ceil((current.resetAt - now) / 1000) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function getClientIp(req) {
  return (req.ip || req.socket?.remoteAddress || '127.0.0.1').slice(0, 64);
}

function isPlainObject(val) {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

// ==============================================================================
// Express App & Hardening Middleware
// ==============================================================================

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  );
  next();
});

app.use(express.json({ limit: '32kb' }));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Payload JSON inválido.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload excede o limite de segurança.' });
  }
  return next(err);
});

// Global API rate limit & plain object guard
app.use('/api/', (req, res, next) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`global:${ip}`, 180, 60 * 1000);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSec));
    return res.status(429).json({ error: 'Muitas requisições. Aguarde alguns instantes.' });
  }
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type deve ser application/json.' });
    }
    if (!isPlainObject(req.body)) {
      return res.status(400).json({ error: 'Corpo JSON inválido.' });
    }
  }
  return next();
});

// Strict Origin / Sec-Fetch-Site verification for mutating endpoints
function verifySameOrigin(req) {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const host = req.headers.host;
  if (!host) return false;

  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (origin === 'null') return false;
    try {
      const parsedOrigin = new URL(origin);
      return parsedOrigin.host === host;
    } catch {
      return false;
    }
  }

  const referer = req.headers.referer;
  if (referer !== undefined) {
    try {
      const parsedReferer = new URL(referer);
      return parsedReferer.host === host;
    } catch {
      return false;
    }
  }

  return true;
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const verified = verifySessionToken(cookies.vereda_session, req);
  if (!verified) {
    return res.status(401).json({ error: 'Sessão expirada ou não autenticada.' });
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!verifySameOrigin(req)) {
      return res.status(403).json({ error: 'Origem da requisição não autorizada.' });
    }
    const headerCsrf = req.headers['x-csrf-token'];
    const cookieCsrf = cookies.vereda_csrf;
    if (
      typeof headerCsrf !== 'string'
      || typeof cookieCsrf !== 'string'
      || headerCsrf.length < 16
      || headerCsrf.length > 128
      || headerCsrf.length !== cookieCsrf.length
      || !crypto.timingSafeEqual(Buffer.from(headerCsrf), Buffer.from(cookieCsrf))
    ) {
      return res.status(403).json({ error: 'Falha na validação CSRF.' });
    }
  }

  req.auth = verified;
  return next();
}

// ==============================================================================
// Authentication Routes
// ==============================================================================

app.get('/api/auth/session', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const verified = verifySessionToken(cookies.vereda_session, req);
  const needsBootstrap = store.admins.length === 0;

  if (!verified) {
    return res.json({
      authenticated: false,
      needsBootstrap
    });
  }

  let csrfToken = cookies.vereda_csrf;
  if (!csrfToken || csrfToken.length < 16) {
    csrfToken = crypto.randomBytes(24).toString('hex');
    res.setHeader('Set-Cookie', `vereda_csrf=${encodeURIComponent(csrfToken)}; ${buildCookieFlags(req, false)}`);
  }

  return res.json({
    authenticated: true,
    needsBootstrap: false,
    csrfToken,
    admin: {
      id: verified.admin.id,
      name: verified.admin.name,
      email: verified.admin.email,
      role: verified.admin.role,
      createdAt: verified.admin.createdAt
    }
  });
});

app.post('/api/auth/register', (req, res) => {
  if (!verifySameOrigin(req)) {
    return res.status(403).json({ error: 'Origem não permitida.' });
  }
  const ip = getClientIp(req);
  const rate = checkRateLimit(`register:${ip}`, 10, 15 * 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ error: `Limite de tentativas excedido. Tente novamente em ${rate.retryAfterSec}s.` });
  }

  const name = sanitizeText(req.body.name, 80);
  const email = normalizeEmail(req.body.email);
  const role = sanitizeText(req.body.role, 60) || 'Administrador de Rede';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const confirmPassword = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';
  const inviteCode = typeof req.body.inviteCode === 'string' ? req.body.inviteCode.trim() : '';

  if (name.length < 2) {
    return res.status(400).json({ error: 'Informe o nome completo do administrador.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Informe um e-mail corporativo válido.' });
  }
  const pwErr = validateStrongPassword(password);
  if (pwErr) {
    return res.status(400).json({ error: pwErr });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'A confirmação de senha não confere.' });
  }

  if (store.admins.some((a) => a.email === email)) {
    return res.status(409).json({ error: 'Não foi possível concluir o cadastro com estes dados.' });
  }

  const isBootstrap = store.admins.length === 0;
  if (!isBootstrap) {
    if (!inviteCode || inviteCode.length > 64) {
      return res.status(403).json({
        error: 'Código de convite administrativo obrigatório após a configuração inicial.'
      });
    }
    const inviteHash = sha256Hex(inviteCode);
    const nowIso = new Date().toISOString();
    const matchedInvite = store.invites.find(
      (inv) => inv.codeHash === inviteHash && !inv.usedAt && inv.expiresAt > nowIso
    );
    if (!matchedInvite) {
      appendAudit('REGISTER_REJECTED', email, ip, 'Tentativa de cadastro com codigo de convite invalido ou expirado.');
      return res.status(403).json({ error: 'Código de convite inválido ou expirado.' });
    }
    matchedInvite.usedAt = nowIso;
    matchedInvite.usedBy = email;
  }

  const recoveryKey = generateRecoveryKey();
  const newAdmin = {
    id: crypto.randomUUID(),
    name,
    email,
    role,
    passwordHash: hashPassword(password),
    recoveryKeyHash: hashPassword(recoveryKey),
    tokenVersion: 1,
    failedAttempts: 0,
    lockedUntil: 0,
    createdAt: new Date().toISOString()
  };

  store.admins.push(newAdmin);
  appendAudit(
    isBootstrap ? 'BOOTSTRAP_ADMIN_CREATED' : 'ADMIN_REGISTERED',
    email,
    ip,
    `Administrador cadastrado (${role}).`
  );

  const { token } = signSessionToken(newAdmin, req);
  const csrfToken = crypto.randomBytes(24).toString('hex');
  setAuthCookies(req, res, token, csrfToken);

  return res.status(201).json({
    authenticated: true,
    csrfToken,
    recoveryKey,
    admin: {
      id: newAdmin.id,
      name: newAdmin.name,
      email: newAdmin.email,
      role: newAdmin.role,
      createdAt: newAdmin.createdAt
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  if (!verifySameOrigin(req)) {
    return res.status(403).json({ error: 'Origem não permitida.' });
  }
  const ip = getClientIp(req);
  const email = normalizeEmail(req.body.email);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  const ipRate = checkRateLimit(`login-ip:${ip}`, 12, 15 * 60 * 1000);
  if (!ipRate.allowed) {
    appendAudit('LOGIN_RATE_LIMITED', email || 'desconhecido', ip, 'Bloqueio por excesso de tentativas no IP.');
    return res.status(429).json({ error: `Muitas tentativas de login. Aguarde ${ipRate.retryAfterSec}s.` });
  }

  if (!isValidEmail(email) || !password || password.length > 128) {
    return res.status(400).json({ error: 'Informe e-mail e senha válidos.' });
  }

  const emailRate = checkRateLimit(`login-email:${email}`, 8, 15 * 60 * 1000);
  if (!emailRate.allowed) {
    appendAudit('LOGIN_EMAIL_RATE_LIMITED', email, ip, 'Bloqueio por excesso de tentativas no e-mail.');
    return res.status(429).json({ error: `Muitas tentativas para esta conta. Aguarde ${emailRate.retryAfterSec}s.` });
  }

  const admin = store.admins.find((a) => a.email === email);
  if (!admin) {
    verifyPassword(password, DUMMY_PASSWORD_HASH);
    appendAudit('LOGIN_FAILED', email, ip, 'Credenciais invalidas.');
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  const now = Date.now();
  if (admin.lockedUntil && admin.lockedUntil > now) {
    const waitSec = Math.ceil((admin.lockedUntil - now) / 1000);
    return res.status(423).json({
      error: `Conta temporariamente bloqueada por segurança. Tente em ${waitSec}s ou utilize a recuperação de senha.`
    });
  }

  if (!verifyPassword(password, admin.passwordHash)) {
    admin.failedAttempts = (admin.failedAttempts || 0) + 1;
    if (admin.failedAttempts >= 5) {
      admin.lockedUntil = now + 15 * 60 * 1000;
      admin.failedAttempts = 0;
      appendAudit('ACCOUNT_LOCKED', email, ip, 'Conta bloqueada apos 5 falhas consecutivas de senha.');
    } else {
      appendAudit('LOGIN_FAILED', email, ip, `Senha incorreta (tentativa ${admin.failedAttempts}/5).`);
    }
    saveStore(store);
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  admin.failedAttempts = 0;
  admin.lockedUntil = 0;
  appendAudit('LOGIN_SUCCESS', email, ip, 'Sessao administrativa iniciada.');

  const { token } = signSessionToken(admin, req);
  const csrfToken = crypto.randomBytes(24).toString('hex');
  setAuthCookies(req, res, token, csrfToken);

  return res.json({
    authenticated: true,
    csrfToken,
    admin: {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      createdAt: admin.createdAt
    }
  });
});

app.post('/api/auth/forgot-password', (req, res) => {
  if (!verifySameOrigin(req)) {
    return res.status(403).json({ error: 'Origem não permitida.' });
  }
  const ip = getClientIp(req);
  const rate = checkRateLimit(`reset:${ip}`, 6, 15 * 60 * 1000);
  if (!rate.allowed) {
    return res.status(429).json({ error: `Limite de recuperação atingido. Aguarde ${rate.retryAfterSec}s.` });
  }

  const email = normalizeEmail(req.body.email);
  const recoveryKey = typeof req.body.recoveryKey === 'string' ? req.body.recoveryKey.trim().toUpperCase() : '';
  const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
  const confirmPassword = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';

  if (!isValidEmail(email) || !isValidRecoveryKeyFormat(recoveryKey)) {
    return res.status(400).json({ error: 'Informe um e-mail válido e a chave de recuperação no formato VRD-XXXX-...' });
  }
  const pwErr = validateStrongPassword(newPassword);
  if (pwErr) {
    return res.status(400).json({ error: pwErr });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'A confirmação da nova senha não confere.' });
  }

  const admin = store.admins.find((a) => a.email === email);
  if (!admin) {
    verifyPassword(recoveryKey, DUMMY_PASSWORD_HASH);
    appendAudit('PASSWORD_RESET_DENIED', email, ip, 'Tentativa de redefinicao com e-mail ou chave invalida.');
    return res.status(401).json({ error: 'E-mail ou chave de recuperação inválidos.' });
  }

  if (!verifyPassword(recoveryKey, admin.recoveryKeyHash)) {
    appendAudit('PASSWORD_RESET_DENIED', email, ip, 'Tentativa de redefinicao com chave invalida.');
    return res.status(401).json({ error: 'E-mail ou chave de recuperação inválidos.' });
  }

  const nextRecoveryKey = generateRecoveryKey();
  admin.passwordHash = hashPassword(newPassword);
  admin.recoveryKeyHash = hashPassword(nextRecoveryKey);
  admin.tokenVersion = (admin.tokenVersion || 1) + 1;
  admin.failedAttempts = 0;
  admin.lockedUntil = 0;

  clearAuthCookies(req, res);
  appendAudit('PASSWORD_RESET_SUCCESS', email, ip, 'Senha redefinida via chave de recuperacao e sessoes anteriores revogadas.');

  return res.json({
    ok: true,
    message: 'Senha redefinida com sucesso. Todas as sessões anteriores foram encerradas.',
    newRecoveryKey: nextRecoveryKey
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const { admin, payload } = req.auth;
  store.revokedSessions[payload.sid] = payload.exp;
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [sid, exp] of Object.entries(store.revokedSessions)) {
    if (exp < nowSec) delete store.revokedSessions[sid];
  }
  appendAudit('LOGOUT', admin.email, getClientIp(req), 'Sessao encerrada pelo administrador.');
  clearAuthCookies(req, res);
  return res.json({ ok: true });
});

// ==============================================================================
// Protected Mesh Network, Nodes, Keys, Scripts & Security Audit Routes
// ==============================================================================

app.get('/api/overview', requireAuth, (req, res) => {
  const nodes = store.nodes;
  const onlineCount = nodes.filter((n) => n.status === 'online').length;
  const offlineCount = nodes.filter((n) => n.status !== 'online').length;

  return res.json({
    tunnel: {
      status: onlineCount > 0 ? 'Operacional' : 'Aguardando nós',
      engine: 'Vereda + SQLite3',
      serverUrl: VEREDA_CONFIG.serverUrl,
      listenAddr: VEREDA_CONFIG.listenAddr,
      metricsAddr: VEREDA_CONFIG.metricsAddr,
      ipv4Prefix: VEREDA_CONFIG.ipv4Prefix,
      ipv6Prefix: VEREDA_CONFIG.ipv6Prefix,
      databaseType: VEREDA_CONFIG.databaseType,
      databasePath: VEREDA_CONFIG.databasePath,
      magicDns: VEREDA_CONFIG.magicDns,
      baseDomain: VEREDA_CONFIG.baseDomain,
      nameservers: VEREDA_CONFIG.nameservers,
      onlineCount,
      offlineCount,
      totalNodes: nodes.length
    },
    nodes,
    preauthKeys: store.preauthKeys.map((k) => ({
      id: k.id,
      user: k.user,
      prefix: k.prefix,
      reusable: k.reusable,
      ephemeral: k.ephemeral,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
      createdBy: k.createdBy
    })),
    admins: store.admins.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      role: a.role,
      createdAt: a.createdAt
    })),
    auditLogs: store.auditLogs.slice(0, 30),
    securityChecks: [
      { id: 'csp', label: 'Content-Security-Policy estrita (sem script-src unsafe-inline)', active: true },
      { id: 'scrypt', label: 'Hashing scrypt com salt criptografico individual + timingSafeEqual', active: true },
      { id: 'cookies', label: 'Sessao HMAC-SHA256 vinculada ao User-Agent em cookie HttpOnly + CSRF', active: true },
      { id: 'ratelimit', label: 'Rate limiting duplo (IP + e-mail) e bloqueio automatico contra forca bruta', active: true },
      { id: 'static', label: 'Isolamento de arquivos sensiveis (server.js, config/ e data/ bloqueados)', active: true },
      { id: 'injection', label: 'Validacao estrita de hostname/CIDR/URL/Content-Type contra injecao e XSS', active: true }
    ]
  });
});

app.post('/api/nodes', requireAuth, (req, res) => {
  const hostname = sanitizeText(req.body.hostname, 63).toLowerCase();
  const environment = ['vps', 'datacenter', 'workstation'].includes(req.body.environment)
    ? req.body.environment
    : 'workstation';
  const osName = sanitizeText(req.body.os, 50) || 'Linux / Vereda';
  const endpoint = sanitizeText(req.body.endpoint, 80) || 'Conexão direta WireGuard';
  const routeInput = sanitizeText(req.body.advertisedRoute, 32);

  if (!isValidHostname(hostname)) {
    return res.status(400).json({ error: 'Hostname inválido. Utilize apenas letras, números e hífen (2 a 63 caracteres).' });
  }
  if (!isValidEndpoint(endpoint)) {
    return res.status(400).json({ error: 'Endpoint contém caracteres não permitidos.' });
  }
  if (store.nodes.some((n) => n.hostname === hostname)) {
    return res.status(409).json({ error: 'Já existe um nó cadastrado com este hostname.' });
  }

  const advertisedRoutes = [];
  if (routeInput) {
    if (!isValidCidr(routeInput)) {
      return res.status(400).json({ error: 'Sub-rede inválida. Use notação CIDR válida (ex.: 192.168.10.0/24).' });
    }
    advertisedRoutes.push(routeInput);
  }

  const roleMap = {
    vps: 'VPS Coordenadora',
    datacenter: 'Data Center Local',
    workstation: 'Estação de Trabalho'
  };

  const now = new Date().toISOString();
  const newNode = {
    id: `node-${crypto.randomUUID().slice(0, 8)}`,
    hostname,
    role: roleMap[environment],
    environment,
    os: osName,
    veredaIp: allocateNextVeredaIp(),
    endpoint,
    advertisedRoutes,
    status: 'online',
    latencyMs: environment === 'vps' ? 12 : environment === 'datacenter' ? 21 : 28,
    lastSeen: now,
    createdAt: now
  };

  store.nodes.push(newNode);
  appendAudit('NODE_CREATED', req.auth.admin.email, getClientIp(req), `No ${hostname} (${newNode.veredaIp}) adicionado.`);

  return res.status(201).json({ node: newNode });
});

app.patch('/api/nodes/:id/status', requireAuth, (req, res) => {
  const id = String(req.params.id || '');
  if (!isValidNodeId(id)) {
    return res.status(400).json({ error: 'Identificador de nó inválido.' });
  }
  const node = store.nodes.find((n) => n.id === id);
  if (!node) {
    return res.status(404).json({ error: 'Nó não encontrado.' });
  }

  const nextStatus = req.body.status === 'offline' ? 'offline' : 'online';
  node.status = nextStatus;
  node.lastSeen = new Date().toISOString();
  node.latencyMs = nextStatus === 'online'
    ? (node.environment === 'vps' ? 14 : node.environment === 'datacenter' ? 22 : 29)
    : null;

  appendAudit('NODE_STATUS_CHANGED', req.auth.admin.email, getClientIp(req), `No ${node.hostname} alterado para ${nextStatus}.`);
  return res.json({ node });
});

app.delete('/api/nodes/:id', requireAuth, (req, res) => {
  const id = String(req.params.id || '');
  if (!isValidNodeId(id)) {
    return res.status(400).json({ error: 'Identificador de nó inválido.' });
  }
  const index = store.nodes.findIndex((n) => n.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Nó não encontrado.' });
  }
  const [removed] = store.nodes.splice(index, 1);
  appendAudit('NODE_REMOVED', req.auth.admin.email, getClientIp(req), `No ${removed.hostname} (${removed.veredaIp}) revogado.`);
  return res.json({ ok: true });
});

app.post('/api/preauth-keys', requireAuth, (req, res) => {
  const user = sanitizeText(req.body.user, 32).toLowerCase() || 'engecema';
  if (!/^[a-z0-9_-]{2,32}$/.test(user)) {
    return res.status(400).json({ error: 'Namespace/usuário inválido (use apenas letras minúsculas, números, _ ou -).' });
  }
  const reusable = Boolean(req.body.reusable);
  const ephemeral = Boolean(req.body.ephemeral);
  const hours = Math.min(Math.max(Number(req.body.expirationHours) || 24, 1), 720);

  const rawKey = `vrd_auth_${crypto.randomBytes(20).toString('hex')}`;
  const now = Date.now();
  const keyRecord = {
    id: `key-${crypto.randomUUID().slice(0, 8)}`,
    user,
    prefix: `${rawKey.slice(0, 16)}...`,
    keyHash: sha256Hex(rawKey),
    reusable,
    ephemeral,
    expiresAt: new Date(now + hours * 3600 * 1000).toISOString(),
    createdAt: new Date(now).toISOString(),
    createdBy: req.auth.admin.email
  };

  store.preauthKeys.unshift(keyRecord);
  if (store.preauthKeys.length > 25) store.preauthKeys.length = 25;
  appendAudit('PREAUTH_KEY_CREATED', req.auth.admin.email, getClientIp(req), `Chave Pre-Auth gerada para namespace ${user} (${hours}h).`);

  return res.status(201).json({
    rawKey,
    record: {
      id: keyRecord.id,
      user: keyRecord.user,
      prefix: keyRecord.prefix,
      reusable: keyRecord.reusable,
      ephemeral: keyRecord.ephemeral,
      expiresAt: keyRecord.expiresAt,
      createdAt: keyRecord.createdAt,
      createdBy: keyRecord.createdBy
    }
  });
});

app.post('/api/admin/invites', requireAuth, (req, res) => {
  const code = `VRD-INV-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  store.invites.unshift({
    id: crypto.randomUUID(),
    codeHash: sha256Hex(code),
    createdBy: req.auth.admin.email,
    createdAt: new Date().toISOString(),
    expiresAt,
    usedAt: null,
    usedBy: null
  });
  if (store.invites.length > 20) store.invites.length = 20;

  appendAudit('ADMIN_INVITE_CREATED', req.auth.admin.email, getClientIp(req), 'Convite de uso unico para novo administrador gerado.');
  return res.status(201).json({ inviteCode: code, expiresAt });
});

app.get('/api/scripts/:name', requireAuth, (req, res) => {
  const entry = ALLOWED_SCRIPTS.get(req.params.name);
  if (!entry || !fs.existsSync(entry.filePath)) {
    return res.status(404).json({ error: 'Script não encontrado.' });
  }
  const content = fs.readFileSync(entry.filePath, 'utf8');
  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
  } else {
    res.setHeader('Content-Type', entry.contentType);
  }
  return res.send(content);
});

// Explicit public static directory (blocks access to server.js, package.json, config/, data/, .vereda_secret)
app.use(express.static(PUBLIC_DIR, { dotfiles: 'deny', index: false }));

app.get('/', (req, res) => {
  res.sendFile(INDEX_PATH);
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint não encontrado.' });
  }
  return res.sendFile(INDEX_PATH);
});

app.listen(PORT, HOST, () => {
  console.log(`Vereda server listening on http://${HOST}:${PORT}`);
});
