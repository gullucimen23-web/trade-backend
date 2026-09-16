const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = "https://api.mexc.com";
const LIVE_CONFIRMATION = "MEXC_REAL_MONEY";
let timeOffsetMs = 0;
const contractCache = new Map();

function assertReadConfigured() {
  if (process.env.MEXC_FUTURES_ENABLED !== "true") {
    throw new Error("MEXC_FUTURES_ENABLED=true değil");
  }
  if (!process.env.MEXC_API_KEY || !process.env.MEXC_SECRET_KEY) {
    throw new Error("MEXC API anahtarları eksik");
  }
}

function assertLiveConfigured() {
  assertReadConfigured();
  if (process.env.MEXC_LIVE_TRADING_ENABLED !== "true") {
    throw new Error("MEXC canlı işlem kilidi kapalı");
  }
  if (process.env.MEXC_LIVE_CONFIRM !== LIVE_CONFIRMATION) {
    throw new Error(`Canlı işlem onayı eksik: MEXC_LIVE_CONFIRM=${LIVE_CONFIRMATION}`);
  }
}

function normalizeSymbol(symbol) {
  const clean = String(symbol || "").toUpperCase().replace(/[^A-Z0-9_]/g, "");
  if (clean.includes("_")) return clean;
  if (!clean.endsWith("USDT")) throw new Error(`Desteklenmeyen MEXC sembolü: ${symbol}`);
  return `${clean.slice(0, -4)}_USDT`;
}

function signature(timestamp, parameterString) {
  return crypto
    .createHmac("sha256", process.env.MEXC_SECRET_KEY)
    .update(`${process.env.MEXC_API_KEY}${timestamp}${parameterString}`)
    .digest("hex");
}

function headers(timestamp, parameterString) {
  return {
    ApiKey: process.env.MEXC_API_KEY,
    "Request-Time": String(timestamp),
    Signature: signature(timestamp, parameterString),
    "Recv-Window": "10",
    Language: "English",
  };
}

function ensureSuccess(response) {
  if (!response || response.success !== true) {
    throw new Error(`MEXC Futures: ${response?.message || response?.msg || `kod ${response?.code}` || "bilinmeyen hata"}`);
  }
  return response.data;
}

async function syncTime() {
  const { data } = await axios.get(`${BASE_URL}/api/v1/contract/ping`, { timeout: 10000 });
  const serverTime = Number(ensureSuccess(data));
  timeOffsetMs = serverTime - Date.now();
  return serverTime;
}

async function privateGet(path, params = {}, retry = true) {
  assertReadConfigured();
  const entries = Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString();
  const timestamp = Date.now() + timeOffsetMs;

  try {
    const { data } = await axios.get(`${BASE_URL}${path}${query ? `?${query}` : ""}`, {
      headers: headers(timestamp, query),
      timeout: 15000,
    });
    return ensureSuccess(data);
  } catch (err) {
    if (retry && (err.response?.data?.code === 513 || /time|timestamp/i.test(err.message))) {
      await syncTime();
      return privateGet(path, params, false);
    }
    throw err;
  }
}

async function privatePost(path, payload = {}, retry = true) {
  assertReadConfigured();
  const cleanPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== null && value !== undefined)
  );
  const body = JSON.stringify(cleanPayload);
  const timestamp = Date.now() + timeOffsetMs;

  try {
    const { data } = await axios.post(`${BASE_URL}${path}`, body, {
      headers: { ...headers(timestamp, body), "Content-Type": "application/json" },
      timeout: 15000,
    });
    return ensureSuccess(data);
  } catch (err) {
    if (retry && (err.response?.data?.code === 513 || /time|timestamp/i.test(err.message))) {
      await syncTime();
      return privatePost(path, payload, false);
    }
    const detail = err.response?.data || err.message;
    throw new Error(`MEXC Futures: ${JSON.stringify(detail)}`);
  }
}

async function getContract(symbol) {
  const mexcSymbol = normalizeSymbol(symbol);
  const cached = contractCache.get(mexcSymbol);
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.data;
  const { data } = await axios.get(`${BASE_URL}/api/v1/contract/detail/country`, {
    params: { symbol: mexcSymbol },
    timeout: 15000,
  });
  const contract = ensureSuccess(data);
  if (!contract || contract.state !== 0 || contract.apiAllowed !== true) {
    throw new Error(`${mexcSymbol} MEXC API işlemlerine açık değil`);
  }
  contractCache.set(mexcSymbol, { at: Date.now(), data: contract });
  return contract;
}

async function getAssets() {
  return privateGet("/api/v1/private/account/assets");
}

async function getOpenPositions(symbol) {
  const params = symbol ? { symbol: normalizeSymbol(symbol) } : {};
  const positions = await privateGet("/api/v1/private/position/open_positions", params);
  return Array.isArray(positions) ? positions.filter((p) => Number(p.holdVol) > 0 && Number(p.state) !== 3) : [];
}

function floorToStep(value, step) {
  const stepText = String(step);
  const precision = stepText.includes(".") ? stepText.split(".")[1].length : 0;
  const result = Math.floor((Number(value) + Number.EPSILON) / Number(step)) * Number(step);
  return Number(result.toFixed(precision));
}

async function openLiveTrade({ symbol, side, currentPrice, stopLossPrice, takeProfitPrice }) {
  assertLiveConfigured();
  if (!["LONG", "SHORT"].includes(side)) throw new Error("Yön LONG veya SHORT olmalı");

  const mexcSymbol = normalizeSymbol(symbol);
  const [contract, existing] = await Promise.all([
    getContract(mexcSymbol),
    getOpenPositions(mexcSymbol),
  ]);
  if (existing.length > 0) throw new Error(`${mexcSymbol} için zaten açık MEXC pozisyonu var`);

  // Hard caps prevent a config typo from opening an unexpectedly large position.
  const leverage = Math.min(10, Math.max(Number(contract.minLeverage || 1), Number(process.env.MEXC_LEVERAGE || 3)));
  const marginUsdt = Math.min(25, Math.max(5, Number(process.env.MEXC_MARGIN_USDT || 10)));
  const notionalUsdt = marginUsdt * leverage;
  const rawContracts = notionalUsdt / (Number(currentPrice) * Number(contract.contractSize));
  const vol = floorToStep(rawContracts, contract.volUnit);
  if (vol < Number(contract.minVol) || vol > Number(contract.maxVol)) {
    throw new Error(`${mexcSymbol} kontrat miktarı sınır dışında: ${vol}`);
  }

  const result = await privatePost("/api/v1/private/order/create", {
    symbol: mexcSymbol,
    price: 0,
    vol,
    leverage,
    side: side === "LONG" ? 1 : 3,
    type: 5,
    openType: Number(process.env.MEXC_OPEN_TYPE || 1),
    positionMode: Number(process.env.MEXC_POSITION_MODE || 1),
    stopLossPrice: Number(stopLossPrice),
    takeProfitPrice: Number(takeProfitPrice),
    lossTrend: 2,
    profitTrend: 2,
    externalOid: `falix_${Date.now()}`,
  });

  return { result, symbol: mexcSymbol, side, vol, leverage, marginUsdt, live: true };
}

async function closeLivePosition(symbol) {
  assertLiveConfigured();
  const positions = await getOpenPositions(symbol);
  if (positions.length === 0) throw new Error("Açık MEXC pozisyonu yok");

  const results = [];
  for (const position of positions) {
    results.push(await privatePost("/api/v1/private/order/create", {
      symbol: position.symbol,
      price: 0,
      vol: Number(position.holdVol) - Number(position.frozenVol || 0),
      side: Number(position.positionType) === 1 ? 4 : 2,
      type: 5,
      openType: Number(position.openType),
      positionId: position.positionId,
      positionMode: Number(process.env.MEXC_POSITION_MODE || 1),
      externalOid: `falix_close_${Date.now()}`,
    }));
  }
  return results;
}

module.exports = {
  BASE_URL,
  LIVE_CONFIRMATION,
  normalizeSymbol,
  syncTime,
  getAssets,
  getOpenPositions,
  openLiveTrade,
  closeLivePosition,
};
