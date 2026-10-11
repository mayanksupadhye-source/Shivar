/**
 * NEXORA AUTH GUARD
 * Include this script in ALL protected pages
 * Usage: <script src="auth-guard.js"></script>
 * Then call: AuthGuard.require('farmer') or AuthGuard.require(['farmer','admin'])
 */

const AuthGuard = {

  // ── GET CURRENT USER ──
  getUser() {
    try {
      return JSON.parse(localStorage.getItem('nexora_user') || 'null');
    } catch { return null; }
  },

  // ── GET TOKEN ──
  getToken() {
    return localStorage.getItem('nexora_token');
  },

  // ── VALIDATE TOKEN ──
  // NOTE: this only checks expiry client-side for UI purposes (e.g. redirecting to
  // login before making a request). The REAL verification — checking the signature
  // against JWT_SECRET — always happens server-side in middleware/auth.js on every
  // protected request. A client can't fake a valid signature no matter what this
  // function does; this is just about giving a fast, friendly redirect.
  isTokenValid() {
    const token = this.getToken();
    if (!token) return false;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const payload = JSON.parse(this._base64UrlDecode(parts[1]));
      // Real JWTs store `exp` in SECONDS since epoch, not milliseconds
      return payload.exp * 1000 > Date.now();
    } catch { return false; }
  },

  // JWTs use base64URL encoding (- and _ instead of + and /), which plain atob() can't read
  _base64UrlDecode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    return decodeURIComponent(atob(base64).split('').map(c =>
      '%' + c.charCodeAt(0).toString(16).padStart(2, '0')
    ).join(''));
  },

  // ── REQUIRE AUTH + ROLE ──
  require(allowedRoles) {
    const user = this.getUser();
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

    if (!user || !this.isTokenValid()) {
      this.redirectToLogin('Session expired. Please login again.');
      return false;
    }

    if (!roles.includes(user.role)) {
      this.redirectToLogin(`Access denied. This page requires: ${roles.join(' or ')} role.`);
      return false;
    }

    // Inject user info into page
    this.injectUserBadge(user);
    return true;
  },

  // ── SAVE SESSION ── stores the REAL token + user returned by the backend after login/verify-otp
  saveSession(token, user) {
    localStorage.setItem('nexora_token', token);
    localStorage.setItem('nexora_user', JSON.stringify(user));
  },

  // ── LOGOUT ──
  logout() {
    localStorage.removeItem('nexora_token');
    localStorage.removeItem('nexora_user');
    window.location.href = 'auth.html';
  },

  // ── REDIRECT ──
  redirectToLogin(msg) {
    if (msg) sessionStorage.setItem('nexora_auth_msg', msg);
    window.location.href = 'auth.html';
  },

  // ── INJECT USER BADGE into sidebar ──
  injectUserBadge(user) {
    const nameEl = document.querySelector('.user-name');
    const roleEl = document.querySelector('.user-role');
    const avatarEl = document.querySelector('.avatar');

    if (nameEl) nameEl.textContent = user.name || 'User';
    if (roleEl) roleEl.textContent = `${user.role.charAt(0).toUpperCase() + user.role.slice(1)} · ${user.district || 'India'}`;
    if (avatarEl) {
      const icons = { farmer: '👨‍🌾', buyer: '🏭', logistics: '🚚' };
      avatarEl.textContent = icons[user.role] || '👤';
    }

    // Add logout to all logout buttons
    document.querySelectorAll('.logout-btn, [data-action="logout"]').forEach(btn => {
      btn.addEventListener('click', () => AuthGuard.logout());
    });
  },

  // ── HASH PASSWORD (SHA-256 mock) ──
  async hashPassword(pwd) {
    const enc = new TextEncoder().encode(pwd + 'NEXORA_SALT_2025');
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  },

  // ── ENCRYPT AADHAAR (AES mock for demo) ──
  encryptField(value) {
    return btoa(value.split('').reverse().join('') + '_NEXORA_AES256');
  },

  // ── DECRYPT (for display only, last 4 digits) ──
  maskAadhaar(encrypted) {
    try {
      const decoded = atob(encrypted).replace('_NEXORA_AES256','');
      const original = decoded.split('').reverse().join('');
      return `XXXX XXXX ${original.slice(-4)}`;
    } catch { return 'XXXX XXXX XXXX'; }
  }
};

// ── AUTO-SHOW AUTH MESSAGE ──
window.addEventListener('DOMContentLoaded', () => {
  const msg = sessionStorage.getItem('nexora_auth_msg');
  if (msg) {
    sessionStorage.removeItem('nexora_auth_msg');
    const alert = document.getElementById('alert');
    if (alert) {
      alert.textContent = msg;
      alert.className = 'alert error show';
    }
  }
});