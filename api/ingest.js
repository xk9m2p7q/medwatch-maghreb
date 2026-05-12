import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const COUNTRIES = [
  { name: 'Morocco',     gdelt: 'Morocco',     code: 'MA' },
  { name: 'Algeria',     gdelt: 'Algeria',     code: 'AL' },
  { name: 'Tunisia',     gdelt: 'Tunisia',     code: 'TS' },
  { name: 'Mauritania',  gdelt: 'Mauritania',  code: 'MR' },
  { name: 'Sahel',       gdelt: 'Sahel',       code: 'SL' },
  { name: 'Spain',       gdelt: 'Spain',       code: 'SP' },
];

const THEME_KEYWORDS = {
  Security:   ['military','attack','terrorism','conflict','weapon','troops','ceasefire','polisario','jnim','armed'],
  Energy:     ['gas','oil','pipeline','energy','electricity','renewables','tsgp','solar'],
  Migration:  ['migration','migrant','refugee','border crossing','boat','smuggling','frontex'],
  Diplomacy:  ['diplomat','summit','agreement','treaty','bilateral','foreign minister','ambassador'],
  Sovereignty:['western sahara','sahara','sovereignty','territory','autonomy','recognition','consulate'],
  Politics:   ['election','president','government','protest','opposition','parliament','minister'],
};

const SIGNAL_MAP = {
  Security:   'Security development',
  Energy:     'Strategic positioning',
  Migration:  'Policy shift',
  Diplomacy:  'Diplomatic move',
  Sovereignty:'Diplomatic recognition',
  Politics:   'Elite statement',
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
  const text = (article.title + ' ' + (article.seenby || '')).toLowerCase();
  if (theme === 'Security') score += 3;
  if (theme === 'Sovereignty') score += 2;
  if (text.includes('attack') || text.includes('military') || text.includes('crisis')) score += 2;
  if (text.includes('spain') || text.includes('eu ') || text.includes('europe')) score += 1;
  score += Math.min(3, Math.floor((article.numarts || 1) / 3));
  return score;
}

async function fetchGDELT(country) {
  const query = encodeURIComponent(`"${country.gdelt}" sourcelang:english OR sourcelang:french OR sourcelang:arabic`);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=10&sort=DateDesc&format=json&timespan=24h`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = await res.json();
  return data.articles || [];
}

async function translateTitle(title, apiKey) {
  if (!apiKey) return title;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 120,
        messages: [
          { role: 'system', content: 'Translate the following headline to English. Return only the translation, nothing else.' },
          { role: 'user', content: title }
        ]
      })
    });
    const d = await res.json();
    return d.choices?.[0]?.message?.content?.trim() || title;
  } catch { return title; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.headers['x-vercel-cron'] !== '1') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  );

  const groqKey = process.env.GROQ_API_KEY;
  const results = { inserted: 0, skipped: 0, errors: [] };

  for (const country of COUNTRIES) {
    try {
      const articles = await fetchGDELT(country);
      for (const article of articles.slice(0, 5)) {
        const rawTitle = article.title || '';
        if (!rawTitle) continue;

        const hash = crypto.createHash('md5').update(rawTitle).digest('hex');

        // Skip if already ingested
        const { data: existing } = await supabase
          .from('alert_queue')
          .select('id')
          .eq('title_hash', hash)
          .maybeSingle();
        if (existing) { results.skipped++; continue; }

        const theme = detectTheme(rawTitle + ' ' + (article.url || ''));
        const priorityScore = scorePriority(article, theme);
        const priority = priorityScore >= 5 ? 'high' : priorityScore >= 3 ? 'medium' : 'low';

        // Translate if non-English
        const isEnglish = !article.url?.includes('arabic') && !article.url?.includes('.ar/') && !article.url?.includes('.fr/');
        const titleEn = isEnglish ? rawTitle : await translateTitle(rawTitle, groqKey);

        const row = {
          source_url:    article.url || '',
          title_hash:    hash,
          title_en:      titleEn,
          title_ar:      isEnglish ? null : rawTitle,
          summary_en:    article.seenby ? `Coverage spike detected across ${article.numarts} sources.` : null,
          source_name:   article.domain || 'GDELT',
          country:       country.name,
          theme,
          signal:        SIGNAL_MAP[theme] || 'News development',
          priority,
          priority_score: priorityScore,
          published_at:  article.seendate ? new Date(article.seendate.replace(
            /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
            '$1-$2-$3T$4:$5:$6'
          )).toISOString() : new Date().toISOString(),
          ingested_at:   new Date().toISOString(),
          alerted:       false,
        };

        const { error } = await supabase.from('alert_queue').insert(row);
        if (error) results.errors.push(error.message);
        else results.inserted++;
      }
    } catch (err) {
      results.errors.push(`${country.name}: ${err.message}`);
    }
  }

  return res.status(200).json(results);
}
