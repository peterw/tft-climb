// Renders data/live.json into a static site in ./site. No dependencies.
import { readFile, writeFile, mkdir, rm, cp } from "node:fs/promises";

const D = JSON.parse(await readFile("data/live.json", "utf8"));
const OUT = "site";
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// ---------- lookups ----------
const CD = "https://raw.communitydragon.org/latest/game/";
const img = (p) => (p ? CD + p.toLowerCase().replace(/\.(tex|dds)$/, ".png") : "");
const champs = Object.fromEntries(D.set.champions.map((c) => [c.apiName, c]));
const traits = Object.fromEntries(D.set.traits.map((t) => [t.apiName, t]));
const pretty = (id) => id.replace(/^(DA|TFT\d*)_/, "").replace(/^\d+_/, "").replace(/\d+(_AD|_AP|_Base)?$/, "").replace(/_(AD|AP|Base)$/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\bPlus\b/g, "+").trim();
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const uName = (id) => champs[id]?.name || pretty(id);
const tId = (s) => s.replace(/_\d+$/, "");
const tName = (id) => traits[tId(id)]?.name || pretty(tId(id));
const iName = (id) => D.items[id]?.name || pretty(id);
const aName = (id) => { const n = D.items[id]?.name; return n && !/^tft_|^DA_/i.test(n) ? n : pretty(id).replace(/ Augment/, ""); };
const nameOf = (x) => (x.type === "trait" ? tName(x.name) : uName(x.name));
const f2 = (n) => Number(n).toFixed(2);
const pct = (n) => (n * 100).toFixed(1) + "%";
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isUnit = (id) => !!champs[id] && champs[id].cost >= 1 && champs[id].cost <= 5 && !/Elderwood18_|Dummy|Tower/.test(id);
const isCarry = (id) => (champs[id]?.stats?.range ?? 1) >= 3;
const costColor = { 1: "#9aa4af", 2: "#3fb27f", 3: "#3a8fd9", 4: "#b44fe0", 5: "#f0b33c" };

const patchNum = (D.patch?.title.match(/(\d+\.\d+)/) || [])[1] || "";
const setTheme = ((D.patch?.body || "").replace(/<[^>]+>/g, " ").match(/last patch of ([A-Z][A-Za-z ]{2,30}?) before/) || [])[1];
const setName = `Set ${D.set.number}` + (setTheme ? ` (${setTheme})` : "");
const updated = D.fetchedAt;
const statsUpdated = new Date(D.sources.metatft.updated).toISOString();

// ---------- patch parsing ----------
function parsePatch(body) {
  if (!body) return { intro: "", sections: [] };
  const clean = (h) => h.replace(/<br\s*\/?>/g, " ").replace(/<\/(h\d|p|div|li)>/g, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’").replace(/\s+/g, " ").trim();
  const parts = body.split(/<h4[^>]*>/).slice(1);
  const sections = [];
  for (const p of parts) {
    const title = clean(p.split("</h4>")[0]);
    const rest = p.split("</h4>").slice(1).join("</h4>");
    const notes = [...rest.matchAll(/<blockquote[\s\S]*?<\/blockquote>/g)].map((m) => m[0].replace(/<br\s*\/?><br\s*\/?>/g, "\n")).join("\n").split("\n").map(clean).filter(Boolean);
    // walk list tokens
    const entries = [];
    let depth = 0, cur = null, buf = "";
    const toks = rest.replace(/<blockquote[\s\S]*?<\/blockquote>/g, "").split(/(<\/?ul[^>]*>|<\/?li[^>]*>)/);
    for (const t of toks) {
      if (/^<ul/.test(t)) { if (depth === 1 && cur && buf.trim()) { cur.name = clean(buf); buf = ""; } depth++; }
      else if (/^<\/ul/.test(t)) depth--;
      else if (/^<li/.test(t)) { buf = ""; if (depth === 1) { cur = { name: "", changes: [] }; entries.push(cur); } }
      else if (/^<\/li/.test(t)) { if (depth === 1 && cur && !cur.name) cur.name = clean(buf); else if (depth >= 2 && cur && clean(buf)) cur.changes.push(clean(buf)); buf = ""; }
      else buf += t;
    }
    if (!/COSMETIC|BUG FIX|PERFORMANCE/i.test(title)) sections.push({ title, notes, entries: entries.filter((e) => e.name) });
  }
  const introM = body.match(/<h2[^>]*id="patch-top"[^>]*>[\s\S]*?(?=<h2[^>]*id="patch-patch-highlights)/);
  const intro = introM ? clean(introM[0]).slice(0, 420) : "";
  return { intro, sections };
}
const P = parsePatch(D.patch?.body);
const patchMentions = (names) => {
  const out = [];
  for (const s of P.sections) for (const e of s.entries) {
    if (names.some((n) => e.name.toLowerCase() === n.toLowerCase())) out.push({ section: s.title, ...e });
  }
  return out;
};

// ---------- comps ----------
const LEVEL_PLAN = {
  "lvl 5": { label: "Reroll at level 5", plan: "Level 4 on 2-1 and 5 on 2-5. Hold pairs, then slow roll above 50 gold from 3-1 until your 1-cost carries are 3-star. Only then level to 6, 7 and 8 off interest." },
  "lvl 6": { label: "Reroll at level 6", plan: "Standard to level 6 on 3-2. Slow roll above 50 gold until your 2-cost carries are 3-star, then level and add a 4-cost capstone." },
  "lvl 7": { label: "Reroll at level 7", plan: "Hit level 7 around 3-5 or 4-1. Roll down for 3-star 3-costs, keeping 50 gold if you can, then level to 8 once the carry is 3-star." },
  "Fast 8": { label: "Fast 8", plan: "Play your strongest early board and save. Level to 8 on 4-1 or 4-2 and roll down hard for the 4-cost carries. Keep leveling with the gold you have left." },
  "Fast 9": { label: "Fast 9", plan: "Stabilize at level 8 around 4-2 with your 4-costs. Then save to 9 (or 10) on stage 5 and roll for the 5-costs. Your HP buys that time, so don't bleed it early." },
  Standard: { label: "Standard leveling", plan: "Follow the standard curve: 4 on 2-1, 5 on 2-5, 6 on 3-2, 7 on 3-5, 8 on 4-2. Roll when your HP says so, not before." },
};

const comps = D.comps.map((c) => {
  const d = c.details || {};
  const name = c.name.map(nameOf).join(" ");
  const units = c.units_string.split(", ").filter(Boolean);
  const carriesFromBuilds = [];
  for (const b of (d.builds || c.builds || []).sort((a, b) => b.count - a.count)) {
    if (!carriesFromBuilds.includes(b.unit) && b.num_items === 3) carriesFromBuilds.push(b.unit);
    if (carriesFromBuilds.length >= 3) break;
  }
  const mainCarry = c.name.find((x) => x.type === "unit")?.name || carriesFromBuilds[0];
  const tr = (d.trends || c.trends || []).filter((t) => t.count > 0);
  const trend = tr.length >= 3 ? tr[tr.length - 1].avg - tr[0].avg : 0;
  const pick = c.overall.count / D.sources.metatft.totalGames;
  const elo = (d.ranks || []).filter((r) => ["GOLD", "PLATINUM", "EMERALD", "DIAMOND", "MASTER"].includes(r.rank));
  const eloAvg = elo.length ? elo.reduce((s, r) => s + r.avg * r.count, 0) / elo.reduce((s, r) => s + r.count, 0) : c.overall.avg;
  return { id: c.Cluster, name, slug: slug(name), c, d, units, mainCarry, carries: [...new Set([mainCarry, ...carriesFromBuilds])].filter(Boolean).slice(0, 3), trend, pick, eloAvg, plan: LEVEL_PLAN[c.levelling] || LEVEL_PLAN.Standard };
});
const compById = Object.fromEntries(D.allComps.map((c) => [String(c.id), c]));
const compLabel = (id) => { const c = compById[String(id)]; if (!c) return "another comp"; return c.name.split(", ").map((x) => (traits[x] ? tName(x) : uName(x))).join(" "); };

// ---------- html helpers ----------
const unitChip = (id, extra = "") => { const ch = champs[id]; return `<span class="u" style="--c:${costColor[ch?.cost] || "#999"}"><img src="${img(ch?.squareIcon || ch?.tileIcon)}" alt="" loading="lazy" width="28" height="28">${esc(uName(id))}${extra}</span>`; };
const itemChip = (id) => `<span class="i"><img src="${img(D.items[id]?.icon)}" alt="" loading="lazy" width="22" height="22">${esc(iName(id))}</span>`;
const ago = (iso) => `<time datetime="${iso}" data-ago>${iso.replace("T", " ").slice(0, 16)} UTC</time>`;

const TAGS = { meta: ["Meta comp", "#ffd6d6"], patch: ["This patch", "#fff1a8"], econ: ["Econ", "#c9f2d9"], level: ["Leveling", "#cfe3ff"], items: ["Items", "#e6d6ff"], aug: ["Augments", "#ffe0c2"], pos: ["Positioning", "#c8f0f0"], mind: ["Decisions", "#f6d2ec"] };

const css = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;color:#141414;background:#fff}
a{color:inherit}
header.top{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fffffff2;backdrop-filter:blur(6px);z-index:5}
.logo{font-weight:800;letter-spacing:.04em;text-decoration:none;font-size:15px;text-transform:uppercase}
.logo b{background:#141414;color:#fff;padding:2px 6px;border-radius:4px;margin-right:6px}
.fresh{font-size:13px;color:#555;text-align:right}.fresh .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#2fbf71;margin-right:6px;vertical-align:1px}
.wrap{display:grid;grid-template-columns:200px 1fr;gap:24px;max-width:1180px;margin:0 auto;padding:22px 20px 60px}
aside .box{border:1px solid #eee;border-radius:10px;padding:10px;margin-bottom:14px}
aside h4{margin:0 0 8px;font:italic 700 11px/1 Georgia,serif;letter-spacing:.08em;text-transform:uppercase;background:#141414;color:#fff;display:inline-block;padding:4px 6px}
.tag{display:inline-block;font-size:12px;padding:3px 8px;border-radius:5px;margin:0 4px 6px 0;border:0;cursor:pointer;color:#141414;text-decoration:none;font-family:inherit}
.tag.on{outline:2px solid #141414}
.intro h1{font-size:28px;line-height:1.2;margin:0 0 6px;letter-spacing:-.01em}.intro p{margin:0 0 18px;color:#444;max-width:640px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.card{position:relative;display:block;aspect-ratio:16/8.6;border-radius:10px;overflow:hidden;text-decoration:none;color:#fff;background:#1b1b22;box-shadow:0 1px 2px #0002;transition:transform .12s}
.card:hover{transform:translateY(-2px)}
.card img.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 25%;opacity:.42;filter:saturate(.85)}
.card .t{position:absolute;left:12px;right:12px;top:10px;font-weight:700;font-size:16px;line-height:1.28;text-shadow:0 1px 3px #000a}
.card .s{display:block;font-weight:500;font-size:13px;opacity:.9;margin-top:3px}
.card .m{position:absolute;left:12px;bottom:9px;font-size:12px;opacity:.95}
.card .k{position:absolute;right:10px;bottom:8px;font-size:11px;padding:2px 8px;border-radius:5px;color:#141414}
.hide{display:none!important}
article{max-width:700px;margin:0 auto;padding:26px 20px 70px}
article .crumbs{font-size:13px;color:#666;margin-bottom:12px}article .crumbs a{color:#666}
article h1{font-size:31px;line-height:1.18;margin:6px 0 10px;letter-spacing:-.015em}
article h2{font-size:19px;margin:30px 0 8px}
article .lede{font-size:18px;color:#333}
.facts{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 6px}.facts span{background:#f4f4f6;border-radius:6px;padding:4px 9px;font-size:13px}
.box2{border-left:4px solid #141414;background:#fafafa;padding:12px 14px;border-radius:0 8px 8px 0;margin:14px 0}
.do{border-left-color:#2fbf71;background:#f1fbf5}.dont{border-left-color:#e5484d;background:#fff4f4}
.u{display:inline-flex;align-items:center;gap:6px;border:1px solid #e7e7ea;border-radius:7px;padding:2px 8px 2px 2px;margin:0 6px 6px 0;font-size:14px;background:#fff}
.u img{width:28px;height:28px;border-radius:5px;border:2px solid var(--c);object-fit:cover}
.i{display:inline-flex;align-items:center;gap:5px;margin:0 8px 4px 0;font-size:14px}.i img{width:22px;height:22px;border-radius:4px}
table{border-collapse:collapse;width:100%;font-size:14px;margin:8px 0}td,th{border-bottom:1px solid #eee;padding:7px 6px;text-align:left;vertical-align:top}th{font-size:12px;color:#666;font-weight:600}
.hex{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;max-width:440px;margin:10px 0}.hex div{aspect-ratio:1;border-radius:8px;background:#f2f2f4;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.hex .odd{transform:translateX(50%)}.hex img{width:100%;height:100%;object-fit:cover}.hex .lbl{grid-column:1/-1;aspect-ratio:auto;background:none;font-size:11px;color:#888;justify-content:flex-start;height:auto}
.muted{color:#666;font-size:14px}.src{font-size:13px;color:#666;border-top:1px solid #eee;margin-top:36px;padding-top:12px}
.chg{font-size:14px;margin:2px 0 10px 0;padding-left:18px}.chg li{margin:2px 0}
footer{font-size:13px;color:#777;text-align:center;padding:24px;border-top:1px solid #eee}
@media (max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.wrap{grid-template-columns:1fr}aside{display:flex;gap:10px;overflow-x:auto}aside .box{margin:0;flex:0 0 auto}aside .box.about{display:none}}
@media (max-width:560px){.grid{grid-template-columns:1fr}.card{aspect-ratio:16/7}.intro h1{font-size:23px}article h1{font-size:25px}header.top{padding:10px 14px}.fresh .long{display:none}}
`;
const agoJs = `<script>for(const t of document.querySelectorAll('time[data-ago]')){const d=new Date(t.getAttribute('datetime'));const m=Math.round((Date.now()-d)/6e4);const r=m<60?m+' min ago':m<2880?Math.round(m/60)+' h ago':Math.round(m/1440)+' days ago';t.textContent=d.toLocaleString([], {dateStyle:'medium',timeStyle:'short'})+' ('+r+')';}</script>`;

const page = ({ title, desc, body, depth = 0 }) => {
  const root = depth ? "../".repeat(depth) : "./";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="stylesheet" href="${root}style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>♟</text></svg>"></head><body>
<header class="top"><a class="logo" href="${root}"><b>TFT</b>Climb</a><div class="fresh"><span class="dot"></span><span class="long">Patch ${esc(patchNum)} · updated </span>${ago(updated)}</div></header>
${body}
<footer>Rebuilt automatically every 6 hours from Community Dragon, MetaTFT ranked stats and Riot patch notes. Not affiliated with Riot Games.</footer>${agoJs}</body></html>`;
};

// ---------- cards ----------
const cards = [];
const addCard = (o) => cards.push(o);
const okCache = new Map();
async function ok(url) {
  if (!url) return false;
  if (!okCache.has(url)) okCache.set(url, fetch(url, { method: "HEAD" }).then((r) => r.ok).catch(() => false));
  return okCache.get(url);
}
// Card art: try the named unit, then the most expensive real champion on the board.
async function art(ids) {
  const cands = [...new Set(ids.filter(Boolean))];
  const byCost = [...cands].sort((a, b) => (/_18_|18$/.test(b) ? 1 : 0) - (/_18_|18$/.test(a) ? 1 : 0) || (champs[b]?.cost || 0) - (champs[a]?.cost || 0));
  for (const id of [cands[0], ...byCost]) for (const u of [img(champs[id]?.icon), img(champs[id]?.squareIcon)]) if (await ok(u)) return u;
  return "";
}

// ---------- comp pages ----------
for (const [rank, k] of comps.entries()) {
  const { c, d } = k;
  const lvl7 = (d.options?.["8"] || d.options?.["7"] || [])[0];
  const board8 = (lvl7?.units_list || c.units_string.replace(/, /g, "&")).split("&");
  const levelsSeq = (d.levels || []).filter((l) => l.stage && l.level >= 4).map((l) => `L${l.level} @ ${l.stage}-${l.round}`);
  const finals = (d.final_levels || []).filter((f) => f.count / c.overall.count > 0.02).sort((a, b) => +a.level - +b.level);
  const rr = Object.entries(d.rerolls || {}).filter(([lv]) => +lv > 0).map(([lv, v]) => [+lv, v.rerolls / Math.max(1, v.matches)]).sort((a, b) => b[1] - a[1]);
  const rollLevel = rr[0]?.[0];
  const early = (d.early_options?.["4"] || []).slice(0, 2);
  const mc = (d.unit_stats || []).find((u) => u.unit === k.mainCarry);
  const t2 = mc?.tiers.find((t) => t.tier === 2), t3 = mc?.tiers.find((t) => t.tier === 3);
  const n0 = mc?.num_items.find((n) => n.num_items === 0), n3 = mc?.num_items.find((n) => n.num_items === 3);
  const counters = (d.counters || []).filter((x) => String(x.against) !== String(c.Cluster) && x.place_change > 0.08).sort((a, b) => b.place_change - a.place_change).slice(0, 3);
  const augs = (c.augments || k.c.augments || []).filter((a) => a.tier === "S").slice(0, 8);
  const pm = patchMentions([...new Set([...board8.map(uName), ...(c.traits_string || "").split(", ").map(tName)])]);

  const buildRows = k.carries.map((u) => {
    const craftable = (b) => b.buildName.every((i) => (D.items[i]?.comp || []).length === 2 && !/Radiant|Artifact|Ornn/i.test(i));
    const bs = (d.builds || []).filter((b) => b.unit === u && b.num_items === 3 && b.count >= 150 && craftable(b)).sort((a, b) => b.score - a.score).slice(0, 2);
    return bs.map((b) => `<tr><td>${unitChip(u)}</td><td>${b.buildName.map(itemChip).join("")}</td><td>${f2(b.avg)}</td><td>${b.place_change < 0 ? "▲ " + f2(-b.place_change) : "▼ " + f2(b.place_change)}</td></tr>`).join("");
  }).join("");

  // positioning: most common cell per unit on the level-8 board
  const pos = d.positioning?.units || {};
  const cells = {};
  for (const u of board8) { const p = pos[u]?.positions?.find((p) => !cells[p.cell]); if (p) cells[p.cell] = u; }
  let hex = `<div class="hex"><div class="lbl">Front row (enemy side)</div>`;
  for (const row of [3, 2, 1, 0]) for (let col = 1; col <= 7; col++) {
    const cell = `cell_${row * 7 + col}`; const u = cells[cell];
    hex += `<div class="${row % 2 ? "odd" : ""}" title="${u ? esc(uName(u)) : ""}">${u ? `<img src="${img(champs[u]?.squareIcon)}" alt="${esc(uName(u))}" loading="lazy" style="outline:2px solid ${costColor[champs[u]?.cost]}">` : ""}</div>`;
  }
  hex += `<div class="lbl">Back row</div></div>`;

  const doThis = [];
  if (t2 && t3 && t3.count > 50 && t2.avg - t3.avg > 0.8) doThis.push(`Get ${esc(uName(k.mainCarry))} to 3-star. 3-star averages <b>${f2(t3.avg)}</b>, 2-star <b>${f2(t2.avg)}</b>.`);
  if (n0 && n3) doThis.push(`Commit items to ${esc(uName(k.mainCarry))}. With 3 items it averages <b>${f2(n3.avg)}</b>; with none, <b>${f2(n0.avg)}</b>.`);
  if (finals.length >= 2) { const lo = finals[0], hi = finals[finals.length - 1]; if (lo.avg - hi.avg > 1) doThis.push(`Keep leveling. Games that end at level ${hi.level} average <b>${f2(hi.avg)}</b> and level ${lo.level} averages <b>${f2(lo.avg)}</b>. Part of that is just survival, but don't sit on gold at 8.`); }
  if (counters[0]) doThis.push(`Scout for <b>${esc(compLabel(counters[0].against))}</b>. You place ${f2(counters[0].place_change)} worse when it's in your lobby, so if it's there and contesting your units, pivot early.`);

  const body = `<article>
<div class="crumbs"><a href="../../">All lessons</a> · Meta comp #${rank + 1}</div>
<span class="tag" style="background:${TAGS.meta[1]}">Meta comp</span>
<h1>${esc(k.name)}</h1>
<p class="lede">${esc(k.plan.label)}. Averages <b>${f2(c.overall.avg)}</b> across ${c.overall.count.toLocaleString("en-US")} ranked games (Gold to Master: <b>${f2(k.eloAvg)}</b>). It shows up in ${pct(k.pick)} of boards${Math.abs(k.trend) > 0.03 ? `, and it's ${k.trend < 0 ? "getting stronger" : "slipping"} this week (${k.trend < 0 ? "▲" : "▼"} ${f2(Math.abs(k.trend))})` : ""}.</p>
<div class="facts"><span>Plan: ${esc(c.levelling)}</span><span>Difficulty: ${c.difficulty > 0.05 ? "hard" : c.difficulty < -0.05 ? "easy" : "medium"}</span>${rollLevel ? `<span>Most rolling at level ${rollLevel}</span>` : ""}<span>Patch ${esc(patchNum)}</span></div>

<h2>The principle</h2>
<div class="box2">${esc(k.plan.plan)}</div>
${levelsSeq.length ? `<p class="muted">Typical level timings in this comp: ${levelsSeq.join(" → ")}.</p>` : ""}

<h2>The board</h2>
${early.length ? `<p class="muted">Early board seen at level 4 (top-4 rate ${pct(early[0].win)}):</p><p>${early[0].unit_list.split("&").filter(isUnit).map((u) => unitChip(u)).join("")}</p>` : ""}
<p class="muted">Final board at level 8 (avg ${lvl7 ? f2(lvl7.avg) : "–"}):</p>
<p>${board8.filter((u) => champs[u]).map((u) => unitChip(u, isCarry(u) && k.carries.includes(u) ? " ★" : "")).join("")}</p>
${Object.keys(cells).length ? `<p class="muted">Where top players put each unit (most common hex):</p>${hex}` : ""}

<h2>Carry items</h2>
<table><tr><th>Unit</th><th>Build</th><th>Avg</th><th>vs. unit avg</th></tr>${buildRows || `<tr><td colspan=4 class=muted>Not enough games yet.</td></tr>`}</table>
<p class="muted">Components to prioritize: ${[...new Set(k.carries.flatMap((u) => ((d.builds || []).find((b) => b.unit === u && b.num_items === 3)?.buildName || []).flatMap((i) => D.items[i]?.comp || [])))].slice(0, 5).map(itemChip).join("") || "–"}</p>

${augs.length ? `<h2>Augments that fit</h2><p>${augs.map((a) => `<span class="u" style="padding:3px 9px">${esc(aName(a.id))}</span>`).join("")}</p>` : ""}

<h2>Do this differently</h2>
<div class="box2 do"><ul style="margin:0;padding-left:18px">${doThis.map((x) => `<li>${x}</li>`).join("")}</ul></div>

${pm.length ? `<h2>What patch ${esc(patchNum)} changed for this comp</h2>${pm.map((m) => `<p style="margin:6px 0 0"><b>${esc(m.name)}</b> <span class="muted">(${esc(m.section)})</span></p><ul class="chg">${m.changes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}` : ""}

<p class="src">Data: MetaTFT ranked stats (${esc(D.sources.metatft.set)}, refreshed ${ago(statsUpdated)}). Icons: Community Dragon. Comp stats change every rebuild.</p>
</article>`;
  await mkdir(`${OUT}/c/${k.slug}`, { recursive: true });
  await writeFile(`${OUT}/c/${k.slug}/index.html`, page({ title: `${k.name}: how to play it (TFT ${patchNum})`, desc: `${k.plan.label}. ${f2(c.overall.avg)} avg placement.`, body, depth: 2 }));
  addCard({ href: `c/${k.slug}/`, title: `${k.name}`, sub: `Avg place ${f2(c.overall.avg)} · ${k.plan.label}`, bg: await art([k.mainCarry, ...board8]), tag: "meta", time: "1 min" });
}

// ---------- lesson pages (evergreen principle + live example) ----------
const lessons = [];
const L = (o) => lessons.push(o);

// Leveling: biggest final-level gap among top comps
{
  const best = comps.map((k) => { const f = (k.d.final_levels || []).filter((x) => x.count / k.c.overall.count > 0.03).sort((a, b) => +a.level - +b.level); return { k, lo: f[0], hi: f[f.length - 1] }; }).filter((x) => x.lo && x.hi && x.lo !== x.hi).sort((a, b) => (b.lo.avg - b.hi.avg) - (a.lo.avg - a.hi.avg))[0];
  if (best) L({ slug: "levels-win-games", tag: "level", bg: await art([best.k.mainCarry, ...(comps[0]?.units || [])]), title: `Level ${best.hi.level} places ${f2(best.hi.avg)}. Level ${best.lo.level} places ${f2(best.lo.avg)}.`, sub: "Gold sitting in the bank doesn't fight",
    principle: "Levels raise your odds of finding higher-cost units and give you one more unit on the board. Fast 8 and fast 9 comps win by spending gold on XP at the right moment, not by rolling it away at level 7.",
    example: `In <a href="../../c/${best.k.slug}/">${esc(best.k.name)}</a> this patch, games that end at level ${best.hi.level} average <b>${f2(best.hi.avg)}</b>, and games that end at level ${best.lo.level} average <b>${f2(best.lo.avg)}</b>. Part of this is survivorship (if you live longer, you level more), but the gap is too big to explain away.`,
    doThis: ["Decide your plan by 3-2: reroll comp (roll at 5/6/7) or fast 8 or 9. Then follow its level timing.", "On a fast 8 plan, level 8 on 4-1 or 4-2 before you roll, not after.", "If you're healthy (60+ HP) on stage 4 at 8, keep saving for 9 instead of rolling the gold away."],
    dont: "Don't roll at level 7 for 4-costs. Your odds are much worse than at 8." });
}
// Econ
L({ slug: "interest-staircase", tag: "econ", bg: await art([comps[1]?.mainCarry, ...(comps[0]?.units || [])]), title: "Interest is a staircase, and each step is 10 gold", sub: "Spend down to a breakpoint, not below it",
  principle: "You earn 1 bonus gold for every 10 gold you hold at the end of a round, up to 5 at 50. Sitting at 50 by early stage 3 roughly doubles your income compared with spending every turn, and that pays for your level 8 roll-down.",
  example: `Say you're at 47 gold. Rolling once (2 gold) leaves 45: you still get 4 interest. Buying a 3-cost leaves 42, also 4. But rolling three times leaves 41, and one more puts you at 39 and costs you 1 interest every round until you climb back. This patch's top reroll plan, ${esc(comps.find((k) => /lvl [56]/.test(k.c.levelling))?.name || "a reroll comp")}, slow rolls only with the gold <i>above</i> 50.`,
  doThis: ["Before every roll, check you won't drop below a 10-gold breakpoint (unless you're doing your big roll-down).", "Hit 50 gold by about 3-2 on a fast 8 game. Hold pairs on the bench instead of selling them.", "Break econ only when your HP or the stage says so: under about 40 HP, or the planned roll-down stage."],
  dont: "Don't roll a little bit every turn. That's the most expensive habit in Gold." });
// Items: 3 items on carry
{
  const rows = comps.map((k) => { const u = (k.d.unit_stats || []).find((x) => x.unit === k.mainCarry); const n0 = u?.num_items.find((n) => n.num_items === 0), n3 = u?.num_items.find((n) => n.num_items === 3); return n0 && n3 && n0.count > 200 ? { k, n0, n3, gap: n0.avg - n3.avg } : null; }).filter(Boolean).sort((a, b) => b.gap - a.gap);
  const r = rows[0];
  if (r) L({ slug: "three-items-one-carry", tag: "items", bg: await art([r.k.mainCarry, ...(comps[0]?.units || [])]), title: `${uName(r.k.mainCarry)} with 3 items: ${f2(r.n3.avg)}. With none: ${f2(r.n0.avg)}.`, sub: "Stack items on one carry",
    principle: "Items multiply each other. One carry with three items that work together beats the same items split across three units. Pick the carry early, even if it's a placeholder, and stack items there.",
    example: `${esc(uName(r.k.mainCarry))} in <a href="../../c/${r.k.slug}/">${esc(r.k.name)}</a> averages <b>${f2(r.n3.avg)}</b> holding 3 items and <b>${f2(r.n0.avg)}</b> holding none. ${rows.slice(1, 3).map((x) => `${esc(uName(x.k.mainCarry))}: ${f2(x.n3.avg)} vs ${f2(x.n0.avg)}.`).join(" ")}`,
    doThis: ["By 3-2, pick one carry (the 'item holder') for your damage items, and slam on it.", "Put tank items on one frontliner, not spread across all of them.", "When you swap carries, move items with a Magnet or Reforger instead of rebuilding."],
    dont: "Don't slam damage items on a tank just because it's on the board." });
}
// Slam early
{
  const comp2 = (D.itemStats || []).map((r) => { const n = r.places.reduce((s, v) => s + v, 0); return { id: r.itemName, n, avg: r.places.reduce((s, v, i) => s + (i + 1) * v, 0) / n }; }).filter((x) => (D.items[x.id]?.comp || []).length === 2 && !/Emblem|Tacticians|Radiant/.test(x.id)).sort((a, b) => b.n - a.n).slice(0, 6);
  if (comp2.length) L({ slug: "slam-items-early", tag: "items", bg: img(D.items[comp2[0].id]?.icon), title: "Slam an item on 2-1, even if it's not perfect", sub: `${iName(comp2[0].id)} is the most-built item this patch`,
    principle: "A finished item on stage 2 wins rounds, which saves HP and earns streak gold. Holding components for the perfect item costs more than the item is worth. Flexible items like the ones below fit almost any board.",
    example: `The most-built items in ranked this patch: ${comp2.map((x) => itemChip(x.id)).join("")}. They're popular because they fit almost any comp, so slamming one early is rarely wrong.`,
    doThis: ["With 2+ components on 2-1, slam a flexible item.", "Slam tank items first if you want to win-streak, carry items if you're open-forting into a reroll.", "Use the carousel to finish a best-in-slot item, not to grab a random champion."],
    dont: "Don't keep 4+ components on the bench past 3-2." });
}
// Reroll 3-star
{
  const rr = comps.filter((k) => /lvl [567]/.test(k.c.levelling)).map((k) => { const u = (k.d.unit_stats || []).find((x) => x.unit === k.mainCarry); const t2 = u?.tiers.find((t) => t.tier === 2), t3 = u?.tiers.find((t) => t.tier === 3); return t2 && t3 && t3.count > 100 ? { k, t2, t3 } : null; }).filter(Boolean).sort((a, b) => (b.t2.avg - b.t3.avg) - (a.t2.avg - a.t3.avg))[0];
  if (rr) L({ slug: "reroll-means-three-star", tag: "level", bg: await art([rr.k.mainCarry, ...(comps[0]?.units || [])]), title: `3-star ${uName(rr.k.mainCarry)}: ${f2(rr.t3.avg)}. 2-star: ${f2(rr.t2.avg)}.`, sub: "A reroll comp that doesn't 3-star is just a weak board",
    principle: "Reroll comps give up the late game in exchange for 3-star cheap carries early. If you don't hit the 3-star, you're playing a weaker board at a lower level. Commit early, roll at the right level, and stop rolling once you hit.",
    example: `${esc(uName(rr.k.mainCarry))} in <a href="../../c/${rr.k.slug}/">${esc(rr.k.name)}</a> averages <b>${f2(rr.t3.avg)}</b> at 3 stars and <b>${f2(rr.t2.avg)}</b> at 2 stars.`,
    doThis: ["Only reroll a unit if you hold 4 or more copies by 3-1 and nobody else is buying it.", "Roll at the comp's level (5, 6 or 7) and keep 50 gold while you slow roll.", "Once your carries are 3-star, stop rolling and level up."],
    dont: "Don't reroll a unit two other players are also buying." });
}
// Scouting/contest
{
  const ct = comps.map((k) => ({ k, x: (k.d.counters || []).filter((x) => String(x.against) !== String(k.id) && x.place_change > 0).sort((a, b) => b.place_change - a.place_change)[0] })).filter((x) => x.x).sort((a, b) => b.x.place_change - a.x.place_change)[0];
  if (ct) L({ slug: "scout-before-you-roll", tag: "mind", bg: await art([ct.k.mainCarry, ...(comps[0]?.units || [])]), title: `${ct.k.name} drops ${f2(ct.x.place_change)} places when ${compLabel(ct.x.against)} is in the lobby`, sub: "Scout before you roll",
    principle: "The pool of each champion is shared by all 8 players. If someone else wants your units, your odds of hitting fall and your comp gets worse. It takes ten seconds to scout, and it changes what you should play.",
    example: `This patch, <a href="../../c/${ct.k.slug}/">${esc(ct.k.name)}</a> places <b>${f2(ct.x.place_change)}</b> worse on average in lobbies that also have ${esc(compLabel(ct.x.against))}.`,
    doThis: ["Scout the whole lobby at 2-1, 3-2 and just before your big roll-down.", "If 2+ players share your carry, pivot to the comp that shares your items.", "Before the final fights, position against your strongest opponent's board."],
    dont: "Don't lock a comp on 2-1 before you've seen the lobby." });
}
// Positioning
{
  const k = comps[0]; const pos = k.d.positioning?.units || {}; const car = pos[k.mainCarry]?.positions?.[0];
  const rowOf = (c) => Math.floor((+c.replace("cell_", "") - 1) / 7);
  const where = car ? (rowOf(car.cell) === 0 ? ([1, 7].includes(+car.cell.replace("cell_", "")) ? "back-row corner" : "back row, one hex in from the corner") : "middle rows") : "back row";
  L({ slug: "position-the-carry", tag: "pos", bg: await art([k.mainCarry, ...(comps[0]?.units || [])]), title: `Top players put ${uName(k.mainCarry)} in the ${where}`, sub: "Positioning wins the close fights",
    principle: "Your carry has to live long enough to cast. Put it away from the threat: the back corner against melee, a hex in from the corner against assassins and hooks, and spread out against splash damage. Tanks go in the front row, facing the enemy's carry.",
    example: `In <a href="../../c/${k.slug}/">${esc(k.name)}</a>, the most common spot for ${esc(uName(k.mainCarry))} is the ${where}. The comp page shows the full board.`,
    doThis: ["Every round on stage 4+, look at where the enemy's carry stands and put your tankiest unit across from it.", "Against assassins (they jump to your back row), move the carry one hex in and put a tank in the corner.", "Against splash damage, leave a hex between your backliners."],
    dont: "Don't copy a fixed layout. Scout who you're fighting next." });
}
// Augments
{
  const s = D.augTiers.find((t) => t.label === "S")?.content || [];
  if (s.length) L({ slug: "augment-picks", tag: "aug", bg: await art([comps[2]?.mainCarry, ...(comps[0]?.units || [])]), title: `${s.length} S-tier augments this patch, starting with ${aName(s[0].id)}`, sub: "Pick for your board, then for raw power",
    principle: "Choose augments in this order: whatever fits your board and items, then raw power or econ. Rerolling the augment choice is free value when nothing fits. On your first augment, flexible econ or item augments keep your options open.",
    example: `MetaTFT's current S tier: ${s.slice(0, 14).map((a) => `<span class="u" style="padding:3px 9px">${esc(aName(a.id))}</span>`).join("")}`,
    doThis: ["Reroll if none of the three fits your board.", "On the first augment, prefer flexible econ or item augments over a trait you might not play.", "On the third augment, take pure combat power if you're low on HP."],
    dont: "Don't force a trait augment into a comp that doesn't use the trait." });
}
// HP is a resource
L({ slug: "hp-is-a-currency", tag: "mind", bg: await art([comps[3]?.mainCarry, ...(comps[0]?.units || [])]), title: "HP is a currency. Spend it on purpose.", sub: "Lose streak or win streak, not 50/50",
  principle: "Each streak pays bonus gold. Alternating wins and losses pays nothing and still costs HP. Choose early: lose on purpose with a weak board and bank gold, or stay strong and win. The worst spot is in between.",
  example: `Fast 9 comps this patch (${comps.filter((k) => k.c.levelling === "Fast 9").map((k) => `<a href="../../c/${k.slug}/">${esc(k.name)}</a>`).join(", ") || "none in the top list"}) only work if you reach stage 5 with enough HP to keep saving. That's why the early game matters even when you plan to lose it.`,
  doThis: ["After 2-1, decide: streak up (buy units, slam items) or lose streak (sell to 50, take the fights you lose).", "With about 40 HP or less, stop saving and roll to stabilize.", "Track your HP compared with the lobby, not on its own. Being 4th-highest at 30 HP is fine."],
  dont: "Don't roll for upgrades at level 6 with 70 HP and no plan." });

// Patch lesson
if (D.patch) {
  const big = P.sections.filter((s) => /TRAIT|UNITS|AUGMENT|SYSTEM/i.test(s.title));
  const affected = comps.filter((k) => patchMentions([...k.units.map(uName), ...(k.c.traits_string || "").split(", ").map(tName)]).length);
  const body = `<article><div class="crumbs"><a href="../">All lessons</a> · This patch</div>
<span class="tag" style="background:${TAGS.patch[1]}">This patch</span>
<h1>What ${esc(D.patch.title.replace(/^Teamfight Tactics /i, "").replace(/^patch/i, "Patch"))} changed, and what to do about it</h1>
<p class="lede">${esc(P.intro || "")}</p>
<div class="facts"><span>Published ${esc(D.patch.published.slice(0, 10))}</span><span>${esc(setName)}</span><a class="tag" style="background:#eee" href="${esc(D.patch.url)}">Full notes ↗</a></div>
${affected.length ? `<h2>What it means for today's meta comps</h2><table><tr><th>Comp</th><th>Changed this patch</th></tr>${affected.map((k) => `<tr><td><a href="../c/${k.slug}/">${esc(k.name)}</a></td><td>${patchMentions([...k.units.map(uName), ...(k.c.traits_string || "").split(", ").map(tName)]).map((m) => esc(m.name)).join(", ")}</td></tr>`).join("")}</table><div class="box2 do">If a comp's carry or core trait got buffed, it will be overplayed in the first days. Scout for it before you commit.</div>` : ""}
${big.map((s) => `<h2>${esc(s.title.charAt(0) + s.title.slice(1).toLowerCase())}</h2>${s.notes.length ? `<details><summary class="muted">Why Riot changed it</summary><p class="muted">${s.notes.map(esc).join("<br><br>")}</p></details>` : ""}${s.entries.map((e) => `<p style="margin:6px 0 0"><b>${esc(e.name)}</b></p>${e.changes.length ? `<ul class="chg">${e.changes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`).join("")}`).join("")}
<p class="src">Source: <a href="${esc(D.patch.url)}">Riot patch notes</a>. Pulled ${ago(updated)}.</p></article>`;
  await mkdir(`${OUT}/patch`, { recursive: true });
  await writeFile(`${OUT}/patch/index.html`, page({ title: `${D.patch.title}: what changed`, desc: P.intro, body, depth: 1 }));
  cards.unshift({ href: "patch/", title: `Patch ${patchNum}: what changed`, sub: `${big.reduce((n, s) => n + s.entries.length, 0)} changes · ${affected.length} meta comps affected`, bg: await art([affected[0]?.mainCarry, ...(affected[0]?.units || comps[0]?.units || [])]), tag: "patch", time: "3 min" });
}

for (const l of lessons) {
  const body = `<article><div class="crumbs"><a href="../../">All lessons</a> · ${esc(TAGS[l.tag][0])}</div>
<span class="tag" style="background:${TAGS[l.tag][1]}">${esc(TAGS[l.tag][0])}</span>
<h1>${esc(l.title)}</h1><p class="lede">${esc(l.sub)}.</p>
<h2>The principle</h2><p>${l.principle}</p>
<h2>A real example (live data)</h2><div class="box2">${l.example}</div>
<h2>Do this instead</h2><div class="box2 do"><ul style="margin:0;padding-left:18px">${l.doThis.map((x) => `<li>${x}</li>`).join("")}</ul></div>
<div class="box2 dont"><b>Don't:</b> ${l.dont}</div>
<p class="src">Examples use MetaTFT ranked stats for patch ${esc(patchNum)}, refreshed ${ago(statsUpdated)}. Numbers change with every rebuild.</p></article>`;
  await mkdir(`${OUT}/l/${l.slug}`, { recursive: true });
  await writeFile(`${OUT}/l/${l.slug}/index.html`, page({ title: l.title, desc: l.sub, body, depth: 2 }));
}
// interleave lessons among comp cards: patch, 2 lessons, comps..., remaining
const compCards = cards.filter((c) => c.tag === "meta"), patchCard = cards.filter((c) => c.tag === "patch");
const lessonCards = lessons.map((l) => ({ href: `l/${l.slug}/`, title: l.title, sub: l.sub, bg: l.bg, tag: l.tag, time: "1 min" }));
const ordered = [...patchCard];
let li = 0;
for (let i = 0; i < compCards.length; i++) { ordered.push(compCards[i]); if (i % 2 === 1 && li < lessonCards.length) ordered.push(lessonCards[li++]); }
while (li < lessonCards.length) ordered.push(lessonCards[li++]);

// ---------- index ----------
const tagBtn = (k) => `<button class="tag" data-f="${k}" style="background:${TAGS[k][1]}">${TAGS[k][0]}</button>`;
const index = `<div class="wrap"><aside>
<div class="box"><h4>Play</h4><br>${tagBtn("meta")}${tagBtn("patch")}</div>
<div class="box"><h4>Fundamentals</h4><br>${tagBtn("econ")}${tagBtn("level")}${tagBtn("items")}</div>
<div class="box"><h4>In the fight</h4><br>${tagBtn("aug")}${tagBtn("pos")}${tagBtn("mind")}</div>
<div class="box about"><h4>How it works</h4><p class="muted" style="margin:6px 0 0;font-size:12px">Every 6 hours a bot pulls the latest ranked stats and patch notes and rebuilds this site. The principles don't change; the examples and comps do.</p></div>
</aside><main>
<div class="intro"><h1>Get better at TFT, one short lesson at a time.</h1><p>Each card is one idea: the principle, a real example from this patch's ranked games, and what to do differently next game. ${esc(setName)}, patch ${esc(patchNum)}, ${D.sources.metatft.totalGames.toLocaleString("en-US")} ranked games.</p></div>
<div class="grid" id="g">${ordered.map((c) => `<a class="card" data-t="${c.tag}" href="${c.href}">${c.bg ? `<img class="bg" src="${c.bg}" alt="" loading="lazy">` : ""}<span class="t">${esc(c.title)}<span class="s">${esc(c.sub)}</span></span><span class="m">⏱ ${c.time}</span><span class="k" style="background:${TAGS[c.tag][1]}">${TAGS[c.tag][0]}</span></a>`).join("")}</div>
</main></div>
<script>const bs=[...document.querySelectorAll('[data-f]')];bs.forEach(b=>b.onclick=()=>{const on=!b.classList.contains('on');bs.forEach(x=>x.classList.remove('on'));if(on)b.classList.add('on');document.querySelectorAll('#g .card').forEach(c=>c.classList.toggle('hide',on&&c.dataset.t!==b.dataset.f));});</script>`;
await writeFile(`${OUT}/index.html`, page({ title: `TFT Climb: short lessons for patch ${patchNum}`, desc: "Short, concrete TFT lessons and meta comps rebuilt from live ranked data every 6 hours.", body: index }));
await writeFile(`${OUT}/style.css`, css);
await writeFile(`${OUT}/404.html`, page({ title: "Not found", desc: "", body: `<article><h1>That page moved</h1><p>Comps change every rebuild. <a href="./">See today's lessons</a>.</p></article>` }));
await writeFile(`${OUT}/status.json`, JSON.stringify({ updated, patch: D.patch?.title, set: D.sources.metatft.set, statsUpdated, comps: comps.map((k) => k.name), lessons: lessons.length }, null, 1));
await writeFile(`${OUT}/.nojekyll`, "");
console.log(`rendered ${ordered.length} cards, ${comps.length} comps, ${lessons.length} lessons`);
