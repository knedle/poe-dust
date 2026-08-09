const https = require('node:https');

const CATEGORIES = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory'];

function fetchJson(targetUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    https.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (poe-dust)', 'Accept': 'application/json' }
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://poe.ninja${res.headers.location}`;
        return resolve(fetchJson(next, redirects + 1));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

function fetchLeagues() {
  return fetchJson('https://www.pathofexile.com/api/trade/data/leagues');
}

async function fetchCategoryLines(league, category) {
  const data = await fetchJson(
    `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${category}`
  );
  return (data.lines || []).map(line => ({ ...line, _category: category }));
}

function cheapestByName(rawLines) {
  const best = new Map();
  for (const line of rawLines) {
    if (!line.name || typeof line.chaosValue !== 'number') continue;
    const existing = best.get(line.name);
    if (!existing || line.chaosValue < existing.chaosValue) {
      best.set(line.name, { name: line.name, chaosValue: line.chaosValue, _category: line._category });
    }
  }
  return [...best.values()];
}

async function fetchAllPrices(league) {
  const items = [];
  const errors = [];
  await Promise.all(CATEGORIES.map(async category => {
    try {
      const lines = await fetchCategoryLines(league, category);
      items.push(...lines);
    } catch (e) {
      errors.push(`${category}: ${e.message}`);
    }
  }));
  return { items: cheapestByName(items), errors };
}

module.exports = { CATEGORIES, fetchJson, fetchLeagues, fetchCategoryLines, cheapestByName, fetchAllPrices };
