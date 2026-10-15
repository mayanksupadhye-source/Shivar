/**
 * AI ADVISOR ROUTES  (mounted at /api/advisor in server.js)
 *   POST /api/advisor/analyze  -> structured crop analysis (JSON)
 *   POST /api/advisor/chat     -> streaming follow-up chatbot (Server-Sent Events)
 *   GET  /api/advisor/health   -> confirms the OpenAI key is loaded
 *
 * Needs OPENAI_API_KEY in the backend .env. Uses Node's built-in http/https,
 * so no new npm packages are required.
 */
const express = require('express');
const http = require('http');
const https = require('https');

const router = express.Router();

const s = (v, max = 200) => String(v ?? '').trim().slice(0, max);

// ── Low-level OpenAI request. Resolves with the raw response stream. ──
function openaiRequest(payload) {
  return new Promise((resolve, reject) => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return reject(new Error('OPENAI_API_KEY is not set in the backend .env file'));

    const base = new URL(process.env.OPENAI_BASE_URL || 'https://api.openai.com');
    const lib = base.protocol === 'http:' ? http : https;
    const body = JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', ...payload });

    const req = lib.request(
      {
        hostname: base.hostname,
        port: base.port || undefined,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${key}`,
        },
      },
      resolve
    );
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('OpenAI request timed out')));
    req.write(body);
    req.end();
  });
}

async function readBody(res) {
  res.setEncoding('utf8');
  let raw = '';
  for await (const chunk of res) raw += chunk;
  return raw;
}

// Non-streaming call, returns the assistant message text
async function complete(payload) {
  const res = await openaiRequest(payload);
  const raw = await readBody(res);
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`OpenAI returned an unreadable response (HTTP ${res.statusCode})`);
  }
  if (res.statusCode >= 400) throw new Error(data.error?.message || `OpenAI error ${res.statusCode}`);
  return data.choices[0].message.content;
}

// ── Prompt for the structured analysis ──
function advisorPrompt(i) {
  return `You are NexoraAI, an expert Indian agricultural advisor.

Farmer's input:
- Crop: ${i.crop}
- Soil type: ${i.soilType}
- Rainfall (mm): ${i.rainfall}
- Temperature (°C): ${i.temperature}
- Fertilizer used: ${i.fertilizer}
- Leaf symptoms: ${i.leafSymptoms || 'none reported'}
- Pest symptoms: ${i.pestSymptoms || 'none reported'}
- Region/District: ${i.region}
- Season: ${i.season}

RULES:
- Every field must be specific to ${i.crop} grown in ${i.region} during ${i.season}. Never say "most crops".
- Compare the given rainfall and temperature with the ideal ranges for ${i.crop} and give an honest verdict.
- If no symptoms are reported, name the most likely risks for ${i.crop} in this season and region.

Respond ONLY with valid JSON using exactly these keys:
{
  "disease": "most likely disease/problem",
  "confidence": "High/Medium/Low with a short reason",
  "prevention": ["step 1", "step 2", "step 3", "step 4"],
  "pesticide": { "name": "", "dosage": "", "caution": "" },
  "climate": {
    "verdict": "Suitable | Marginal | Unsuitable",
    "idealRainfall": "e.g. 1000-2000 mm",
    "idealTemperature": "e.g. 20-35 °C",
    "note": "one or two sentences comparing the farmer's values with the ideal"
  },
  "soilAdvice": "",
  "fertilizerPlan": "NPK plan for this crop, soil and season",
  "yieldOptimization": "3 tips, each on a new line",
  "govtScheme": "relevant Indian government scheme",
  "hindiSummary": "2-sentence summary in Hindi",
  "urgency": "immediate | monitor | routine"
}`;
}

router.get('/health', (req, res) => {
  res.json({ ok: true, model: process.env.OPENAI_MODEL || 'gpt-4o-mini', keyLoaded: !!process.env.OPENAI_API_KEY });
});

// ── POST /api/advisor/analyze ──
router.post('/analyze', async (req, res) => {
  const b = req.body || {};
  const inputs = {
    crop: s(b.crop),
    soilType: s(b.soilType),
    rainfall: s(b.rainfall),
    temperature: s(b.temperature),
    fertilizer: s(b.fertilizer),
    leafSymptoms: s(b.leafSymptoms),
    pestSymptoms: s(b.pestSymptoms),
    region: s(b.region),
    season: s(b.season) || 'Kharif',
  };
  if (!inputs.crop) return res.status(400).json({ error: 'crop is required' });

  try {
    const text = await complete({
      temperature: 0.3,
      max_tokens: 1400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are NexoraAI, an expert Indian agricultural advisor. Reply with valid JSON only.' },
        { role: 'user', content: advisorPrompt(inputs) },
      ],
    });
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'The AI returned malformed JSON. Please try again.' });
    }
    res.json(parsed);
  } catch (err) {
    console.error('Advisor analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/advisor/chat  (streams tokens as Server-Sent Events) ──
router.post('/chat', async (req, res) => {
  const { messages, context } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const history = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-10)
    .map((m) => ({ role: m.role, content: s(m.content, 1000) }));

  const ctx = context || {};
  const inputs = ctx.inputs || {};
  const system = `You are NexoraAI, a friendly Indian agricultural advisor chatting with a farmer.
Farm context: crop ${s(inputs.crop)}, soil ${s(inputs.soilType)}, region ${s(inputs.region)}, season ${s(inputs.season)}, rainfall ${s(inputs.rainfall)} mm, temperature ${s(inputs.temperature)} °C.
Latest diagnosis: ${s(ctx.diagnosis)} (urgency: ${s(ctx.urgency)}).
Reply in the same language the farmer writes in (English, Hindi or Marathi). Keep answers short, practical and specific to their crop. For pesticide advice, remind them to follow the label and consult their local KVK.`;

  let upstream;
  try {
    upstream = await openaiRequest({
      stream: true,
      temperature: 0.5,
      max_tokens: 500,
      messages: [{ role: 'system', content: system }, ...history],
    });
  } catch (err) {
    console.error('Advisor chat error:', err.message);
    return res.status(500).json({ error: err.message });
  }

  if (upstream.statusCode >= 400) {
    const raw = await readBody(upstream);
    let msg = `OpenAI error ${upstream.statusCode}`;
    try { msg = JSON.parse(raw).error?.message || msg; } catch {}
    console.error('Advisor chat error:', msg);
    return res.status(502).json({ error: msg });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  upstream.setEncoding('utf8');
  let buf = '';
  upstream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop(); // keep any incomplete line for the next chunk
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const token = JSON.parse(data).choices?.[0]?.delta?.content;
        if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
      } catch { /* ignore a malformed event */ }
    }
  });
  upstream.on('end', () => {
    res.write('data: [DONE]\n\n');
    res.end();
  });
  upstream.on('error', (err) => {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });
  res.on('close', () => upstream.destroy()); // stop paying for tokens if the user leaves
});

module.exports = router;