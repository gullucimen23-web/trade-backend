const assert = require("assert");
const { buildUniverse, isSyntheticNonCrypto } = require("./mexcUniverse");

assert.equal(isSyntheticNonCrypto("OILBRENTUSDT"), true);
assert.equal(isSyntheticNonCrypto("XAUUSDT"), true);
assert.equal(isSyntheticNonCrypto("SNDKSTOCKUSDT"), true);
assert.equal(isSyntheticNonCrypto("BTCUSDT"), false);

const contracts = [
  { symbol: "BTC_USDT", state: 0, apiAllowed: true, contractSize: 0.001, minVol: 1, volUnit: 1 },
  { symbol: "OILBRENT_USDT", state: 0, apiAllowed: true, contractSize: 1, minVol: 1, volUnit: 1 },
];
const tickers = [
  { symbol: "BTC_USDT", amount24: 10000000, lastPrice: 100000 },
  { symbol: "OILBRENT_USDT", amount24: 20000000, lastPrice: 100 },
];
const rows = buildUniverse(contracts, tickers, { size: 20, minTurnover: 1, cryptoOnly: true });
assert.deepEqual(rows.map((row) => row.symbol), ["BTCUSDT"]);

console.log("universe tests: OK");
