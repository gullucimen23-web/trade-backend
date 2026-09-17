const assert = require("assert");
const { evaluateProfitDefense } = require("./mexcPositionManager");

const base = {
  marginUsdt: 10,
  leverage: 5,
  createdAt: new Date(Date.now() - 10 * 60000).toISOString(),
  tp1Done: false,
};

let result = evaluateProfitDefense(base, { percent: 0.10, usdt: 0.05 });
assert.equal(result.action, null, "Küçük/komisyonluk harekette çıkmamalı");

result = evaluateProfitDefense({ ...base, bestPnlPercent: 0.35, profitGuardArmed: true }, { percent: 0.20, usdt: 0.10 });
assert.equal(result.action, "PROFIT_GUARD_EXIT", "Kârın önemli bölümü geri verilince net pozitif çıkmalı");

result = evaluateProfitDefense({ ...base, createdAt: new Date(Date.now() - 100 * 60000).toISOString() }, { percent: 0.02, usdt: 0.01 });
assert.equal(result.action, "TIME_FLAT_EXIT", "Süresi dolan başa baş işlem sermayeyi kilitlememeli");

result = evaluateProfitDefense({ ...base, tp1Done: true, createdAt: new Date(Date.now() - 100 * 60000).toISOString() }, { percent: 0.02, usdt: 0.01 });
assert.equal(result.action, null, "TP1 sonrası mevcut trailing yönetimi çalışmalı");

console.log("profitDefense tests: OK");
