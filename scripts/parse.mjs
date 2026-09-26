// Small, dependency-free helpers for reading IPO tables out of web pages.

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", rsquo: "'", lsquo: "'", ndash: "–", mdash: "—", rupee: "₹" };
export function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return String.fromCodePoint(n); }
    return ENT[e.toLowerCase()] ?? m;
  });
}
export const text = (html) => decode(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Every <table> in the page as an array of rows of cell text (header rows included). */
export function tables(html) {
  const out = [];
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  for (const t of clean.match(/<table[\s\S]*?<\/table>/gi) || []) {
    const rows = [];
    for (const tr of t.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(text);
      if (cells.length) rows.push(cells);
    }
    if (rows.length > 1) out.push(rows);
  }
  return out;
}

/** Find the header row and map wanted columns (name -> regex) to indexes. */
export function mapColumns(rows, wanted) {
  for (let h = 0; h < Math.min(rows.length, 3); h++) {
    const idx = {};
    rows[h].forEach((c, i) => {
      for (const [k, re] of Object.entries(wanted)) if (idx[k] == null && re.test(c)) { idx[k] = i; break; }
    });
    if (idx.name != null && Object.keys(idx).length >= 2) return { header: h, idx };
  }
  return null;
}

export function num(s) {
  if (s == null) return null;
  const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
/** GMP cells look like "₹80 (29.41%)", "80", "-5", "--" or "₹ -". */
export function gmpValue(s) {
  if (!s) return null;
  const t = String(s).replace(/,/g, "");
  if (/^\s*[-–—]+\s*$/.test(t) || /n\/?a/i.test(t)) return null;
  const m = t.match(/(-|−)?\s*₹?\s*(-|−)?\s*(\d+(\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[3]);
  return (m[1] || m[2]) ? -v : v;
}
/** Highest number in a price cell ("₹258-272" -> 272). */
export function priceHigh(s) {
  const ns = (String(s || "").replace(/,/g, "").match(/\d+(\.\d+)?/g) || []).map(Number).filter((n) => n > 0 && n < 100000);
  return ns.length ? Math.max(...ns) : null;
}
export function priceLow(s) {
  const ns = (String(s || "").replace(/,/g, "").match(/\d+(\.\d+)?/g) || []).map(Number).filter((n) => n > 0 && n < 100000);
  return ns.length ? Math.min(...ns) : null;
}

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** Dates such as "Sep 24-28", "24-28 Sep", "25 Sep 2026", "Sep 30-Oct 5". Year is inferred from today. */
export function dates(s, today = new Date()) {
  const str = String(s || "");
  const out = [];
  const yearFor = (m, explicit) => {
    if (explicit) return +explicit;
    const y = today.getFullYear(), cm = today.getMonth();
    return m < cm - 6 ? y + 1 : m > cm + 6 ? y - 1 : y;
  };
  // "Sep 30-Oct 5" or "Sep 24-28" or "Sep 24"
  const re1 = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:\s*[-–to]+\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?(\d{1,2}))?(?:,?\s*(\d{4}))?/gi;
  let m;
  while ((m = re1.exec(str))) {
    const m1 = MON[m[1].toLowerCase().slice(0, 3)];
    out.push(iso(yearFor(m1, m[5]), m1, +m[2]));
    if (m[4]) { const m2 = m[3] ? MON[m[3].toLowerCase().slice(0, 3)] : m1; out.push(iso(yearFor(m2, m[5]), m2, +m[4])); }
  }
  if (out.length) return out;
  // "24-28 Sep" or "25 Sep 2026" or "30 Sep - 5 Oct"
  const re2 = /(\d{1,2})(?:\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)?\s*[-–]\s*(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(\d{4}))?|(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(\d{4}))?/gi;
  while ((m = re2.exec(str))) {
    if (m[3]) {
      const m2 = MON[m[4].toLowerCase().slice(0, 3)], m1 = m[2] ? MON[m[2].toLowerCase().slice(0, 3)] : m2;
      out.push(iso(yearFor(m1, m[5]), m1, +m[1]), iso(yearFor(m2, m[5]), m2, +m[3]));
    } else {
      const mm = MON[m[7].toLowerCase().slice(0, 3)];
      out.push(iso(yearFor(mm, m[8]), mm, +m[6]));
    }
  }
  return out;
}

/** A stable key for matching the same IPO across websites. */
export function key(name) {
  return String(name || "").toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(ipo|ltd|limited|pvt|private|the|sme|bse|nse|and|india|gmp|upcoming|open|closed|listed)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}
export const sameIpo = (a, b) => a && b && (a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a))));
export const cleanName = (s) => String(s || "").replace(/\s*(IPO|GMP)\b.*$/i, "").replace(/\s+(BSE|NSE)\s*SME\s*$/i, "").replace(/\s+/g, " ").trim();
export const isSme = (...cells) => cells.some((c) => /\bsme\b/i.test(String(c || "")));
