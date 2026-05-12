import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const COUNTRIES = [
  { name: 'Morocco',    gdelt: 'Morocco' },
  { name: 'Algeria',    gdelt: 'Algeria' },
  { name: 'Tunisia',    gdelt: 'Tunisia' },
  { name: 'Mauritania', gdelt: 'Mauritania' },
  { name: 'Sahel',      gdelt: 'Sahel' },
  { name: 'Spain',      gdelt: 'Spain' },
];

const THEME_KEYWORDS = {
  Security:    ['military','attack','terrorism','conflict','weapon','troops','ceasefire','polisario','jnim','armed'],
  Energy:      ['gas','oil','pipeline','energy','electricity','renewables','tsgp','solar'],
  Migration:   ['migration','migrant','refugee','border','boat','smuggling','frontex'],
  Diplomacy:   ['diplomat','summit','agreement','treaty','bilateral','foreign minister','ambassador'],
  Sovereignty: ['western sahara','sahara','sovereignty','territory','autonomy','recognition','consulate'],
  Politics:    ['election','president','government','protest','opposition','parliament','minister'],
};

const SIGNAL_MAP = {
  Security:    'Security development',
  Energy:      'Strategic positioning',
  Migration:   'Policy shift',
  Diplomacy:   'Diplomatic move',
  Sovereignty: 'Diplomatic recognition',
  Politics:    'Elite statement',
};

function detectTheme(text) {
  const lower = text.toLowerCase();
  let best = 'Politics', bestScore = 0;
  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    const score = keywords.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = theme; }
  }
  return best;
}

function scorePriority(article, theme) {
  let score = 0;
  const text = ((article.title || '') + ' ' + (article.url || '')).toLowerCase();
  if (theme === 'Security') score += 3;
  if (theme === 'Sovereignty') score += 2;
  if (text.includes('attack') || text.includes('military') || text.includes('crisis')) score += 2;
  if (text.includes('spain') || text.includes(' eu ') || text.includes('europe')) score += 1;
  score += Math.min(3, Math.floor((article.numarts || 1) / 3));
  return score;
}

async function supabaseSelect(table, filters = {}) {
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=id`;
  for (const [k, v] of Object.entries(filters)) url += `&${k}=eq.${encodeURIComponent(v)}`;
  url += '&limit=1';
  const res = await fetch(url, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
}

async function supabaseInsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
}

async function fetchGDELT(country) {
  const query = encodeURIComponent(`"${country.gdelt}"`);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=10&sort=DateDesc&format=json&timespan=24h`;
  const res = await fetch(url, {});
  if (!res.ok) return [];
  const data = await res.json();
  return data.articles || [];
}

function isEnglishOrSpanish(text) {
  // Detect non-Latin scripts: Arabic, Chinese, Hebrew, Thai, etc.
  const nonLatin = /[\u0600-\u06FF\u4E00-\u9FFF\u0400-\u04FF\u3040-\u30FF\u0E00-\u0E7F\u05D0-\u05FF]/;
  return !nonLatin.test(text);
}

async function translateToEnglish(title) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return title;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 150,
        messages: [
          { role: 'system', content: 'Translate the following news headline to English. Return only the English translation, nothing else. If it is already in English or Spanish, return it unchanged.' },
          { role: 'user', content: title }
        ]
      })
    });
    const d = await res.json();
    return d.choices?.[0]?.message?.content?.trim() || title;
  } catch {
    return title;
  }
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST' && !req.headers['x-vercel-cron']) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  const results = { inserted: 0, skipped: 0, errors: [] };

  // Fetch all countries in parallel to beat the timeout
  const allResults = await Promise.allSettled(
    COUNTRIES.map(country => fetchGDELT(country).then(articles => ({ country, articles })))
  );

  for (const result of allResults) {
    if (result.status === 'rejected') {
      results.errors.push(`Fetch failed: ${result.reason?.message}`);
      continue;
    }
    const { country, articles } = result.value;
    try {
      for (const article of articles.slice(0, 5)) {
        const rawTitle = article.title || '';
        if (!rawTitle) continue;

        // Translate if not English or Spanish
        const titleEn = isEnglishOrSpanish(rawTitle) ? rawTitle : await translateToEnglish(rawTitle);

        const hash = crypto.createHash('md5').update(rawTitle).digest('hex');

        const existing = await supabaseSelect('items', { title_hash: hash });
        if (existing && existing.length > 0) { results.skipped++; continue; }

        const theme = detectTheme(rawTitle + ' ' + (article.url || ''));
        const priorityScore = scorePriority(article, theme);
        const priority = priorityScore >= 5 ? 'high' : priorityScore >= 3 ? 'medium' : 'low';

        const publishedRaw = article.seendate || '';
        let publishedAt;
        try {
          publishedAt = publishedRaw
            ? new Date(publishedRaw.replace(
                /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
                '$1-$2-$3T$4:$5:$6Z'
              )).toISOString()
            : new Date().toISOString();
          if (publishedAt === 'Invalid Date') throw new Error();
        } catch {
          publishedAt = new Date().toISOString();
        }

        const row = {
          source_url:     article.url || '',
          title_hash:     hash,
          title_en:       titleEn,
          title_ar:       isEnglishOrSpanish(rawTitle) ? null : rawTitle,
          summary_en:     `Detected across ${article.numarts || 1} source(s) via GDELT.`,
          source_name:    article.domain || 'GDELT',
          country:        country.name,
          theme,
          signal:         SIGNAL_MAP[theme] || 'News development',
          priority,
          priority_score: priorityScore,
          published_at:   publishedAt,
          ingested_at:    new Date().toISOString(),
          alerted:        false,
        };

        await supabaseInsert('items', row);
        results.inserted++;
      }
    } catch (err) {
      results.errors.push(`${country.name}: ${err.message}`);
    }
  }

  return res.status(200).json(results);
}
