const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ items: [] });
  }

  const { country, theme, priority, limit = '30' } = req.query;

  let url = `${SUPABASE_URL}/rest/v1/items?select=id,title_en,title_ar,summary_en,source_name,source_url,country,theme,signal,priority,priority_score,published_at`;
  url += `&order=priority_score.desc,published_at.desc`;
  url += `&limit=${parseInt(limit)}`;
  if (country && country !== 'all') url += `&country=eq.${encodeURIComponent(country)}`;
  if (theme && theme !== 'all') url += `&theme=eq.${encodeURIComponent(theme)}`;
  if (priority && priority !== 'all') url += `&priority=eq.${encodeURIComponent(priority)}`;

  const response = await fetch(url, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });

  if (!response.ok) {
    return res.status(500).json({ items: [] });
  }

  const data = await response.json();

  const items = (data || []).map(row => ({
    id:         row.id,
    date:       row.published_at ? row.published_at.split('T')[0] : new Date().toISOString().split('T')[0],
    country:    row.country,
    theme:      row.theme,
    priority:   row.priority,
    signal:     row.signal || 'News development',
    title_en:   row.title_en || '',
    title_es:   row.title_en || '',
    summary_en: row.summary_en || '',
    summary_es: row.summary_en || '',
    source:     row.source_name || 'GDELT',
    source_url: row.source_url || null,
    live:       true,
  }));

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
  return res.status(200).json({ items });
}
