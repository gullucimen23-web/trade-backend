const axios = require("axios");

const BASE_URL = "https://api.mexc.com";
let cache = { at: 0, symbols: [], meta: {} };

function unwrap(response) {
  if (!response || response.success !== true) {
    throw new Error(`MEXC evreni: ${response?.message || response?.msg || response?.code || "bilinmeyen hata"}`);
  }
  return response.data;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function scannerSymbol(mexcSymbol) {
  return String(mexcSymbol || "").replace("_", "").toUpperCase();
}

function buildUniverse(contracts, tickers, options = {}) {
  const size = Math.max(3, Math.min(100, Number(options.size || 50)));
  const minTurnover = Math.max(0, Number(options.minTurnover || 2000000));
  const excludes = new Set((options.excludes || []).map((x) => String(x).toUpperCase()));
  const tickerMap = new Map(asArray(tickers).map((t) => [String(t.symbol).toUpperCase(), t]));

  const rows = asArray(contracts).filter((c) => {
    const symbol = String(c.symbol || "").toUpperCase();
    if (!symbol.endsWith("_USDT") || excludes.has(scannerSymbol(symbol))) return false;
    if (Number(c.state) !== 0 || c.apiAllowed === false || c.isHidden === true) return false;
    if (c.isNew === true || c.preMarket === true) return false;
    return true;
  }).map((contract) => {
    const ticker = tickerMap.get(String(contract.symbol).toUpperCase()) || {};
    const turnover = Number(ticker.amount24 || ticker.amount24h || 0);
    return {
      symbol: scannerSymbol(contract.symbol),
      mexcSymbol: contract.symbol,
      turnover,
      lastPrice: Number(ticker.lastPrice || 0),
    };
  }).filter((row) => row.lastPrice > 0 && row.turnover >= minTurnover)
    .sort((a, b) => b.turnover - a.turnover)
    .slice(0, size);

  return rows;
}

async function getTradingUniverse() {
  const refreshMs = Math.max(1, Number(process.env.UNIVERSE_REFRESH_MINUTES || 10)) * 60 * 1000;
  if (cache.symbols.length && Date.now() - cache.at < refreshMs) return cache;

  const excludes = String(process.env.UNIVERSE_EXCLUDE || "USDCUSDT,USDEUSDT,DAIUSDT")
    .split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const [contractResponse, tickerResponse] = await Promise.all([
    axios.get(`${BASE_URL}/api/v1/contract/detail/country`, { timeout: 15000 }),
    axios.get(`${BASE_URL}/api/v1/contract/ticker`, { timeout: 15000 }),
  ]);
  const rows = buildUniverse(
    unwrap(contractResponse.data),
    unwrap(tickerResponse.data),
    {
      size: process.env.UNIVERSE_SIZE || 50,
      minTurnover: process.env.MIN_24H_TURNOVER_USDT || 2000000,
      excludes,
    }
  );
  if (!rows.length) throw new Error("Likidite filtresinden geçen MEXC kontratı bulunamadı");
  cache = {
    at: Date.now(),
    symbols: rows.map((row) => row.symbol),
    meta: Object.fromEntries(rows.map((row) => [row.symbol, row])),
  };
  return cache;
}

module.exports = { buildUniverse, getTradingUniverse };
