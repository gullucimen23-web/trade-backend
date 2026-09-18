const assert = require("assert");
const { calculateRiskBasedMargin } = require("./mexcFutures");
const { strongDirection } = require("./edgeStrategy");
const { buildPerformanceAudit } = require("./performanceAudit");

const keys = ["RISK_PER_TRADE_PERCENT", "MEXC_TIER_THRESHOLD_USDT", "MEXC_SMALL_MARGIN_USDT", "MEXC_GROWTH_MARGIN_USDT", "MEXC_MIN_RESERVE_USDT"];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

try {
  process.env.RISK_PER_TRADE_PERCENT = "0.75";
  process.env.MEXC_TIER_THRESHOLD_USDT = "50";
  process.env.MEXC_SMALL_MARGIN_USDT = "10";
  process.env.MEXC_GROWTH_MARGIN_USDT = "20";
  process.env.MEXC_MIN_RESERVE_USDT = "10";

  const small = calculateRiskBasedMargin({ equity: 22, available: 22 }, 0.6, 5);
  assert.equal(small.marginUsdt, 5.5);
  assert.equal(small.riskBudgetUsdt, 0.165);
  assert.equal(small.estimatedRiskUsdt, 0.165);

  const larger = calculateRiskBasedMargin({ equity: 100, available: 100 }, 0.6, 5);
  assert.equal(larger.marginUsdt, 20, "Büyük hesap tier üst sınırını aşmamalı");
  assert.equal(larger.reserveUsdt, 10);

  assert.equal(strongDirection({ lastClose: 110, ema9: 108, ema21: 106, trendEma: 105, ema200: 100, adx: 24, pdi: 30, mdi: 15 }), "LONG");
  assert.equal(strongDirection({ lastClose: 90, ema9: 92, ema21: 94, trendEma: 95, ema200: 100, adx: 24, pdi: 15, mdi: 30 }), "SHORT");
  assert.equal(strongDirection({ lastClose: 110, ema9: 108, ema21: 106, trendEma: 105, ema200: 100, adx: 12, pdi: 30, mdi: 15 }), "NONE");

  const winners = Array.from({ length: 100 }, (_, i) => ({
    status: "CLOSED_TP",
    leverage: 3,
    pnlPercent: i % 3 === 0 ? -1 : 2,
    signalSnapshot: { mode: "EDGE_V9_COST_AWARE", estimatedCostPercent: 0.2 },
  }));
  const audit = buildPerformanceAudit(winners);
  assert.equal(audit.closedTrades, 100);
  assert.equal(audit.liveEvidenceReady, true);

  console.log("edge risk tests passed");
} finally {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
}
