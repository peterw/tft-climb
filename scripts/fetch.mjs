// Pulls live TFT data from public sources and writes data/live.json.
// Sources: Community Dragon (game data), MetaTFT public API (ranked stats), Riot TFT patch notes.
import { writeFile, mkdir } from "node:fs/promises";

const UA = { "User-Agent": "tft-climb static site (github.com/peterw/tft-climb) - rebuilds a few times a day" };
const MT = "https://api-hc.metatft.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { json = true, tries = 3 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return json ? await r.json() : await r.text();
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}

const meta = await get(`${MT}/tft-comps-api/comps_data?queue=1100`);
const setKey = meta.tft_set; // e.g. TFTSet18
const clusters = meta.results.data.cluster_details;
const clusterId = meta.results.data.cluster_id;

const cd = await get("https://raw.communitydragon.org/latest/cdragon/tft/en_us.json");
const cdVersion = (await get("https://raw.communitydragon.org/latest/content-metadata.json").catch(() => ({}))).version || "";
const set = cd.setData.find((s) => s.mutator === setKey) || cd.setData.filter((s) => !/PAIRS|TURBO/.test(s.mutator)).sort((a, b) => b.number - a.number)[0];
const itemsById = Object.fromEntries(cd.items.map((i) => [i.apiName, i]));

const total = Object.values(clusters).reduce((s, c) => s + c.overall.count, 0);
const ranked = Object.values(clusters)
  .filter((c) => c.overall.count / total >= 0.006)
  .sort((a, b) => a.overall.avg - b.overall.avg)
  .slice(0, 12);

const details = {};
for (const c of ranked) {
  try {
    details[c.Cluster] = (await get(`${MT}/tft-comps-api/comp_details?comp=${c.Cluster}&cluster_id=${clusterId}`)).results;
  } catch (e) { console.warn("comp_details failed", c.Cluster, e.message); }
  await sleep(400);
}
const compAugs = await get(`${MT}/tft-comps-api/comp_augment_tiers?cluster_id=${clusterId}`).catch(() => ({ results: {} }));
const augTiers = await get(`${MT}/tft-stat-api/augments_tiers`).catch(() => null);
const itemStats = await get(`${MT}/tft-stat-api/items?queue=1100`).catch(() => null);

// Riot patch notes: newest TFT patch article.
const BASE = "https://teamfighttactics.leagueoflegends.com";
const listHtml = await get(`${BASE}/en-us/news/game-updates/`, { json: false });
const slugs = [...new Set([...listHtml.matchAll(/\/en-us\/news\/game-updates\/(teamfight-tactics-patch-(\d+)-(\d+)[a-z-]*)/g)].map((m) => m[1]))];
const byNum = slugs.map((s) => { const m = s.match(/patch-(\d+)-(\d+)/); return { s, n: +m[1] * 1000 + +m[2] }; }).sort((a, b) => b.n - a.n);
let patch = null;
if (byNum.length) {
  const url = `${BASE}/en-us/news/game-updates/${byNum[0].s}/`;
  const html = await get(url, { json: false });
  const nd = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
  const page = nd.props.pageProps.page;
  const body = page.blades.find((b) => b.type === "patchNotesRichText")?.richText?.body || "";
  patch = { url, title: page.title, published: page.displayedPublishDate, body };
}

const out = {
  fetchedAt: new Date().toISOString(),
  sources: {
    metatft: { updated: meta.updated, set: setKey, queue: 1100, clusterId, totalGames: total },
    cdragon: cdVersion,
  },
  set: { number: set.number, mutator: set.mutator, name: set.name, champions: set.champions, traits: set.traits },
  items: Object.fromEntries(Object.entries(itemsById).filter(([k]) => k.startsWith("DA_") || k.startsWith("TFT_Item") || /Emblem|Radiant/.test(k)).map(([k, v]) => [k, { name: v.name, icon: v.icon, desc: v.desc, comp: v.composition || [], isAugment: !!v.isAugment }])),
  comps: ranked.map((c) => ({ ...c, centroid: undefined, details: details[c.Cluster] || null, augments: compAugs.results?.[c.Cluster]?.augments || [] })),
  allComps: Object.values(clusters).map((c) => ({ id: c.Cluster, name: c.name_string, units: c.units_string, count: c.overall.count, avg: c.overall.avg, levelling: c.levelling })),
  augTiers: augTiers?.content?.content?.tierList || [],
  itemStats: itemStats?.results || [],
  patch,
};
await mkdir("data", { recursive: true });
await writeFile("data/live.json", JSON.stringify(out));
console.log(`ok: ${setKey}, ${ranked.length} comps, patch ${patch?.title}, ${total} games`);
