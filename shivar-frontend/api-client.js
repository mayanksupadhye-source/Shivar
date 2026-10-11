/**
 * NEXORA API CLIENT
 * All real backend calls (REST + Socket.io) live here.
 * Include AFTER auth-guard.js and the Socket.io CDN script, BEFORE your page's own <script>.
 *
 * ── IMPORTANT ──
 * Change API_BASE below once you deploy the backend (Render URL etc.)
 */

const API_BASE = window.NEXORA_API_BASE || 'http://localhost:5000';

// ── Low-level request wrapper: adds JSON headers + auth token + error handling ──
async function apiRequest(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = AuthGuard.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const NexoraAPI = {

  // ══════════ AUTH ══════════
  signup(payload) { return apiRequest('/api/auth/signup', { method: 'POST', body: payload, auth: false }); },
  verifyOtp(userId, otp) { return apiRequest('/api/auth/verify-otp', { method: 'POST', body: { userId, otp }, auth: false }); },
  resendOtp(userId) { return apiRequest('/api/auth/resend-otp', { method: 'POST', body: { userId }, auth: false }); },
  login(identifier, password) { return apiRequest('/api/auth/login', { method: 'POST', body: { identifier, password }, auth: false }); },

  // ══════════ LISTINGS ══════════
  getListings(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/api/listings${qs ? '?' + qs : ''}`, { auth: false });
  },
  getMyListings(farmerId) { return this.getListings({ farmer: farmerId, status: 'all' }); },
  createListing(payload) { return apiRequest('/api/listings', { method: 'POST', body: payload }); },
  updateListing(id, payload) { return apiRequest(`/api/listings/${id}`, { method: 'PUT', body: payload }); },
  deleteListing(id) { return apiRequest(`/api/listings/${id}`, { method: 'DELETE' }); },

  // ══════════ BIDS ══════════
  createBid(payload) { return apiRequest('/api/bids', { method: 'POST', body: payload }); },
  getBidsForListing(listingId) { return apiRequest(`/api/bids/listing/${listingId}`); },
  getMyBidsAsBuyer() { return apiRequest('/api/bids/my'); },
  getMyBidsAsFarmer() { return apiRequest('/api/bids/mine'); },
  acceptBid(bidId) { return apiRequest(`/api/bids/${bidId}/accept`, { method: 'PUT' }); },
  rejectBid(bidId) { return apiRequest(`/api/bids/${bidId}/reject`, { method: 'PUT' }); },
  cancelBid(bidId) { return apiRequest(`/api/bids/${bidId}`, { method: 'DELETE' }); },

  // ══════════ ORDERS ══════════
  getMyOrders() { return apiRequest('/api/orders/my'); },
  updateOrderStatus(orderId, status) { return apiRequest(`/api/orders/${orderId}/status`, { method: 'PUT', body: { status } }); },

  // ══════════ CHAT (history) ══════════
  getChatHistory(listingId, otherUserId) { return apiRequest(`/api/chat/${listingId}/${otherUserId}`); },
  getInbox() { return apiRequest('/api/chat/inbox/all'); },

  // ══════════ AI SMART MATCHING ══════════
  smartMatchBuyerToFarmer(payload) { return apiRequest('/api/matching/buyer-to-farmer', { method: 'POST', body: payload, auth: false }); },
  smartMatchFarmerToBuyer(payload) { return apiRequest('/api/matching/farmer-to-buyer', { method: 'POST', body: payload, auth: false }); },
};

// ══════════ REAL-TIME CHAT SOCKET ══════════
const NexoraSocket = {
  socket: null,

  connect() {
    if (this.socket) return this.socket;
    const token = AuthGuard.getToken();
    if (!token || typeof io === 'undefined') return null;

    this.socket = io(API_BASE, { auth: { token } });
    return this.socket;
  },

  joinConversation(listingId, otherUserId) {
    const s = this.connect();
    if (s) s.emit('join_conversation', { listingId, otherUserId });
  },

  sendMessage(listingId, otherUserId, text) {
    const s = this.connect();
    if (s) s.emit('send_message', { listingId, otherUserId, text });
  },

  onMessage(callback) {
    const s = this.connect();
    if (s) s.on('new_message', callback);
  },
};