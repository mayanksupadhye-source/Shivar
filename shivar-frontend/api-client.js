/**
 * SHIVAR API CLIENT
 * Real backend calls (REST + Socket.io) across Farmer, Buyer, and Logistics.
 * Include AFTER auth-guard.js and the Socket.io CDN script, BEFORE your page's own <script>.
 */

const API_BASE = window.NEXORA_API_BASE || window.SHIVAR_API_BASE || 'http://localhost:5000';

// ── Low-level request wrapper: adds JSON headers + auth token + error handling ──
async function apiRequest(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && typeof AuthGuard !== 'undefined') {
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
  getMe() { return apiRequest('/api/auth/me'); },

  // ══════════ LISTINGS ══════════
  async getListings(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await apiRequest(`/api/listings${qs ? '?' + qs : ''}`, { auth: false });
    // Support both direct array and paginated object { listings: [...] }
    if (Array.isArray(res)) return res;
    const list = res.listings || [];
    list.total = res.total;
    list.page = res.page;
    list.totalPages = res.totalPages;
    return list;
  },
  getMyListings(farmerId) { return this.getListings({ farmer: farmerId, status: 'all' }); },
  getListing(id) { return apiRequest(`/api/listings/${id}`, { auth: false }); },
  createListing(payload) { return apiRequest('/api/listings', { method: 'POST', body: payload }); },
  updateListing(id, payload) { return apiRequest(`/api/listings/${id}`, { method: 'PUT', body: payload }); },
  deleteListing(id) { return apiRequest(`/api/listings/${id}`, { method: 'DELETE' }); },

  // ══════════ DEMAND ══════════
  async getDemands(params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await apiRequest(`/api/demand${qs ? '?' + qs : ''}`, { auth: false });
    if (Array.isArray(res)) return res;
    const list = res.demands || [];
    list.total = res.total;
    list.page = res.page;
    list.totalPages = res.totalPages;
    return list;
  },
  getDemand(id) { return apiRequest(`/api/demand/${id}`, { auth: false }); },
  createDemand(payload) { return apiRequest('/api/demand', { method: 'POST', body: payload }); },
  updateDemand(id, payload) { return apiRequest(`/api/demand/${id}`, { method: 'PUT', body: payload }); },
  deleteDemand(id) { return apiRequest(`/api/demand/${id}`, { method: 'DELETE' }); },

  // ══════════ BIDS ══════════
  createBid(payload) { return apiRequest('/api/bids', { method: 'POST', body: payload }); },
  getBidsForListing(listingId) { return apiRequest(`/api/bids/listing/${listingId}`); },
  getMyBidsAsBuyer() { return apiRequest('/api/bids/my'); },
  getMyBidsAsFarmer() { return apiRequest('/api/bids/mine'); },
  acceptBid(bidId) { return apiRequest(`/api/bids/${bidId}/accept`, { method: 'PUT' }); },
  rejectBid(bidId) { return apiRequest(`/api/bids/${bidId}/reject`, { method: 'PUT' }); },
  cancelBid(bidId) { return apiRequest(`/api/bids/${bidId}`, { method: 'DELETE' }); },

  // ══════════ TRANSACTIONS & ORDERS ══════════
  getMyOrders() { return apiRequest('/api/orders/my'); },
  updateOrderStatus(orderId, status) { return apiRequest(`/api/orders/${orderId}/status`, { method: 'PUT', body: { status } }); },
  getTransactions(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return apiRequest(`/api/transactions${qs ? '?' + qs : ''}`);
  },
  getTransaction(id) { return apiRequest(`/api/transactions/${id}`); },
  claimDelivery(id) { return apiRequest(`/api/transactions/${id}/claim`, { method: 'POST' }); },
  confirmLogistics(id) { return apiRequest(`/api/logistics/transactions/${id}/confirm-logistics`, { method: 'POST' }); },
  updateTransactionStatus(id, status) { return apiRequest(`/api/transactions/${id}/status`, { method: 'PUT', body: { status } }); },

  // ══════════ CHAT & CONVERSATIONS ══════════
  getChatHistory(contextId, otherUserId) { return apiRequest(`/api/chat/${contextId}/${otherUserId}`); },
  getInbox() { return apiRequest('/api/chat/inbox/all'); },

  // ══════════ AI SMART MATCHING ══════════
  smartMatchBuyerToFarmer(payload) { return apiRequest('/api/matching/buyer-to-farmer', { method: 'POST', body: payload, auth: false }); },
  smartMatchFarmerToBuyer(payload) { return apiRequest('/api/matching/farmer-to-buyer', { method: 'POST', body: payload, auth: false }); },
};

// ══════════ UNIFIED REAL-TIME SOCKET ══════════
const NexoraSocket = {
  socket: null,

  connect() {
    if (this.socket && this.socket.connected) return this.socket;
    const token = typeof AuthGuard !== 'undefined' ? AuthGuard.getToken() : localStorage.getItem('nexora_token');
    if (!token || typeof io === 'undefined') return null;

    this.socket = io(API_BASE, { auth: { token } });

    this.socket.on('connect', () => {
      console.log('⚡ Unified socket connected to SHIVAR backend');
    });

    this.socket.on('connect_error', (err) => {
      console.warn('Socket connect error:', err.message);
    });

    return this.socket;
  },

  joinConversation(contextId, otherUserId) {
    const s = this.connect();
    if (s) {
      s.emit('join_conversation', { listingId: contextId, transactionId: contextId, otherUserId });
    }
  },

  sendMessage(contextId, otherUserId, text) {
    const s = this.connect();
    if (s) {
      s.emit('send_message', { listingId: contextId, transactionId: contextId, otherUserId, text });
    }
  },

  onMessage(callback) {
    const s = this.connect();
    if (s) {
      const seen = new Set();
      const handler = (msg) => {
        const id = String(msg._id || msg.id || '');
        if (id && seen.has(id)) return;
        if (id) seen.add(id);
        callback(msg);
      };
      s.on('new_message', handler);
      s.on('logistics_new_message', handler);
    }
  },
};

window.NexoraAPI = NexoraAPI;
window.ShivarAPI = NexoraAPI;
window.NexoraSocket = NexoraSocket;
window.ShivarSocket = NexoraSocket;