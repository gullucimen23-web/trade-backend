const axios = require("axios");
const crypto = require("crypto");

// Safety lock: this module can only talk to Binance USD-M Futures Testnet.
const BASE_URL = "https://demo-fapi.binance.com";
let timeOffsetMs = 0;
let exchangeInfoCache = null;
let exchangeInfoCachedAt = 0;

function assertConfigured() {
  if (process.env.FUTURES_TESTNET_ENABLED !== "true") {
    throw new Error("FUTURES_TESTNET_ENABLED=true değil");
  }
  if (!process.env.BINANCE_TESTNET_API_KEY || !process.env.BINANCE_TESTNET_SECRET_KEY) {
    throw new Error("Binance Futures Testnet API anahtarları eksik");
  }
}

function sign(queryString) {
  return crypto
    .createHmac("sha256", process.env.BINANCE_TESTNET_SECRET_KEY)
    .update(queryString)
    .digest("hex");
}

async function syncTime() {
  const { data } = await axios.get(`${BASE_URL}/fapi/v1/time`, { timeout: 10000 });
  timeOffsetMs = Number(data.serverTime) - Date.now();
  return data.serverTime;
}

async function signedRequest(method, path, params = {}, retry = true) {
  assertConfigured();
  const payload = {
    ...params,
    timestamp: Date.now() + timeOffsetMs,
    recvWindow: 5000,
  };
  const query = new URLSearchParams(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null)
  ).toString();
  const signature = sign(query);

  try {
    const { data } = await axios({
      method,
      url: `${BASE_URL}${path}?${query}&signature=${signature}`,
      headers: { "X-MBX-APIKEY": process.env.BINANCE_TESTNET_API_KEY },
      timeout: 15000,
    });
    return data;
  } catch (err) {
    const code = err.response?.data?.code;
    if (retry && code === -1021) {
      await syncTime();
      return signedRequest(method, path, params, false);
    }
    const detail = err.response?.data || err.message;
    throw new Error(`Binance Futures Testnet: ${JSON.stringify(detail)}`);
  }
}

async function publicGet(path, params = {}) {
  const { data } = await axios.get(`${BASE_URL}${path}`, { params, timeout: 15000 });
  return data;
}

async function getExchangeInfo() {
  if (exchangeInfoCache && Date.now() - exchangeInfoCachedAt < 60 * 60 * 1000) {
    return exchangeInfoCache;
  }
  exchangeInfoCache = await publicGet("/fapi/v1/exchangeInfo");
  exchangeInfoCachedAt = Date.now();
  return exchangeInfoCache;
}

function decimals(step) {
  const normalized = Number(step).toString();
  return normalized.includes(".") ? normalized.split(".")[1].length : 0;
}

function floorToStep(value, step) {
  const precision = decimals(step);
  const result = Math.floor((Number(value) + Number.EPSILON) / Number(step)) * Number(step);
  return result.toFixed(precision);
}

function roundToTick(value, tickSize) {
  const precision = decimals(tickSize);
  const result = Math.round(Number(value) / Number(tickSize)) * Number(tickSize);
  return result.toFixed(precision);
}

async function getSymbolRules(symbol) {
  const info = await getExchangeInfo();
  const item = info.symbols.find((row) => row.symbol === symbol);
  if (!item || item.status !== "TRADING") throw new Error(`${symbol} testnette işleme açık değil`);

  const lot = item.filters.find((f) => f.filterType === "MARKET_LOT_SIZE")
    || item.filters.find((f) => f.filterType === "LOT_SIZE");
  const price = item.filters.find((f) => f.filterType === "PRICE_FILTER");
  if (!lot || !price) throw new Error(`${symbol} miktar/fiyat kuralları bulunamadı`);

  return {
    minQty: Number(lot.minQty),
    maxQty: Number(lot.maxQty),
    stepSize: lot.stepSize,
    tickSize: price.tickSize,
  };
}

async function getAccount() {
  return signedRequest("GET", "/fapi/v2/account");
}

async function getOpenPosition(symbol) {
  const rows = await signedRequest("GET", "/fapi/v2/positionRisk", { symbol });
  return rows.find((row) => row.symbol === symbol && Math.abs(Number(row.positionAmt)) > 0) || null;
}

async function setLeverage(symbol, leverage) {
  return signedRequest("POST", "/fapi/v1/leverage", { symbol, leverage });
}

async function cancelOpenOrders(symbol) {
  const results = await Promise.allSettled([
    signedRequest("DELETE", "/fapi/v1/allOpenOrders", { symbol }),
    signedRequest("DELETE", "/fapi/v1/algoOpenOrders", { symbol }),
  ]);
  return results;
}

async function placeOrder(params) {
  return signedRequest("POST", "/fapi/v1/order", params);
}

async function placeConditionalOrder(params) {
  return signedRequest("POST", "/fapi/v1/algoOrder", {
    algoType: "CONDITIONAL",
    ...params,
  });
}

async function closePositionAtMarket(symbol, side) {
  const position = await getOpenPosition(symbol);
  if (!position) return null;
  const quantity = Math.abs(Number(position.positionAmt));
  return placeOrder({
    symbol,
    side: side === "LONG" ? "SELL" : "BUY",
    type: "MARKET",
    quantity,
    reduceOnly: "true",
    newOrderRespType: "RESULT",
  });
}

async function openTestnetTrade({ symbol, side, currentPrice, stopLossPrice, takeProfitPrice }) {
  assertConfigured();
  if (!['LONG', 'SHORT'].includes(side)) throw new Error("Yön LONG veya SHORT olmalı");

  const existing = await getOpenPosition(symbol);
  if (existing) throw new Error(`${symbol} için testnette zaten açık pozisyon var`);

  const leverage = Math.min(20, Math.max(1, Number(process.env.TESTNET_LEVERAGE || 3)));
  const marginUsdt = Math.max(5, Number(process.env.TESTNET_MARGIN_USDT || 10));
  const rules = await getSymbolRules(symbol);
  const rawQty = (marginUsdt * leverage) / Number(currentPrice);
  const quantity = floorToStep(rawQty, rules.stepSize);

  if (Number(quantity) < rules.minQty || Number(quantity) > rules.maxQty) {
    throw new Error(`${symbol} miktarı borsa sınırına uymuyor: ${quantity}`);
  }

  await setLeverage(symbol, leverage);
  const orderSide = side === "LONG" ? "BUY" : "SELL";
  const exitSide = side === "LONG" ? "SELL" : "BUY";
  const entry = await placeOrder({
    symbol,
    side: orderSide,
    type: "MARKET",
    quantity,
    newOrderRespType: "RESULT",
  });

  try {
    const stop = await placeConditionalOrder({
      symbol,
      side: exitSide,
      type: "STOP_MARKET",
      triggerPrice: roundToTick(stopLossPrice, rules.tickSize),
      closePosition: "true",
      workingType: "MARK_PRICE",
    });
    const takeProfit = await placeConditionalOrder({
      symbol,
      side: exitSide,
      type: "TAKE_PROFIT_MARKET",
      triggerPrice: roundToTick(takeProfitPrice, rules.tickSize),
      closePosition: "true",
      workingType: "MARK_PRICE",
    });
    return { entry, stop, takeProfit, symbol, side, quantity, leverage, marginUsdt };
  } catch (err) {
    // Never leave a naked testnet position if protection creation fails.
    await cancelOpenOrders(symbol).catch(() => {});
    await closePositionAtMarket(symbol, side).catch(() => {});
    throw new Error(`Koruma emri kurulamadı; test pozisyonu kapatıldı. ${err.message}`);
  }
}

module.exports = {
  BASE_URL,
  syncTime,
  getAccount,
  getOpenPosition,
  openTestnetTrade,
  cancelOpenOrders,
  closePositionAtMarket,
};
