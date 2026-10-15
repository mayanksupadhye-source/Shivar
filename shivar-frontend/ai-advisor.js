/**
 * NEXORA AI ADVISOR — frontend
 * Talks to the backend proxy (server.js). The OpenAI key never reaches the browser.
 * If the proxy is unreachable, shows a clearly labelled, crop-aware offline fallback.
 */

const nxEsc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nxText = (v) => (Array.isArray(v) ? v.join('\n') : v ?? '');

const NexoraAI = (() => {

  // ── CONFIG ──
  const API_BASE = window.NEXORA_API_BASE || 'http://localhost:5000';

  // Approximate ideal ranges, used only by the offline fallback
  const CROP_CLIMATE = {
    rice:      { rain: [1000, 2000], temp: [20, 35] },
    sugarcane: { rain: [1100, 1500], temp: [21, 35] },
    turmeric:  { rain: [1200, 2000], temp: [20, 30] },
    onion:     { rain: [650, 750],   temp: [15, 30] },
    cotton:    { rain: [600, 1000],  temp: [21, 35] },
    wheat:     { rain: [400, 650],   temp: [10, 25] },
    soybean:   { rain: [600, 1000],  temp: [20, 32] },
    maize:     { rain: [600, 1100],  temp: [21, 30] },
  };

  // ── API CALLS (through the backend proxy) ──
  async function post(path, body) {
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }

  // Throws on failure, so the UI can tell live results from fallback ones
  function analyzeCrop(inputs) {
    return post('/api/advisor/analyze', inputs);
  }

  // Streaming chat: calls onToken(textSoFar) as words arrive, resolves with the full reply
  async function chatStream(messages, context, onToken) {
    const res = await fetch(API_BASE + '/api/advisor/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `Server error ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let full = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // keep a partial line for the next read
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return full;
        let evt;
        try { evt = JSON.parse(data); } catch { continue; }
        if (evt.error) throw new Error(evt.error);
        if (evt.token) { full += evt.token; onToken(full); }
      }
    }
    return full;
  }

  // ── OFFLINE FALLBACK ──
  function climateFor(inputs) {
    const c = CROP_CLIMATE[(inputs.crop || '').toLowerCase()];
    if (!c) {
      return { verdict: 'Unknown', idealRainfall: 'N/A', idealTemperature: 'N/A', note: 'No offline climate data for this crop.' };
    }
    const rain = parseFloat(inputs.rainfall);
    const temp = parseFloat(inputs.temperature);
    const rainOk = rain >= c.rain[0] && rain <= c.rain[1];
    const tempOk = temp >= c.temp[0] && temp <= c.temp[1];
    const notes = [];
    if (isNaN(rain)) notes.push('Rainfall not provided.');
    else if (!rainOk) notes.push(`Rainfall of ${rain} mm is ${rain < c.rain[0] ? 'below' : 'above'} the ideal range, so plan ${rain < c.rain[0] ? 'supplementary irrigation' : 'good drainage'}.`);
    else notes.push(`Rainfall of ${rain} mm suits this crop.`);
    if (isNaN(temp)) notes.push('Temperature not provided.');
    else if (!tempOk) notes.push(`Temperature of ${temp}°C is ${temp < c.temp[0] ? 'below' : 'above'} the ideal range.`);
    else notes.push(`Temperature of ${temp}°C suits this crop.`);
    return {
      verdict: rainOk && tempOk ? 'Suitable' : rainOk || tempOk ? 'Marginal' : 'Unsuitable',
      idealRainfall: `${c.rain[0]}–${c.rain[1]} mm`,
      idealTemperature: `${c.temp[0]}–${c.temp[1]} °C`,
      note: notes.join(' '),
    };
  }

  function getFallbackResponse(inputs) {
    const crop = (inputs.crop || '').toLowerCase();

    const cropDB = {
      cotton: {
        disease: 'Cotton Bollworm (Helicoverpa armigera)',
        confidence: 'High — Bollworm is the #1 threat to Maharashtra cotton during Kharif',
        prevention: ['Remove and destroy infected bolls immediately','Apply Neem-based pesticide spray every 10 days','Use pheromone traps (5/acre) for monitoring','Intercrop with pigeonpea to reduce pest pressure'],
        pesticide: { name: 'Emamectin Benzoate 5% SG', dosage: '220ml per acre, spray in evening', caution: 'Wear gloves and mask. Do not spray near water bodies.' },
        soilAdvice: 'Cotton needs deep black soil (vertisols). Add gypsum (200 kg/acre) if soil crusts. Maintain pH 6.0–8.0.',
        fertilizerPlan: 'NPK 60:30:30 kg/acre. Apply 50% N at sowing, rest in 2 splits. Add Zinc sulfate 10 kg/acre.',
        yieldOptimization: '1) Use BT cotton hybrid for bollworm resistance\n2) Irrigation at flowering & boll formation is critical\n3) Topping (removing terminal buds) increases lateral branching',
        govtScheme: 'PM Fasal Bima Yojana (PMFBY) — Crop insurance for cotton. Apply via your nearest CSC center.',
        hindiSummary: 'आपकी कपास की फसल में बॉलवर्म का प्रकोप दिख रहा है। इमामेक्टिन बेंजोएट का छिड़काव करें और नीम आधारित कीटनाशक का उपयोग करें।',
        urgency: 'immediate',
      },
      wheat: {
        disease: 'Yellow Rust (Puccinia striiformis)',
        confidence: 'Medium — Yellow stripe pattern on leaves is classic Yellow Rust indicator',
        prevention: ['Apply fungicide within 48 hours of detection','Remove infected plant material from field','Ensure adequate spacing for air circulation','Avoid excessive nitrogen fertilization'],
        pesticide: { name: 'Propiconazole 25% EC', dosage: '200ml in 200L water per acre', caution: 'Pre-harvest interval: 14 days. Store in cool, dry place.' },
        soilAdvice: 'Wheat prefers loamy soil with pH 6–7.5. Apply FYM (Farm Yard Manure) 10 tonnes/acre before sowing.',
        fertilizerPlan: 'NPK 120:60:40 kg/ha. Apply all P&K + 1/3 N as basal. Remaining N in 2 top dressings.',
        yieldOptimization: '1) Timely sowing (Nov 1–15 in North India) is most critical\n2) Irrigation at Crown Root Initiation (CRI) stage doubles yield\n3) Use certified rust-resistant variety like HD-3086',
        govtScheme: 'Sell through APMC or the e-NAM portal and check the current MSP for wheat.',
        hindiSummary: 'गेहूं में पीला रतुआ रोग के लक्षण हैं। प्रोपिकोनाज़ोल फफूंदनाशक का तुरंत छिड़काव करें।',
        urgency: 'immediate',
      },
      soybean: {
        disease: 'Soybean Yellow Mosaic Virus (SYMV)',
        confidence: 'High — Yellow mosaic pattern is characteristic of SYMV, transmitted by whitefly',
        prevention: ['Remove and burn infected plants to prevent spread','Control whitefly vector with yellow sticky traps','Spray imidacloprid to control whitefly population','Use virus-free certified seeds next season'],
        pesticide: { name: 'Imidacloprid 17.8% SL (for whitefly control)', dosage: '150ml per acre in 200L water', caution: 'Do not apply during flowering to protect bees.' },
        soilAdvice: 'Soybean fixes nitrogen — inoculate seeds with Rhizobium culture before sowing. Avoid waterlogging.',
        fertilizerPlan: 'Phosphorus 60 kg/ha + Potash 40 kg/ha as basal. Avoid heavy N (disrupts N-fixation).',
        yieldOptimization: '1) Seed treatment with Thiram + Carbendazim prevents seedling diseases\n2) Narrow row spacing (30cm) increases yield\n3) Harvest when 95% pods are mature (pod rattle test)',
        govtScheme: 'NMOOP (National Mission on Oilseeds) provides subsidy on certified soybean seeds. Contact district agriculture office.',
        hindiSummary: 'सोयाबीन में पीला मोज़ेक वायरस का संक्रमण है। सफ़ेद मक्खी को नियंत्रित करें और संक्रमित पौधों को उखाड़ें।',
        urgency: 'immediate',
      },
    };

    const generic = {
      disease: `Possible fungal or pest stress in ${inputs.crop || 'your crop'} (offline estimate)`,
      confidence: 'Low — offline mode cannot analyse symptoms. Start the backend for live AI analysis.',
      prevention: ['Improve field drainage to reduce humidity','Scout the field twice a week for early symptoms','Rotate crops next season to break the disease cycle','Avoid overhead irrigation'],
      pesticide: { name: 'Mancozeb 75% WP (general fungicide)', dosage: '2.5g per litre of water, spray every 7-10 days', caution: 'Use PPE and confirm with your local KVK before spraying.' },
      soilAdvice: `Get a soil test done for your ${inputs.crop || 'crop'} field and add compost to improve soil structure.`,
      fertilizerPlan: 'Base the NPK dose on a soil health card. Confirm the crop-specific schedule with your KVK.',
      yieldOptimization: '1) Follow soil health card recommendations\n2) Schedule irrigation to crop stage\n3) Use an Integrated Pest Management (IPM) approach',
      govtScheme: 'Soil Health Card Scheme — free soil testing. Contact your Krishi Vigyan Kendra (KVK).',
      hindiSummary: 'ऑफ़लाइन मोड में सामान्य सलाह दिखाई गई है। सटीक सलाह के लिए AI सर्वर चालू करें।',
      urgency: 'monitor',
    };

    return { ...(cropDB[crop] || generic), climate: climateFor(inputs) };
  }

  return { analyzeCrop, chatStream, getFallbackResponse };
})();


/**
 * AI UI CONTROLLER
 */
const AIAdvisorUI = {
  resultId: 'ai-result',
  context: {},
  chatHistory: [],
  lastError: '',

  async run(formId, resultId) {
    const form = document.getElementById(formId);
    const result = document.getElementById(resultId);
    if (!form || !result) return;
    this.resultId = resultId;

    const inputs = {
      crop: form.querySelector('[name="crop"]')?.value || '',
      soilType: form.querySelector('[name="soilType"]')?.value || '',
      rainfall: form.querySelector('[name="rainfall"]')?.value || '',
      temperature: form.querySelector('[name="temperature"]')?.value || '',
      fertilizer: form.querySelector('[name="fertilizer"]')?.value || '',
      leafSymptoms: form.querySelector('[name="leafSymptoms"]')?.value || '',
      pestSymptoms: form.querySelector('[name="pestSymptoms"]')?.value || '',
      region: form.querySelector('[name="region"]')?.value || '',
      season: form.querySelector('[name="season"]')?.value || 'Kharif',
    };

    if (!inputs.crop) { this.showError(result, 'Please select a crop first.'); return; }

    this.showLoading(result, inputs.crop);

    let data;
    let isFallback = false;
    try {
      data = await NexoraAI.analyzeCrop(inputs);
      this.lastError = '';
    } catch (err) {
      console.error('AI request failed, using offline fallback:', err);
      this.lastError = err.message;
      data = NexoraAI.getFallbackResponse(inputs);
      isFallback = true;
    }

    this.context = { inputs, diagnosis: data.disease, urgency: data.urgency, climate: data.climate };
    this.chatHistory = [];
    this.showResult(result, data, inputs, isFallback);

    // Blockchain logging is isolated so a failure here can never replace the AI result
    try {
      const user = JSON.parse(localStorage.getItem('nexora_user') || '{}');
      await NexoraChain.addBlock({
        type: 'AI_CONSULTATION',
        farmerId: user.mobile || 'demo',
        crop: inputs.crop,
        diagnosis: data.disease,
        urgency: data.urgency,
      });
    } catch (err) {
      console.warn('Blockchain log skipped:', err);
    }
  },

  showLoading(container, crop) {
    container.innerHTML = `
      <div style="padding:2rem;text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:1rem;animation:spin 1s linear infinite;display:inline-block;">🤖</div>
        <p style="color:#8fbf3f;font-weight:600;margin-bottom:0.5rem;">NexoraAI is analyzing your ${nxEsc(crop)} farm...</p>
        <p style="color:#a89e85;font-size:0.85rem;">Checking disease patterns · Climate fit · Soil analysis · Yield optimization</p>
        <div style="display:flex;justify-content:center;gap:6px;margin-top:1rem;">
          <div style="width:8px;height:8px;background:#8fbf3f;border-radius:50%;animation:blink 1.2s 0s infinite"></div>
          <div style="width:8px;height:8px;background:#8fbf3f;border-radius:50%;animation:blink 1.2s 0.2s infinite"></div>
          <div style="width:8px;height:8px;background:#8fbf3f;border-radius:50%;animation:blink 1.2s 0.4s infinite"></div>
        </div>
      </div>`;
  },

  showResult(container, data, inputs, isFallback = false) {
    const urgencyColor = { immediate: '#e05252', monitor: '#d4a832', routine: '#8fbf3f' };
    const uc = urgencyColor[data.urgency] || '#8fbf3f';
    const climate = data.climate || {};
    const verdictColor = { Suitable: '#8fbf3f', Marginal: '#d4a832', Unsuitable: '#e05252' };
    const vc = verdictColor[climate.verdict] || '#a89e85';

    const banner = isFallback
      ? `<div style="background:rgba(212,168,50,0.1);border:1px solid rgba(212,168,50,0.3);border-radius:8px;padding:0.6rem 1rem;font-size:0.78rem;color:#d4a832;margin-bottom:1rem;">⚡ Offline mode — AI server not reachable${this.lastError ? ' (' + nxEsc(this.lastError) + ')' : ''}. Start the backend for live analysis.</div>`
      : `<div style="background:rgba(90,138,53,0.1);border:1px solid rgba(90,138,53,0.3);border-radius:8px;padding:0.6rem 1rem;font-size:0.78rem;color:#8fbf3f;margin-bottom:1rem;">✅ Live AI analysis for ${nxEsc(inputs.crop)}</div>`;

    container.innerHTML = `
      <div style="animation:fadeUp 0.5s ease both;">
        ${banner}

        <!-- DIAGNOSIS -->
        <div style="background:rgba(15,21,8,0.7);border:1px solid rgba(224,82,82,0.3);border-radius:12px;padding:1.2rem;margin-bottom:1rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
            <span style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:#a89e85;">🔬 Diagnosis</span>
            <span style="font-size:0.72rem;padding:0.2rem 0.6rem;border-radius:4px;background:${uc}22;color:${uc};font-weight:700;text-transform:uppercase;">${nxEsc(data.urgency)} action</span>
          </div>
          <div style="font-size:1.05rem;font-weight:700;color:#f0ead8;margin-bottom:0.3rem;">${nxEsc(data.disease)}</div>
          <div style="font-size:0.82rem;color:#a89e85;">${nxEsc(data.confidence)}</div>
        </div>

        <!-- CLIMATE FIT -->
        <div style="background:rgba(15,21,8,0.7);border:1px solid ${vc}55;border-radius:12px;padding:1.2rem;margin-bottom:1rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
            <span style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:#a89e85;">🌦️ Climate Fit for ${nxEsc(inputs.crop)}</span>
            <span style="font-size:0.72rem;padding:0.2rem 0.6rem;border-radius:4px;background:${vc}22;color:${vc};font-weight:700;text-transform:uppercase;">${nxEsc(climate.verdict || 'N/A')}</span>
          </div>
          <div style="font-size:0.82rem;color:#f0ead8;margin-bottom:0.3rem;">🌧️ Ideal rainfall: <b>${nxEsc(climate.idealRainfall || 'N/A')}</b> &nbsp;·&nbsp; 🌡️ Ideal temperature: <b>${nxEsc(climate.idealTemperature || 'N/A')}</b></div>
          <div style="font-size:0.82rem;color:#a89e85;">${nxEsc(climate.note || '')}</div>
        </div>

        <!-- PREVENTION -->
        <div style="background:rgba(15,21,8,0.7);border:1px solid rgba(90,138,53,0.25);border-radius:12px;padding:1.2rem;margin-bottom:1rem;">
          <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:#8fbf3f;margin-bottom:0.8rem;">🛡️ Prevention Steps</div>
          ${(data.prevention || []).map((step, i) => `
            <div style="display:flex;gap:0.7rem;margin-bottom:0.5rem;font-size:0.85rem;">
              <span style="color:#8fbf3f;font-weight:700;flex-shrink:0;">${i + 1}.</span>
              <span style="color:#f0ead8;">${nxEsc(step)}</span>
            </div>`).join('')}
        </div>

        <!-- PESTICIDE -->
        <div style="background:rgba(15,21,8,0.7);border:1px solid rgba(212,168,50,0.25);border-radius:12px;padding:1.2rem;margin-bottom:1rem;">
          <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:#d4a832;margin-bottom:0.8rem;">🧪 Pesticide Recommendation</div>
          <div style="font-size:0.95rem;font-weight:700;color:#d4a832;margin-bottom:0.3rem;">${nxEsc(data.pesticide?.name || 'N/A')}</div>
          <div style="font-size:0.82rem;color:#f0ead8;margin-bottom:0.3rem;">📋 ${nxEsc(data.pesticide?.dosage)}</div>
          <div style="font-size:0.78rem;color:#e05252;">⚠️ ${nxEsc(data.pesticide?.caution)}</div>
        </div>

        <!-- SOIL + FERTILIZER -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
          <div style="background:rgba(15,21,8,0.7);border:1px solid rgba(90,138,53,0.2);border-radius:12px;padding:1rem;">
            <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:#8fbf3f;margin-bottom:0.6rem;">🌱 Soil Advice</div>
            <div style="font-size:0.82rem;color:#f0ead8;">${nxEsc(data.soilAdvice)}</div>
          </div>
          <div style="background:rgba(15,21,8,0.7);border:1px solid rgba(212,168,50,0.2);border-radius:12px;padding:1rem;">
            <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:#d4a832;margin-bottom:0.6rem;">💊 Fertilizer Plan</div>
            <div style="font-size:0.82rem;color:#f0ead8;">${nxEsc(data.fertilizerPlan)}</div>
          </div>
        </div>

        <!-- YIELD + GOVT SCHEME -->
        <div style="background:rgba(15,21,8,0.7);border:1px solid rgba(74,122,224,0.2);border-radius:12px;padding:1.2rem;margin-bottom:1rem;">
          <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:#6a9af0;margin-bottom:0.6rem;">📈 Yield Optimization</div>
          <div style="font-size:0.82rem;color:#f0ead8;white-space:pre-line;">${nxEsc(nxText(data.yieldOptimization))}</div>
          <div style="margin-top:0.8rem;padding-top:0.8rem;border-top:1px solid rgba(255,255,255,0.05);">
            <span style="font-size:0.72rem;color:#6a9af0;">🏛️ Govt Scheme: </span>
            <span style="font-size:0.8rem;color:#f0ead8;">${nxEsc(data.govtScheme)}</span>
          </div>
        </div>

        <!-- HINDI SUMMARY -->
        <div style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);border-radius:12px;padding:1.1rem;margin-bottom:1rem;">
          <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:#a78bfa;margin-bottom:0.5rem;">🇮🇳 किसान सारांश (Hindi)</div>
          <div style="font-size:0.9rem;color:#f0ead8;line-height:1.6;">${nxEsc(data.hindiSummary)}</div>
        </div>

        <!-- FOLLOW-UP CHATBOT -->
        <div style="background:rgba(15,21,8,0.7);border:1px solid rgba(90,138,53,0.3);border-radius:12px;padding:1.1rem;">
          <div style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:#8fbf3f;margin-bottom:0.6rem;">💬 Ask NexoraAI a follow-up</div>
          <div id="nx-chat-log" style="max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:0.5rem;margin-bottom:0.7rem;"></div>
          <div style="display:flex;gap:0.5rem;">
            <input id="nx-chat-input" type="text" placeholder="e.g. When should I spray? Is this the right time to sow?"
              onkeydown="if(event.key==='Enter')AIAdvisorUI.sendChat()"
              style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0.6rem 0.8rem;color:#f0ead8;font-size:0.85rem;">
            <button onclick="AIAdvisorUI.sendChat()" style="background:rgba(90,138,53,0.3);border:1px solid rgba(90,138,53,0.4);color:#8fbf3f;padding:0.6rem 1rem;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">Send</button>
          </div>
        </div>

        <div style="display:flex;gap:0.8rem;margin-top:1rem;">
          <button onclick="AIAdvisorUI.printReport()" style="flex:1;background:rgba(90,138,53,0.2);border:1px solid rgba(90,138,53,0.3);color:#8fbf3f;padding:0.6rem;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">📄 Save Report</button>
          <button onclick="document.getElementById(AIAdvisorUI.resultId).innerHTML=''" style="flex:1;background:transparent;border:1px solid rgba(255,255,255,0.1);color:#a89e85;padding:0.6rem;border-radius:8px;cursor:pointer;font-size:0.85rem;">🔄 New Analysis</button>
        </div>
      </div>`;
  },

  appendChat(role, text) {
    const log = document.getElementById('nx-chat-log');
    if (!log) return null;
    const el = document.createElement('div');
    const mine = role === 'user';
    el.style.cssText = `align-self:${mine ? 'flex-end' : 'flex-start'};max-width:85%;padding:0.5rem 0.8rem;border-radius:10px;font-size:0.84rem;line-height:1.5;white-space:pre-wrap;color:#f0ead8;background:${mine ? 'rgba(90,138,53,0.25)' : 'rgba(255,255,255,0.06)'};`;
    el.textContent = text; // textContent keeps model output from injecting HTML
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  },

  async sendChat() {
    const input = document.getElementById('nx-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    this.appendChat('user', text);
    this.chatHistory.push({ role: 'user', content: text });
    const bubble = this.appendChat('assistant', 'Typing…');

    const log = document.getElementById('nx-chat-log');
    try {
      const reply = await NexoraAI.chatStream(this.chatHistory, this.context, (soFar) => {
        bubble.textContent = soFar;           // words appear as they are generated
        if (log) log.scrollTop = log.scrollHeight;
      });
      if (!reply) throw new Error('Empty reply from the AI');
      this.chatHistory.push({ role: 'assistant', content: reply });
    } catch (err) {
      bubble.textContent = '⚠️ AI server not reachable: ' + err.message;
      this.chatHistory.pop();
    }
    if (log) log.scrollTop = log.scrollHeight;
  },

  showError(container, msg) {
    container.innerHTML = `<div style="padding:1.5rem;background:rgba(224,82,82,0.1);border:1px solid rgba(224,82,82,0.3);border-radius:12px;color:#e05252;font-size:0.88rem;">❌ ${nxEsc(msg)}</div>`;
  },

  printReport() {
    window.print();
  }
};