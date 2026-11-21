/*
 * POST /api/voice: turns a Logtra voice note into English text with Google Gemini.
 *
 * The phone records what the person says (Tamil, English or a mix), sends it here as base64
 * audio, and gets back English text for the pencil's box. The Gemini key stays on Vercel
 * (Project Settings > Environment Variables > GEMINI_API_KEY), never in the app. Only
 * signed-in Logtra users may call it: the Supabase session token is checked first, so nobody
 * else can use up the free Gemini quota.
 *
 * Body: { audio: <base64>, mime?: 'audio/wav' }   Reply: { text } or { error }
 */
const SUPABASE_URL = 'https://iglvfnjrpicmzycajany.supabase.co';
const SUPABASE_KEY = 'sb_publishable_9mGWJCKJQNxcC8RWdzCFRg_5xD8nYqy'; // the public key, same as the app's

const PROMPT = [
  'This is a short voice note for a personal journal, tasks and expenses app.',
  'The speaker may talk in Tamil, English, or a mix of both (Tanglish), with an Indian accent.',
  'Write what they said in clear, natural English: translate any Tamil, and keep English parts as spoken.',
  'Keep numbers, money amounts (rupees), names, places and times exactly.',
  'The app files notes with symbols: when the speaker says "slash", "hyphen" or "dash", or "percent" before a name (in any language), write the symbol /, - or % joined to the next word,',
  'e.g. "slash business slash sales hyphen call the bank" becomes "/business /sales -call the bank", and "800 for food percent trip" becomes "800 for food %trip".',
  'Reply with only the English text: no quotes, no labels, no notes. If nothing was said, reply with nothing.',
].join(' ');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'Voice translation is not set up yet.' });

  /* signed-in Logtra users only */
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in first.' });
  const who = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token } });
  if (!who.ok) return res.status(401).json({ error: 'Sign in first.' });

  const { audio, mime = 'audio/wav' } = req.body || {};
  if (typeof audio !== 'string' || audio.length < 200) return res.status(400).json({ error: 'No audio received.' });
  if (!/^audio\/[a-z0-9.+-]+$/i.test(mime)) return res.status(400).json({ error: 'Unsupported audio type.' });

  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: audio } }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) {
    const limited = r.status === 429;
    return res.status(limited ? 429 : 502).json({ error: limited ? 'Today’s free translation limit is used up.' : (out.error && out.error.message) || 'Gemini could not read the audio.' });
  }
  const text = ((out.candidates && out.candidates[0] && out.candidates[0].content && out.candidates[0].content.parts) || [])
    .map((p) => p.text || '').join('').trim();
  return res.status(200).json({ text });
};
