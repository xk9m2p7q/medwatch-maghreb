import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { country, theme, priority, limit = 30 } = req.query;

  let query = supabase
    .from('alert_queue')
    .select('id, title_en, title_ar, summary_en, source_name, source_url, country, theme, signal, priority, priority_score, published_at')
    .order('priority_score', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(parseInt(limit));

  if (country && country !== 'all') query = query.eq('country', country);
  if (theme && theme !== 'all') query = query.eq('theme', theme);
  if (priority && priority !== 'all') query = query.eq('priority', priority);

  const { data, error } = await query;

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Normalize to match frontend item shape
  const items = (data || []).map(row => ({
    id:         row.id,
    date:       row.published_at ? row.published_at.split('T')[0] : new Date().toISOString().split('T')[0],
    country:    row.country,
    theme:      row.theme,
    priority:   row.priority,
    signal:     row.signal || 'News development',
    title_en:   row.title_en || '',
    title_es:   row.title_en || '', // fallback — no ES translation yet
    summary_en: row.summary_en || '',
    summary_es: row.summary_en || '', // fallback
    source:     row.source_name || 'GDELT',
    source_url: row.source_url || null,
    live:       true,
  }));

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  return res.status(200).json({ items });
}
