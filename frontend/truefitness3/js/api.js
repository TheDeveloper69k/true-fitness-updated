// ── TRUE FITNESS — API FOUNDATION ──
// FILE LOCATION: truefitness 3/js/api.js

const API_BASE = 'https://true-fitness-updated-production.up.railway.app/api/v1';

// ─────────────────────────────────────────────
// TOKEN HELPERS
// ─────────────────────────────────────────────

let _accessToken = localStorage.getItem('tf_token') || null;

function setAccessToken(token) {
  _accessToken = token;
  if (token) localStorage.setItem('tf_token', token);
  else localStorage.removeItem('tf_token');
}

function getAccessToken() { return _accessToken; }
function clearAccessToken() { setAccessToken(null); }

// ─────────────────────────────────────────────
// SESSION HELPERS
// ─────────────────────────────────────────────

function setSession(user) {
  localStorage.setItem('tf_user', JSON.stringify(user));
}

function getSession() {
  try { return JSON.parse(localStorage.getItem('tf_user')); }
  catch { return null; }
}

function clearSession() {
  localStorage.removeItem('tf_user');
  localStorage.removeItem('tf_token');
}

// ─────────────────────────────────────────────
// ROOT PATH HELPER
// ─────────────────────────────────────────────

function rootPath() {
  const path = window.location.pathname;
  if (path.includes('/pages/admin/') || path.includes('/pages/user/')) return '../../';
  if (path.includes('/pages/')) return '../';
  return '';
}

function goTo(path) {
  window.location.href = rootPath() + path;
}

// ─────────────────────────────────────────────
// CORE FETCH WRAPPER
// ─────────────────────────────────────────────

async function apiFetch(endpoint, options = {}) {
  const token = getAccessToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      // ✅ REMOVED credentials: 'include' — not needed for JWT auth
      // Using credentials: 'include' with a wildcard CORS origin causes 403 preflight failures
    });

    let data = {};
    try { data = await res.json(); } catch { }

    if (res.status === 401) {
      clearAccessToken();
      clearSession();
      window.location.href = rootPath() + 'index.html';
      return null;
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error('[apiFetch] Network error:', err.message);
    return null;
  }
}

const API = {
  get: (endpoint) => apiFetch(endpoint),
  post: (endpoint, body) => apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint, body) => apiFetch(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (endpoint, body) => apiFetch(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint) => apiFetch(endpoint, { method: 'DELETE' }),
};
