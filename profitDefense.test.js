const assert = require("assert");
const { evaluateProfitDefense, dollarStage } = require("./mexcPositionManager");

const base = {
  marginUsdt: 10,
  leverage: 5,
  createdAt: new Date(Date.now() - 10 * 60000).toISOString(),
  tp1Done: false,
};

let result = evaluateProfitDefense(base, { percent: 0.10, usdt: 0.05 });
assert.equal(result.action, null, "Küçük/komisyonluk harekette çıkmamalı");

result = evaluateProfitDefense({ ...base, bestPnlPercent: 0.70, bestPnlUsdt: 0.35, profitGuardArmed: true }, { percent: 0.40, usdt: 0.20 });
assert.equal(result.action, "PROFIT_GUARD_EXIT", "Kârın önemli bölümü geri verilince net pozitif çıkmalı");

result = evaluateProfitDefense({ ...base, createdAt: new Date(Date.now() - 100 * 60000).toISOString() }, { percent: 0.02, usdt: 0.01 });
assert.equal(result.action, "TIME_FLAT_EXIT", "Süresi dolan başa baş işlem sermayeyi kilitlememeli");

result = evaluateProfitDefense({ ...base, tp1Done: true, createdAt: new Date(Date.now() - 100 * 60000).toISOString() }, { percent: 0.02, usdt: 0.01 });
assert.equal(result.action, null, "TP1 sonrası mevcut trailing yönetimi çalışmalı");

assert.equal(dollarStage(base, { percent: 0.9, usdt: 0.45 }), null);
assert.equal(dollarStage(base, { percent: 1.0, usdt: 0.50 }), "TP1");
assert.equal(dollarStage({ ...base, tp1Done: true }, { percent: 2.0, usdt: 0.50 }), "TP2");
assert.equal(dollarStage({ ...base, tp1Done: true, tp2Done: true }, { percent: 4.0, usdt: 0.40 }), "FINAL");

console.log("profitDefense tests: OK");
