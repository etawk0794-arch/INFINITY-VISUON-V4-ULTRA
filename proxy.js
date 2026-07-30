// ════════════════════════════════════════════════════════════════════════
//  InfinityVision — Netlify Function Proxy
//  الغرض: تمرير نداءات الـ AI APIs من السيرفر بدل المتصفح
//  لتفادي مشاكل CORS نهائياً (Anthropic / OpenAI / Google / Groq / إلخ
//  لا تسمح بنداءات مباشرة من متصفح على نطاق مختلف).
//
//  هذا الملف يعمل تلقائياً على Netlify بدون أي إعداد إضافي طالما هو
//  موجود ضمن مجلد netlify/functions في جذر المشروع المنشور.
// ════════════════════════════════════════════════════════════════════════

// Providers we know how to forward to, and how to build their request.
// This mirrors getProvCfg() in the app, but runs server-side so the
// destination API sees a normal server-to-server call (no CORS involved).
const PROVIDERS = {
  openai: (body, key) => ({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  }),
  anthropic: (body, key) => ({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
  }),
  google: (body, key, modelName) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`,
    headers: { 'Content-Type': 'application/json' },
  }),
  groq: (body, key) => ({
    url: 'https://api.groq.com/openai/v1/chat/completions',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  }),
  deepseek: (body, key) => ({
    url: 'https://api.deepseek.com/chat/completions',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  }),
  mistral: (body, key) => ({
    url: 'https://api.mistral.ai/v1/chat/completions',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  }),
  cohere: (body, key) => ({
    url: 'https://api.cohere.com/v2/chat',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  }),
  openrouter: (body, key) => ({
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://infinityvision.app',
      'X-Title': 'InfinityVision',
      'Content-Type': 'application/json',
    },
  }),
  custom: (body, key, modelName, baseUrl) => ({
    url: `${(baseUrl || '').replace(/\/$/, '')}/chat/completions`,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  }),
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON body.' }),
    };
  }

  const { provider, key, modelName, baseUrl, body } = payload;

  if (!provider || !PROVIDERS[provider]) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Unknown or missing provider: "${provider}"` }),
    };
  }
  if (!key) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Missing API key.' }),
    };
  }

  const { url, headers } = PROVIDERS[provider](body, key, modelName, baseUrl);

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const text = await upstream.text();

    // Forward the upstream status + body as-is so the client-side error
    // handling (quota, invalid key, rate limit, etc.) keeps working exactly
    // like it did with a direct call.
    return {
      statusCode: upstream.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: `Proxy fetch failed: ${err.message}` }),
    };
  }
};
