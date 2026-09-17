const { readJson, writeJson } = require("./dataStore");

const KINDS = ["LIVE", "PAPER", "TESTNET"];
const files = { LIVE: "live_stats.json", PAPER: "paper_stats.json", TESTNET: "testnet_stats.json" };
const stats = {};
const RISK_METRIC_VERSION = 2;

function fresh() {
  return { metricVersion: RISK_METRIC_VERSION, date: new Date().toISOString().slice(0, 10), tradesToday: 0, lossPercentToday: 0, consecutiveLosses: 0, pauseUntil: null };
}

for (const kind of KINDS) {
  const loaded = readJson(files[kind], fresh());
  // Eski sürüm canlı zararı toplam hesap yerine kullanılan marja göre
  // kaydediyordu. Bu değer yeni metrikle karşılaştırılamaz; bir defaya
  // mahsus temizleyerek yanlış günlük kilidi kaldır.
  stats[kind] = Number(loaded?.metricVersion) === RISK_METRIC_VERSION
    ? { ...fresh(), ...loaded, metricVersion: RISK_METRIC_VERSION }
    : fresh();
}

function normalizeKind(kind) {
  const value = String(kind || "LIVE").toUpperCase();
  return KINDS.includes(value) ? value : "LIVE";
}

function resetIfNewDay(kind) {
  const key = normalizeKind(kind);
  const today = new Date().toISOString().slice(0, 10);
  if (stats[key].date !== today) {
    stats[key] = fresh();
    writeJson(files[key], stats[key]);
  }
  return key;
}

function persist(kind) {
  const key = normalizeKind(kind);
  writeJson(files[key], stats[key]);
}

function canOpenTrade(kind = "LIVE") {
  const key = resetIfNewDay(kind);
  const prefix = key === "LIVE" ? "" : `${key}_`;
  const maxTrades = Number(process.env[`${prefix}MAX_TRADES_PER_DAY`] || process.env.MAX_TRADES_PER_DAY || 20);
  const maxLoss = Number(process.env[`${prefix}MAX_DAILY_LOSS_PERCENT`] || process.env.MAX_DAILY_LOSS_PERCENT || 5);
  const pauseUntil = stats[key].pauseUntil ? new Date(stats[key].pauseUntil).getTime() : 0;
  if (pauseUntil > Date.now()) {
    const minutes = Math.max(1, Math.ceil((pauseUntil - Date.now()) / 60000));
    return { allowed: false, reason: `${key} zarar serisi freni aktif (${minutes} dk kaldı)` };
  }
  if (pauseUntil && pauseUntil <= Date.now()) stats[key].pauseUntil = null;
  if (stats[key].tradesToday >= maxTrades) return { allowed: false, reason: `${key} günlük işlem limiti doldu (${maxTrades})` };
  if (stats[key].lossPercentToday >= maxLoss) return { allowed: false, reason: `${key} günlük zarar limiti doldu (%${maxLoss})` };
  return { allowed: true };
}

function registerTradeOpen(kind = "LIVE") {
  const key = resetIfNewDay(kind);
  stats[key].tradesToday += 1;
  persist(key);
}

function registerTradeClose(pnlPercent, kind = "LIVE") {
  const key = resetIfNewDay(kind);
  const pnl = Number(pnlPercent);
  if (pnl < 0) {
    stats[key].lossPercentToday += Math.abs(pnl);
    stats[key].consecutiveLosses = Number(stats[key].consecutiveLosses || 0) + 1;
    const maxStreak = Math.max(1, Number(process.env.MAX_CONSECUTIVE_LIVE_LOSSES || 2));
    if (key === "LIVE" && stats[key].consecutiveLosses >= maxStreak) {
      const pauseMinutes = Math.max(15, Number(process.env.LOSS_STREAK_PAUSE_MINUTES || 180));
      stats[key].pauseUntil = new Date(Date.now() + pauseMinutes * 60000).toISOString();
    }
  } else if (pnl > 0) {
    stats[key].consecutiveLosses = 0;
    stats[key].pauseUntil = null;
  }
  persist(key);
}

function getRiskStats() {
  for (const kind of KINDS) resetIfNewDay(kind);
  return { live: stats.LIVE, paper: stats.PAPER, testnet: stats.TESTNET };
}

module.exports = { canOpenTrade, registerTradeOpen, registerTradeClose, getRiskStats };
