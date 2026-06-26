const fs = require("fs");
const path = require("path");
const { DATA_DIR, readJson, writeJson } = require("./dataStore");

function pct(n) { return `${Number(n || 0).toFixed(2)}%`; }
function num(n, d = 2) { return Number(n || 0).toFixed(d); }
function hourOf(dateStr) { const d = new Date(dateStr); return Number.isNaN(d.getTime()) ? "?" : String(d.getHours()).padStart(2, "0") + ":00"; }
function csvEscape(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

function normalizeTrade(t) {
  const result = t.status === "OPEN" ? "OPEN" : (t.status || "UNKNOWN").replace("CLOSED_", "");
  const pnl = Number(t.pnlPercent || 0);
  const reached = t.tp3Done ? "TP3" : t.tp2Done ? "TP2" : t.tp1Done ? "TP1" : result;
  return { ...t, result, pnl, reached, hour: hourOf(t.openedAt) };
}

function buildWeeklyReport(tradesInput, opts = {}) {
  const days = Number(opts.days || process.env.REPORT_DAYS || 7);
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = (tradesInput || readJson("trades.json", []) || []).map(normalizeTrade);
  const trades = all.filter((t) => {
    const ts = new Date(t.openedAt || t.createdAt || 0).getTime();
    return ts && ts >= since;
  });
  const closed = trades.filter((t) => t.status !== "OPEN");
  const open = trades.filter((t) => t.status === "OPEN");
  const wins = closed.filter((t) => Number(t.pnl) > 0);
  const losses = closed.filter((t) => Number(t.pnl) <= 0);
  const tp1 = closed.filter((t) => t.tp1Done || ["TP1", "TP2", "TP3", "TP"].includes(t.reached)).length;
  const tp2 = closed.filter((t) => t.tp2Done || ["TP2", "TP3"].includes(t.reached)).length;
  const tp3 = closed.filter((t) => t.tp3Done || t.reached === "TP3" || t.status === "CLOSED_TP").length;
  const stop = closed.filter((t) => t.status === "CLOSED_SL" || t.result === "SL").length;
  const totalPnl = closed.reduce((a, t) => a + Number(t.pnl || 0), 0);
  const avgPnl = closed.length ? totalPnl / closed.length : 0;
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const tp1Rate = closed.length ? (tp1 / closed.length) * 100 : 0;

  const group = (keyFn) => {
    const m = {};
    for (const t of closed) {
      const k = keyFn(t) || "?";
      if (!m[k]) m[k] = { count: 0, wins: 0, pnl: 0 };
      m[k].count += 1;
      if (Number(t.pnl) > 0) m[k].wins += 1;
      m[k].pnl += Number(t.pnl || 0);
    }
    return Object.entries(m).map(([key, v]) => ({ key, ...v, winRate: v.count ? (v.wins / v.count) * 100 : 0 }))
      .sort((a, b) => b.pnl - a.pnl);
  };

  const bySymbol = group((t) => t.symbol);
  const byHour = group((t) => t.hour);
  const bestSymbol = bySymbol[0];
  const worstSymbol = [...bySymbol].sort((a, b) => a.pnl - b.pnl)[0];
  const bestHour = byHour[0];
  const worstHour = [...byHour].sort((a, b) => a.pnl - b.pnl)[0];

  const report = {
    days, generatedAt: new Date().toISOString(), total: trades.length, closed: closed.length, open: open.length,
    wins: wins.length, losses: losses.length, winRate, tp1, tp2, tp3, stop, tp1Rate, totalPnl, avgPnl,
    bestSymbol, worstSymbol, bestHour, worstHour, bySymbol, byHour,
    trades: trades.sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt)),
  };
  writeJson("weekly_report.json", report);
  return report;
}

function formatWeeklyReport(report) {
  const r = report || buildWeeklyReport();
  return `
📊 <b>FALIX 1 HAFTALIK PAPER RAPOR</b>

Toplam plan: <b>${r.total}</b>
Kapanan işlem: <b>${r.closed}</b>
Açık işlem: <b>${r.open}</b>

✅ Kazanan: <b>${r.wins}</b>
❌ Kaybeden: <b>${r.losses}</b>
🏆 Win Rate: <b>${pct(r.winRate)}</b>
🎯 TP1 Görme Oranı: <b>${pct(r.tp1Rate)}</b>

TP1: <b>${r.tp1}</b>
TP2: <b>${r.tp2}</b>
TP3: <b>${r.tp3}</b>
Stop: <b>${r.stop}</b>

📈 Toplam Paper Sonuç: <b>${pct(r.totalPnl)}</b>
Ortalama işlem: <b>${pct(r.avgPnl)}</b>

En iyi coin: <b>${r.bestSymbol ? `${r.bestSymbol.key} (${pct(r.bestSymbol.pnl)})` : "-"}</b>
En kötü coin: <b>${r.worstSymbol ? `${r.worstSymbol.key} (${pct(r.worstSymbol.pnl)})` : "-"}</b>
En iyi saat: <b>${r.bestHour ? `${r.bestHour.key} (${pct(r.bestHour.pnl)})` : "-"}</b>
En kötü saat: <b>${r.worstHour ? `${r.worstHour.key} (${pct(r.worstHour.pnl)})` : "-"}</b>

📌 Not: Bu rapor gerçek emir değil, paper trade testidir. 1 hafta stratejiye dokunmadan veri topla.
`;
}

function exportTradesCsv(tradesInput) {
  const trades = (tradesInput || readJson("trades.json", []) || []).map(normalizeTrade);
  const headers = ["id","symbol","side","status","openedAt","closedAt","entry","exit","stopLossPrice","tp1Price","tp2Price","tp3Price","tp1Done","tp2Done","tp3Done","highestPnlPercent","pnlPercent","score","confidence","volumeRatio","riskReward","reason"];
  const rows = [headers.join(",")];
  for (const t of trades) {
    rows.push(headers.map((h) => csvEscape(t[h] ?? t.signalSnapshot?.[h] ?? t.plan?.[h] ?? "")).join(","));
  }
  const fp = path.join(DATA_DIR, "paper_trades.csv");
  fs.writeFileSync(fp, rows.join("\n"), "utf8");
  return fp;
}

module.exports = { buildWeeklyReport, formatWeeklyReport, exportTradesCsv };
