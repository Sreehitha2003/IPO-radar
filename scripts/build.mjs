// Daily IPO Radar build: collect GMP + subscription, score every IPO, write the report, render the site.
// Runs in GitHub Actions every morning (see .github/workflows/daily.yml). No API keys needed.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { tables, mapColumns, gmpValue, priceHigh, priceLow, num, dates, key, sameIpo, cleanName, isSme } from "./parse.mjs";

const ROOT = new URL("..", import.meta.url);
const P = (p) => new URL(p, ROOT);
const readJson = async (p, d) => { try { return JSON.parse(await readFile(P(p), "utf8")); } catch { return d; } };

const nowIST = new Date(Date.now() + 5.5 * 3600e3);
const TODAY = nowIST.toISOString().slice(0, 10);
const STAMP = nowIST.toISOString().slice(0, 16).replace("T", " ") + " IST";
const todayDate = new Date(TODAY + "T00:00:00Z");

/* ---------------- sources ---------------- */
// Several independent sites, so one site changing its layout or blocking us doesn't break the report.
const GMP_SOURCES = [
  { id: "ipoji", label: "IPO Ji", url: "https://www.ipoji.com/ipo-gmp" },
  { id: "ipowatch", label: "IPO Watch", url: "https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/" },
  { id: "investorgain", label: "Investorgain", url: "https://www.investorgain.com/report/live-ipo-gmp/331/" },
  { id: "ipocentral", label: "IPO Central", url: "https://ipocentral.in/ipo-discussion/" },
];
const SUB_SOURCES = [
  { id: "chittorgarh", label: "Chittorgarh", url: "https://www.chittorgarh.com/report/ipo-subscription-status-live-bidding-data-bse-nse/21/" },
  { id: "ipoji-subs", label: "IPO Ji", url: "https://www.ipoji.com/ipo-subscription-status-live-bidding-data-bse-nse" },
  { id: "ipopremium-subs", label: "IPO Premium", url: "https://www.ipopremium.in/view/subscription" },
];
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml", "accept-language": "en-IN,en;q=0.9",
};
async function get(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 25000);
  try { const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}
const FIXTURES = process.env.IPO_FIXTURES; // folder of saved pages, for testing without internet
async function page(src) {
  if (FIXTURES) return readFile(new URL(`${src.id}.html`, `file://${FIXTURES.replace(/\/?$/, "/")}`), "utf8");
  return get(src.url);
}

function readGmpTables(html) {
  const rows = [];
  for (const t of tables(html)) {
    const map = mapColumns(t, { name: /ipo|name|company/i, gmp: /gmp|premium/i, price: /price|issue/i, open: /open/i, close: /close/i, listing: /listing/i, type: /type|board|exchange|category/i, date: /date/i });
    if (!map || map.idx.gmp == null) continue;
    for (const r of t.slice(map.header + 1)) {
      const c = (k) => (map.idx[k] != null ? r[map.idx[k]] : "");
      const name = cleanName(c("name"));
      if (!name || name.length < 3 || /^(ipo|name)$/i.test(name)) continue;
      const ds = dates([c("date"), c("open"), c("close")].join(" "), todayDate);
      rows.push({ name, key: key(name), gmp: gmpValue(c("gmp")), price: priceHigh(c("price")), priceLow: priceLow(c("price")),
        sme: isSme(c("name"), c("type"), ...r), open: ds[0] || null, close: ds[1] || ds[0] || null, listing: dates(c("listing"), todayDate)[0] || null });
    }
  }
  return rows;
}
function readSubTables(html) {
  const rows = [];
  for (const t of tables(html)) {
    const map = mapColumns(t, { name: /ipo|name|company/i, qib: /qib/i, nii: /nii|hni/i, retail: /retail|rii/i, total: /total|overall/i });
    if (!map || map.idx.total == null) continue;
    for (const r of t.slice(map.header + 1)) {
      const c = (k) => (map.idx[k] != null ? r[map.idx[k]] : null);
      const name = cleanName(c("name"));
      if (!name || name.length < 3) continue;
      const total = num(c("total"));
      if (total == null) continue;
      rows.push({ name, key: key(name), qib: num(c("qib")), nii: num(c("nii")), retail: num(c("retail")), total });
    }
  }
  return rows;
}

/* ---------------- scoring: the same checklist shown on the site ---------------- */
function score(x) {
  const reasons = [], risks = [];
  let s = 0;
  const price = x.priceHigh || x.priceLow;
  const g = x.gmp?.value, pct = g != null && price ? (g / price) * 100 : null;
  if (pct == null) risks.push("No grey-market quote yet");
  else if (pct >= 30) { s += 3; reasons.push(`Grey market ${pct.toFixed(0)}% above issue price`); }
  else if (pct >= 15) { s += 2; reasons.push(`Grey market ${pct.toFixed(0)}% above issue price`); }
  else if (pct >= 5) { s += 1; reasons.push(`Modest grey market premium (${pct.toFixed(0)}%)`); }
  else if (pct < 0) { s -= 2; risks.push(`Grey market below issue price (${pct.toFixed(0)}%)`); }
  else risks.push(`Grey market almost flat (${pct.toFixed(0)}%)`);

  const sub = x.subs, lastDay = x.close && TODAY >= x.close;
  if (sub?.total != null) {
    if (sub.qib != null && sub.qib >= 10) { s += 2; reasons.push(`Institutions (QIB) bid ${sub.qib}x`); }
    else if (sub.qib != null && sub.qib >= 2) { s += 1; reasons.push(`Institutions (QIB) bid ${sub.qib}x`); }
    else if (sub.qib != null && sub.qib < 1 && lastDay) risks.push(`Institutions only ${sub.qib}x on the final day`);
    if (sub.total >= 20) { s += 2; reasons.push(`Oversubscribed ${sub.total}x overall`); }
    else if (sub.total >= 5) { s += 1; reasons.push(`Subscribed ${sub.total}x overall`); }
    else if (sub.total < 1 && lastDay) { s -= 1; risks.push(`Not fully subscribed (${sub.total}x)`); }
  }

  const f = x.fin || {};
  if (f.loss) { s -= 2; risks.push("Company is loss-making"); }
  if (f.growing === true) { s += 1; reasons.push("Revenue and profit growing"); }
  if (f.growing === false) { s -= 1; risks.push("Revenue or profit shrinking"); }
  if (f.pe != null && !f.loss) {
    if (f.pe <= 25) { s += 1; reasons.push(`Reasonably priced at ${f.pe}x earnings`); }
    else if (f.pe > 40) { s -= 1; risks.push(`Expensive at ${f.pe}x earnings`); }
  }
  if (x.ofsCr && x.sizeCr && x.ofsCr / x.sizeCr > 0.5) { s -= 1; risks.push("Mostly existing owners selling (OFS)"); }
  if (f.heavyDebt) { s -= 1; risks.push("High debt"); }
  for (const r of f.extraRisks || []) risks.push(r);
  for (const r of f.extraReasons || []) reasons.push(r);
  if (!x.fin) risks.push("No financials on file: verdict uses grey market and demand only");

  let verdict = s >= 5 ? "apply" : s >= 3 ? "listing" : s >= 1 ? "wait" : "avoid";
  if (x.board === "SME") {
    risks.unshift("SME issue: small company, big lots, low liquidity");
    if (!(pct >= 20 && (sub?.total ?? 0) >= 50)) verdict = verdict === "avoid" ? "avoid" : "wait";
  }
  return { score: Math.max(-5, Math.min(10, s)), verdict, reasons, risks, pct };
}
const SUMMARY = {
  apply: "Strong on the checklist. Worth applying.",
  listing: "Good for a listing-day trade; sell on listing rather than holding.",
  wait: "Mixed signals. Decide on the last day after the institutional (QIB) numbers are in.",
  avoid: "Weak on the checklist. Skip unless you have your own strong view.",
};

/* ---------------- build ---------------- */
function statusOf(x) {
  if (x.listing && TODAY >= x.listing) return "listed";
  if (x.close && TODAY > x.close) return "closed";
  if (x.open && TODAY < x.open) return "upcoming";
  if (x.open) return "open";
  return "upcoming";
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function main() {
  const state = await readJson("data/state.json", { ipos: {} });
  const fundamentals = await readJson("data/fundamentals.json", {});
  const reports = await readJson("data/reports.json", []);
  const health = [];

  const gmpRows = [], subRows = [];
  for (const src of GMP_SOURCES) {
    try { const rows = readGmpTables(await page(src)); rows.forEach((r) => (r.src = src)); gmpRows.push(...rows); health.push({ source: src.label, ok: rows.length > 0, rows: rows.length }); }
    catch (e) { health.push({ source: src.label, ok: false, error: String(e.message || e) }); }
  }
  for (const src of SUB_SOURCES) {
    try { const rows = readSubTables(await page(src)); rows.forEach((r) => (r.src = src)); subRows.push(...rows); health.push({ source: src.label + " (subscription)", ok: rows.length > 0, rows: rows.length }); }
    catch (e) { health.push({ source: src.label + " (subscription)", ok: false, error: String(e.message || e) }); }
  }
  console.log("Sources:", health);

  // Start from everything we already know (yesterday's state + hand-entered fundamentals).
  const ipos = state.ipos || {};
  for (const [id, f] of Object.entries(fundamentals)) ipos[id] = { ...(ipos[id] || {}), ...f, id };
  const findId = (k) => Object.keys(ipos).find((id) => sameIpo(key(ipos[id].name), k));

  // Merge GMP: group rows per IPO, take the middle value across sites.
  const groups = new Map();
  for (const r of gmpRows) { let g = [...groups.keys()].find((k) => sameIpo(k, r.key)); if (!g) { g = r.key; groups.set(g, []); } groups.get(g).push(r); }
  for (const [k, rows] of groups) {
    let id = findId(k);
    if (!id) {
      const first = rows[0];
      if (!first.open && !first.close) continue; // not enough to place it on the calendar
      id = k; ipos[id] = { id, name: first.name, board: rows.some((r) => r.sme) ? "SME" : "Mainboard" };
    }
    const x = ipos[id];
    x.priceHigh ??= median(rows.map((r) => r.price).filter(Boolean));
    x.priceLow ??= median(rows.map((r) => r.priceLow).filter(Boolean));
    x.open ??= rows.find((r) => r.open)?.open; x.close ??= rows.find((r) => r.close)?.close; x.listing ??= rows.find((r) => r.listing)?.listing;
    if (x.close && !x.allot) x.allot = addDays(x.close, 1);
    const vals = rows.map((r) => r.gmp).filter((v) => v != null);
    if (vals.length) {
      const prev = x.gmp?.value;
      x.gmp = { value: median(vals), range: vals.length > 1 ? [Math.min(...vals), Math.max(...vals)] : null, asOf: `${STAMP} · ${[...new Set(rows.filter((r) => r.gmp != null).map((r) => r.src.label))].join(", ")}` };
      x.gmpHistory = [...(x.gmpHistory || []).filter((h) => h.d !== TODAY), { d: TODAY, v: x.gmp.value }].slice(-20);
      if (prev != null) x.gmpPrev = prev;
    }
  }
  // Merge subscription: take the highest total reported (numbers only go up during bidding).
  for (const r of subRows) {
    const id = findId(r.key); if (!id) continue;
    const x = ipos[id];
    if (!x.subs || r.total >= (x.subs.total ?? 0)) x.subs = { qib: r.qib, nii: r.nii, retail: r.retail, total: r.total, asOf: `${STAMP} · ${r.src.label}`, day: statusOf(x) === "open" ? "Latest" : "Final" };
  }

  // Score, set status, drop IPOs that listed more than a week ago.
  const list = [];
  for (const [id, x] of Object.entries(ipos)) {
    x.id = id; x.status = statusOf(x);
    if (x.status === "listed" && x.listing && addDays(x.listing, 7) < TODAY) { delete ipos[id]; continue; }
    const sc = score(x);
    Object.assign(x, { score: sc.score, verdict: sc.verdict, reasons: sc.reasons, risks: sc.risks, summary: x.status === "closed" ? `Bidding closed. ${sc.verdict === "apply" || sc.verdict === "listing" ? "If you were allotted, a listing gain looks likely." : "If you were allotted, don't expect much of a listing gain."}` : SUMMARY[sc.verdict] });
    list.push(x);
  }

  // Today's report.
  const live = list.filter((x) => x.status === "open" || x.status === "upcoming");
  const byV = (v) => live.filter((x) => x.verdict === v).sort((a, b) => b.score - a.score).map((x) => x.id);
  const nm = (ids) => ids.map((id) => ipos[id].name);
  const join = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a.at(-1));
  const apply = byV("apply"), listing = byV("listing"), wait = byV("wait"), avoid = byV("avoid");
  const closingToday = list.filter((x) => x.status === "open" && x.close === TODAY).map((x) => x.name);
  const opening = list.filter((x) => x.open === TODAY).map((x) => x.name);
  const headline = apply.length ? `${join(nm(apply.slice(0, 2)))} ${apply.length > 1 ? "are" : "is"} today's strongest call${apply.length > 1 ? "s" : ""}`
    : listing.length ? `No clear buys today; ${join(nm(listing.slice(0, 2)))} look${listing.length > 1 ? "" : "s"} good for listing gains`
    : live.length ? "Nothing strong on the checklist today" : "No IPOs open or coming up";
  const parts = [`${live.filter((x) => x.status === "open").length} IPOs open and ${live.filter((x) => x.status === "upcoming").length} coming up.`];
  if (apply.length) parts.push(`Apply: ${join(nm(apply))}.`);
  if (listing.length) parts.push(`Listing gains only: ${join(nm(listing))}.`);
  if (wait.length) parts.push(`Wait for final-day numbers: ${join(nm(wait))}.`);
  if (avoid.length) parts.push(`Avoid: ${join(nm(avoid))}.`);
  if (closingToday.length) parts.push(`Closing today: ${join(closingToday)}.`);
  if (opening.length) parts.push(`Opening today: ${join(opening)}.`);
  const failed = health.filter((h) => !h.ok).length;
  const report = { date: TODAY, generatedAt: STAMP, headline, summary: parts.join(" "), apply, listing, wait, avoid,
    note: failed === health.length ? "No data source could be reached today, so these numbers are carried over from the last successful run." : failed ? `${failed} of ${health.length} data sources failed today; the rest were used.` : "" };
  if (process.env.IPO_SEED) { report.note = ""; report.generatedAt = TODAY + " (researched by hand; automatic updates start with the first daily run)"; }
  const allReports = [report, ...reports.filter((r) => r.date !== TODAY)].slice(0, 60);

  await mkdir(P("data/"), { recursive: true });
  await writeFile(P("data/state.json"), JSON.stringify({ updated: STAMP, ipos }, null, 1));
  await writeFile(P("data/reports.json"), JSON.stringify(allReports, null, 1));
  await writeFile(P("data/health.json"), JSON.stringify({ date: TODAY, health }, null, 1));

  const tpl = await readFile(P("site/template.html"), "utf8");
  const data = { ipos: list, reports: allReports, health, today: TODAY };
  const html = tpl.replace("/*__DATA__*/null", JSON.stringify(data).replace(/</g, "\\u003c"));
  await mkdir(P("site/out/"), { recursive: true });
  await writeFile(P("site/out/index.html"), html);
  console.log(`Built report for ${TODAY}: ${list.length} IPOs. ${headline}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
