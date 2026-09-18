const assert = require("assert");
const { evaluateLiveCandidate } = require("./liveGate");

const envKeys = [
  "LIVE_ENTRY_MODE",
  "MEXC_AUTO_MIN_SCORE",
  "V8_MIN_VOLUME_RATIO",
  "MIN_ENTRY_VOLUME_RATIO",
  "EDGE_MIN_COST_MULTIPLE",
];
const original = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of envKeys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
}

try {
  process.env.LIVE_ENTRY_MODE = "LEGACY_V8";
  process.env.MEXC_AUTO_MIN_SCORE = "85";
  process.env.V8_MIN_VOLUME_RATIO = "0.45";

  const oldStyleSignal = {
    side: "SHORT",
    score: 98,
    confidence: 98,
    entryApproved: true,
    entryBlocked: false,
    volumeRatio: 0.76,
    adx: 19,
    atrPercent: 0.1,
    rsi: 31,
    move15mPercent: 0.2,
    ema21DistancePercent: 0.3,
    mtfSummary: { same1h: 13, opp1h: 66, same4h: 20, opp4h: 55 },
  };
  const plan = { riskReward: 1.84 };

  const legacy = evaluateLiveCandidate("ETHUSDT", oldStyleSignal, plan, { turnover: 10_000_000 });
  assert.equal(legacy.allowed, true, `Eski V8 sinyali engellendi: ${legacy.reasons.join(", ")}`);
  assert.equal(legacy.mode, "LEGACY_V8");

  process.env.LIVE_ENTRY_MODE = "STRICT";
  const strict = evaluateLiveCandidate("ETHUSDT", oldStyleSignal, plan, { turnover: 10_000_000 });
  assert.equal(strict.allowed, false, "Sıkı mod düşük ADX/hacim ve ters MTF sinyalini engellemeliydi");
  assert.equal(strict.mode, "STRICT");

  process.env.LIVE_ENTRY_MODE = "LEGACY_V8";
  const weak = evaluateLiveCandidate("ETHUSDT", { ...oldStyleSignal, score: 84 }, plan, { turnover: 10_000_000 });
  assert.equal(weak.allowed, false, "85 altındaki sinyal canlı emre geçmemeli");

  process.env.LIVE_ENTRY_MODE = "EDGE_V9";
  process.env.MEXC_AUTO_MIN_SCORE = "78";
  process.env.EDGE_MIN_COST_MULTIPLE = "3";
  const edgeSignal = {
    ...oldStyleSignal,
    mode: "EDGE_V9_COST_AWARE",
    score: 90,
    costEdgeRatio: 3.4,
    ema21DistancePercent: 0.4,
    mtfSummary: { mtfOk: true },
    entryTrigger: { triggerConfirmed: true },
  };
  const edge = evaluateLiveCandidate("BTCUSDT", edgeSignal, { ...plan, costEdgeRatio: 3.4 }, { turnover: 100_000_000 });
  assert.equal(edge.allowed, true, `Edge adayı engellendi: ${edge.reasons.join(", ")}`);
  assert.equal(edge.mode, "EDGE_V9");

  const noEdge = evaluateLiveCandidate("BTCUSDT", { ...edgeSignal, costEdgeRatio: 2.9 }, { ...plan, costEdgeRatio: 2.9 }, { turnover: 100_000_000 });
  assert.equal(noEdge.allowed, false, "Maliyet avantajı 3 katın altındaki işlem engellenmeliydi");

  console.log("liveGate tests passed");
} finally {
  restoreEnv();
}
