const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "risk-guard-test-"));
process.env.MAX_CONSECUTIVE_LIVE_LOSSES = "2";
process.env.LOSS_STREAK_PAUSE_MINUTES = "180";
process.env.MAX_DAILY_LOSS_PERCENT = "3";

// Eski marj/ROE metriğiyle yazılmış hatalı günlük kilit yeni sürümde sıfırlanmalı.
fs.writeFileSync(path.join(process.env.DATA_DIR, "live_stats.json"), JSON.stringify({
  date: new Date().toISOString().slice(0, 10),
  tradesToday: 1,
  lossPercentToday: 3.97,
  consecutiveLosses: 1,
  pauseUntil: null,
}));

const { canOpenTrade, registerTradeClose, getRiskStats } = require("./riskGuard");

assert.equal(canOpenTrade("LIVE").allowed, true);
registerTradeClose(-1, "LIVE");
assert.equal(canOpenTrade("LIVE").allowed, true, "İlk zarar tek başına botu durdurmamalı");
registerTradeClose(-1, "LIVE");
assert.equal(canOpenTrade("LIVE").allowed, false, "İki ardışık zarar sonrası yeni işlem durmalı");
assert.equal(getRiskStats().live.consecutiveLosses, 2);

console.log("riskGuard tests: OK");
