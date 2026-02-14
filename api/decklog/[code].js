export default async function handler(req, res) {
  const code = String(req.query?.code || '').trim();
  if (!code) {
    res.status(400).json({ error: 'missing_code' });
    return;
  }

  try {
    const payload = await fetchDecklogPayload(code);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(payload);
  } catch (e) {
    res.status(502).json({ error: 'decklog_fetch_failed' });
  }
}

async function fetchDecklogPayload(code) {
  const candidates = [
    `https://decklog.bushiroad.com/view/${encodeURIComponent(code)}.json`,
    `https://decklog.bushiroad.com/deckimages/${encodeURIComponent(code)}.json`,
    `https://decklog.bushiroad.com/view/${encodeURIComponent(code)}`,
  ];

  for (const url of candidates) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'G-card-test proxy',
        Accept: 'application/json, text/html;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) continue;

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('application/json')) {
      return await res.json();
    }

    const text = await res.text();
    const fromNext = extractNextDataJson(text);
    if (fromNext) return fromNext;
  }

  throw new Error('not_found');
}

function extractNextDataJson(html) {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    const root = JSON.parse(m[1]);
    return root?.props?.pageProps?.deck || root?.props?.pageProps || root;
  } catch {
    return null;
  }
}
