/**
 * NEXORA BLOCKCHAIN LAYER
 * Lightweight blockchain simulation for hackathon demo
 * Simulates: Ethereum-like chain with SHA-256 hashing
 * Use: NexoraChain.addBlock(data) → returns {hash, blockId, timestamp}
 */

const NexoraChain = (() => {

  // ── GENESIS BLOCK ──
  const GENESIS = {
    blockId: 0,
    timestamp: '2025-01-01T00:00:00.000Z',
    data: { type: 'GENESIS', message: 'Nexora Chain Initialized' },
    previousHash: '0000000000000000',
    hash: 'a3f8c2d1e9b7654321fedcba9876543210abcdef1234567890abcdef12345678',
    nonce: 0
  };

  // ── LOAD CHAIN FROM STORAGE ──
  function loadChain() {
    try {
      return JSON.parse(localStorage.getItem('nexora_blockchain') || 'null') || [GENESIS];
    } catch { return [GENESIS]; }
  }

  function saveChain(chain) {
    localStorage.setItem('nexora_blockchain', JSON.stringify(chain));
  }

  // ── SHA-256 HASH (Web Crypto API) ──
  async function sha256(message) {
    const enc = new TextEncoder().encode(message);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  // ── MINE BLOCK (Proof of Work simulation) ──
  async function mineBlock(data, previousHash, blockId) {
    let nonce = 0;
    let hash = '';
    // Simple PoW: find hash starting with '0' (difficulty=1 for demo speed)
    do {
      nonce++;
      const content = JSON.stringify({ blockId, data, previousHash, nonce, timestamp: new Date().toISOString() });
      hash = await sha256(content);
    } while (!hash.startsWith('0') && nonce < 1000);
    return { hash, nonce };
  }

  // ── ADD BLOCK ──
  async function addBlock(data) {
    const chain = loadChain();
    const prev = chain[chain.length - 1];
    const blockId = prev.blockId + 1;
    const timestamp = new Date().toISOString();
    const { hash, nonce } = await mineBlock(data, prev.hash, blockId);

    const block = {
      blockId,
      timestamp,
      data,
      previousHash: prev.hash,
      hash,
      nonce,
      txHash: '0x' + hash.slice(0, 40), // Ethereum-style tx hash
      verified: true,
    };

    chain.push(block);
    saveChain(chain);
    return block;
  }

  // ── GET CHAIN ──
  function getChain() {
    return loadChain();
  }

  // ── VERIFY CHAIN INTEGRITY ──
  function verifyChain() {
    const chain = loadChain();
    for (let i = 1; i < chain.length; i++) {
      if (chain[i].previousHash !== chain[i-1].hash) return false;
    }
    return true;
  }

  // ── GET RECORDS BY TYPE ──
  function getByType(type) {
    return loadChain().filter(b => b.data && b.data.type === type);
  }

  // ── GET RECORDS BY FARMER ──
  function getByFarmer(farmerId) {
    return loadChain().filter(b => b.data && b.data.farmerId === farmerId);
  }

  // ── RECORD TYPES ──
  const RecordTypes = {
    CROP_REGISTRATION: 'CROP_REGISTRATION',
    FARMER_OWNERSHIP: 'FARMER_OWNERSHIP',
    SUPPLY_CHAIN: 'SUPPLY_CHAIN',
    PESTICIDE_LOG: 'PESTICIDE_LOG',
    WAREHOUSE_STORAGE: 'WAREHOUSE_STORAGE',
    BUYER_TRANSACTION: 'BUYER_TRANSACTION',
    PRICE_AGREEMENT: 'PRICE_AGREEMENT',
  };

  // ── CONVENIENCE METHODS ──
  async function registerCrop(farmerData, cropData) {
    return addBlock({
      type: RecordTypes.CROP_REGISTRATION,
      farmerId: farmerData.mobile || farmerData.id,
      farmerName: farmerData.name,
      ...cropData,
      registeredBy: 'NEXORA_PLATFORM',
    });
  }

  async function recordTransaction(buyerData, farmerData, tradeData) {
    return addBlock({
      type: RecordTypes.BUYER_TRANSACTION,
      buyerId: buyerData.id,
      buyerName: buyerData.name,
      farmerId: farmerData.id,
      farmerName: farmerData.name,
      ...tradeData,
      platform: 'NEXORA',
    });
  }

  async function logPesticide(farmerId, logData) {
    return addBlock({
      type: RecordTypes.PESTICIDE_LOG,
      farmerId,
      ...logData,
    });
  }

  async function recordSupplyChain(movement) {
    return addBlock({
      type: RecordTypes.SUPPLY_CHAIN,
      ...movement,
    });
  }

  return {
    addBlock, getChain, verifyChain, getByType, getByFarmer,
    registerCrop, recordTransaction, logPesticide, recordSupplyChain,
    RecordTypes, GENESIS
  };
})();


/**
 * BLOCKCHAIN UI RENDERER
 * Call: BlockchainUI.renderHistory(containerId, records)
 */
const BlockchainUI = {

  renderHistory(containerId, records) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!records || records.length === 0) {
      container.innerHTML = `<div style="text-align:center;color:#a89e85;padding:2rem;font-size:0.9rem;">No blockchain records yet. Register a crop to begin.</div>`;
      return;
    }

    container.innerHTML = records.slice().reverse().map((block, i) => `
      <div class="bc-block" style="
        background:rgba(15,21,8,0.7);border:1px solid rgba(90,138,53,0.25);
        border-radius:12px;padding:1.1rem;margin-bottom:0.8rem;
        border-left:3px solid ${this.typeColor(block.data?.type)};
        animation: fadeUp 0.4s ${i*0.05}s ease both;
      ">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.5rem;">
              <span style="font-size:1.1rem;">${this.typeIcon(block.data?.type)}</span>
              <span style="font-size:0.85rem;font-weight:700;color:#f0ead8;">${this.typeLabel(block.data?.type)}</span>
              <span style="font-size:0.7rem;padding:0.15rem 0.5rem;border-radius:4px;background:rgba(90,138,53,0.2);color:#8fbf3f;">Block #${block.blockId}</span>
              ${block.verified ? '<span style="font-size:0.68rem;padding:0.15rem 0.5rem;border-radius:4px;background:rgba(74,122,224,0.2);color:#6a9af0;">✓ Verified</span>' : ''}
            </div>
            <div style="font-family:monospace;font-size:0.72rem;color:#6a9af0;margin-bottom:0.4rem;word-break:break-all;">
              TX: ${block.txHash || '0x' + block.hash?.slice(0,40)}
            </div>
            <div style="font-size:0.78rem;color:#a89e85;">
              ${this.renderData(block.data)}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:0.72rem;color:#a89e85;">${new Date(block.timestamp).toLocaleString('en-IN')}</div>
            <button onclick="BlockchainUI.verifyBlock('${block.hash}')" style="
              margin-top:0.5rem;background:transparent;border:1px solid rgba(90,138,53,0.3);
              color:#8fbf3f;padding:0.25rem 0.6rem;border-radius:6px;font-size:0.72rem;cursor:pointer;
            ">🔍 Verify</button>
          </div>
        </div>
        <div style="margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid rgba(255,255,255,0.05);font-family:monospace;font-size:0.65rem;color:rgba(255,255,255,0.25);">
          HASH: ${block.hash}
        </div>
      </div>
    `).join('');
  },

  typeColor(type) {
    const map = {
      CROP_REGISTRATION: '#8fbf3f', FARMER_OWNERSHIP: '#d4a832',
      SUPPLY_CHAIN: '#4a7ae0', PESTICIDE_LOG: '#e05252',
      WAREHOUSE_STORAGE: '#8b5cf6', BUYER_TRANSACTION: '#06b6d4',
      PRICE_AGREEMENT: '#f59e0b', GENESIS: '#6b7280',
    };
    return map[type] || '#a89e85';
  },

  typeIcon(type) {
    const map = {
      CROP_REGISTRATION:'🌾', FARMER_OWNERSHIP:'👨‍🌾', SUPPLY_CHAIN:'🚛',
      PESTICIDE_LOG:'🧪', WAREHOUSE_STORAGE:'🏪', BUYER_TRANSACTION:'💰',
      PRICE_AGREEMENT:'🤝', GENESIS:'⛓️',
    };
    return map[type] || '📦';
  },

  typeLabel(type) {
    return (type || 'RECORD').replace(/_/g,' ');
  },

  renderData(data) {
    if (!data) return '';
    const skip = ['type','registeredBy','platform'];
    return Object.entries(data)
      .filter(([k]) => !skip.includes(k))
      .slice(0,4)
      .map(([k,v]) => `<span style="margin-right:1rem;"><span style="color:#8fbf3f">${k}:</span> ${v}</span>`)
      .join('');
  },

  verifyBlock(hash) {
    const chain = NexoraChain.getChain();
    const block = chain.find(b => b.hash === hash);
    if (block) {
      alert(`✅ Block Verified!\n\nBlock ID: #${block.blockId}\nHash: ${block.hash}\nTimestamp: ${block.timestamp}\nPrevious Hash: ${block.previousHash}\n\nThis record is IMMUTABLE on the Nexora chain.`);
    } else {
      alert('❌ Block not found or tampered!');
    }
  }
};