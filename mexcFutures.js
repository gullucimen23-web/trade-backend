const axios = require("axios");
const crypto = require("crypto");

const BASE_URL = "https://api.mexc.com";
const LIVE_CONFIRMATION = "MEXC_REAL_MONEY";
let timeOffsetMs = 0;
const contractCache = new Map();

function apiKey() {
  return String(process.env.MEXC_API_KEY || "").trim();
}

function secretKey() {
  return String(process.env.MEXC_SECRET_KEY || "").trim();
}

function assertReadConfigured() {
  if (process.env.MEXC_FUTURES_ENABLED !== "true") {
    throw new Error("MEXC_FUTURES_ENABLED=true değil");
  }
  if (!apiKey() || !secretKey()) {
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
    .createHmac("sha256", secretKey())
    .update(`${apiKey()}${timestamp}${parameterString}`)
    .digest("hex");
}

function headers(timestamp, parameterString) {
  return {
    ApiKey: apiKey(),
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

async function getUsdtAccountState() {
  const assets = await getAssets();
  const usdt = (Array.isArray(assets) ? assets : [assets]).find((asset) =>
    String(asset?.currency || asset?.asset || "").toUpperCase() === "USDT"
  );
  const available = Number(usdt?.availableBalance ?? usdt?.availableMargin ?? usdt?.available ?? 0);
  if (!Number.isFinite(available) || available <= 0) throw new Error("MEXC kullanılabilir USDT bakiyesi bulunamadı");
  const equity = Number(usdt?.equity ?? usdt?.accountEquity ?? usdt?.balance ?? usdt?.cashBalance ?? available);
  return { available, equity: Number.isFinite(equity) && equity > 0 ? equity : available };
}

async function getAvailableUsdtBalance() {
  return (await getUsdtAccountState()).available;
}

async function getOpenPositions(symbol) {
  const params = symbol ? { symbol: normalizeSymbol(symbol) } : {};
  const positions = await privateGet("/api/v1/private/position/open_positions", params);
  return Array.isArray(positions) ? positions.filter((p) => Number(p.holdVol) > 0 && Number(p.state) !== 3) : [];
}

async function getCurrentTpslOrders(symbol) {
  const orders = await privateGet("/api/v1/private/stoporder/open_orders", symbol ? { symbol: normalizeSymbol(symbol) } : {});
  return Array.isArray(orders) ? orders : [];
}

async function cancelPositionTpsl(position) {
  if (!position?.positionId) throw new Error("TP/SL iptali için positionId eksik");
  return privatePost("/api/v1/private/stoporder/cancel_all", {
    positionId: position.positionId,
    symbol: position.symbol,
  });
}

function floorToStep(value, step) {
  const stepText = String(step);
  const precision = stepText.includes(".") ? stepText.split(".")[1].length : 0;
  const result = Math.floor((Number(value) + Number.EPSILON) / Number(step)) * Number(step);
  return Number(result.toFixed(precision));
}

function ceilToStep(value, step) {
  const stepText = String(step);
  const precision = stepText.includes(".") ? stepText.split(".")[1].length : 0;
  const result = Math.ceil((Number(value) - Number.EPSILON) / Number(step)) * Number(step);
  return Number(result.toFixed(precision));
}

function normalizeProtectionPrices({ side, currentPrice, stopLossPrice, takeProfitPrice, priceUnit }) {
  const tick = Number(priceUnit);
  if (!Number.isFinite(tick) || tick <= 0) throw new Error("MEXC kontrat priceUnit geçersiz");
  const current = Number(currentPrice);
  const stop = side === "LONG" ? floorToStep(stopLossPrice, tick) : ceilToStep(stopLossPrice, tick);
  const take = side === "LONG" ? ceilToStep(takeProfitPrice, tick) : floorToStep(takeProfitPrice, tick);
  const valid = side === "LONG"
    ? stop < current && take > current
    : stop > current && take < current;
  if (!valid) {
    throw new Error(`MEXC koruma fiyatları yönle uyumsuz: fiyat=${current}, stop=${stop}, tp=${take}`);
  }
  return { stopLossPrice: stop, takeProfitPrice: take };
}

function normalizeStopPrice(positionType, stopLossPrice, priceUnit) {
  const tick = Number(priceUnit);
  if (!Number.isFinite(tick) || tick <= 0) throw new Error("MEXC kontrat priceUnit geçersiz");
  return Number(positionType) === 1
    ? floorToStep(stopLossPrice, tick)
    : ceilToStep(stopLossPrice, tick);
}

async function placePositionStop(position, stopLossPrice, requestedVol = null) {
  if (!position?.positionId || !position?.symbol) throw new Error("Stop kurulacak MEXC pozisyonu geçersiz");
  const contract = await getContract(position.symbol);
  const vol = floorToStep(Number(requestedVol ?? position.holdVol), contract.volUnit);
  if (vol < Number(contract.minVol)) throw new Error(`${position.symbol} stop miktarı minimumun altında`);
  const stop = normalizeStopPrice(position.positionType, stopLossPrice, contract.priceUnit);
  const triggerType = contract.stopOnlyFair === true
    ? 2
    : Math.min(3, Math.max(1, Number(process.env.MEXC_TRIGGER_PRICE_TYPE || 1)));
  const result = await privatePost("/api/v1/private/stoporder/place", {
    positionId: position.positionId,
    vol,
    stopLossPrice: stop,
    lossTrend: triggerType,
    profitTrend: triggerType,
    profitLossVolType: "SAME",
    volType: 2,
    stopLossType: 0,
    stopLossOrderPrice: 0,
  });
  return { result, stopLossPrice: stop, vol };
}

async function waitForPosition(positionId, symbol, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const rows = await getOpenPositions(symbol);
    const found = rows.find((row) => String(row.positionId) === String(positionId));
    if (found || i === attempts - 1) return found || null;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

async function waitForOpenedPosition(symbol, side, attempts = 20) {
  const wantedType = side === "LONG" ? 1 : 2;
  for (let i = 0; i < attempts; i += 1) {
    const rows = await getOpenPositions(symbol);
    const found = rows.find((row) => Number(row.positionType) === wantedType && Number(row.holdVol) > 0);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

async function waitForPositionChange(positionId, symbol, beforeVol, attempts = 10) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    const rows = await getOpenPositions(symbol);
    last = rows.find((row) => String(row.positionId) === String(positionId)) || null;
    if (!last || Number(last.holdVol) < Number(beforeVol)) return last;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`${symbol} piyasa kapanış emri zamanında doğrulanamadı`);
}

function calculateTieredMargin(account) {
  const threshold = Math.max(1, Number(process.env.MEXC_TIER_THRESHOLD_USDT || 50));
  const smallMargin = Math.max(1, Number(process.env.MEXC_SMALL_MARGIN_USDT || 10));
  const growthMargin = Math.max(1, Number(process.env.MEXC_GROWTH_MARGIN_USDT || 20));
  const reserve = account.equity >= threshold ? Math.max(0, Number(process.env.MEXC_MIN_RESERVE_USDT || 10)) : 0;
  const marginUsdt = account.equity >= threshold ? growthMargin : smallMargin;
  if (account.available - marginUsdt < reserve) {
    throw new Error(`Yeni işlem için bakiye/rezerv yetersiz. Kullanılabilir: ${account.available}, korunacak: ${reserve}`);
  }
  return { marginUsdt: Number(marginUsdt.toFixed(4)), reserveUsdt: reserve, threshold };
}

async function openLiveTrade({ symbol, side, currentPrice, stopLossPrice, takeProfitPrice }) {
  assertLiveConfigured();
  if (!["LONG", "SHORT"].includes(side)) throw new Error("Yön LONG veya SHORT olmalı");

  const mexcSymbol = normalizeSymbol(symbol);
  const [contract, existing, account] = await Promise.all([
    getContract(mexcSymbol),
    getOpenPositions(mexcSymbol),
    getUsdtAccountState(),
  ]);
  if (existing.length > 0) throw new Error(`${mexcSymbol} için zaten açık MEXC pozisyonu var`);

  // TIERED: 50 USDT altı 10 USDT; 50+ hesapta 20 USDT ve en az 10 USDT rezerv.
  const leverage = Math.min(10, Math.max(Number(contract.minLeverage || 1), Number(process.env.MEXC_LEVERAGE || 3)));
  const allocation = calculateTieredMargin(account);
  const marginUsdt = allocation.marginUsdt;
  const notionalUsdt = marginUsdt * leverage;
  const rawContracts = notionalUsdt / (Number(currentPrice) * Number(contract.contractSize));
  const vol = floorToStep(rawContracts, contract.volUnit);
  if (vol < Number(contract.minVol) || vol > Number(contract.maxVol)) {
    throw new Error(`${mexcSymbol} kontrat miktarı sınır dışında: ${vol}`);
  }

  const protection = normalizeProtectionPrices({
    side,
    currentPrice,
    stopLossPrice,
    takeProfitPrice,
    priceUnit: contract.priceUnit,
  });
  // MEXC bazı kontratlarda giriş emrine eklenen stop fiyatını, piyasa emri
  // gerçekleşene kadar değişen son fiyata göre reddedebiliyor. Önce yalnızca
  // piyasa girişini gerçekleştir; gerçek ortalama girişten sonra pozisyona stop kur.
  const result = await privatePost("/api/v1/private/order/create", {
    symbol: mexcSymbol,
    price: 0,
    vol,
    leverage,
    side: side === "LONG" ? 1 : 3,
    type: 5,
    openType: Number(process.env.MEXC_OPEN_TYPE || 1),
    positionMode: Number(process.env.MEXC_POSITION_MODE || 1),
    externalOid: `falix_${Date.now()}`,
  });

  const position = await waitForOpenedPosition(mexcSymbol, side);
  if (!position) {
    await privatePost("/api/v1/private/position/close_all", {}).catch(() => {});
    throw new Error(`${mexcSymbol} piyasa girişi pozisyon olarak doğrulanamadı; güvenlik kapatması gönderildi`);
  }

  const actualEntry = Number(position.holdAvgPrice || position.openAvgPrice || currentPrice);
  const requestedDistance = Math.abs((Number(currentPrice) - Number(stopLossPrice)) / Number(currentPrice)) * 100;
  const stopDistancePercent = Math.max(Number(process.env.MEXC_MIN_STOP_DISTANCE_PERCENT || 0.25), requestedDistance);
  const actualStopRaw = side === "LONG"
    ? actualEntry * (1 - stopDistancePercent / 100)
    : actualEntry * (1 + stopDistancePercent / 100);
  const actualStop = normalizeStopPrice(position.positionType, actualStopRaw, contract.priceUnit);

  let stopProtection;
  try {
    stopProtection = await placePositionStop(position, actualStop, Number(position.holdVol));
  } catch (stopErr) {
    let closeError = null;
    try {
      await closeLivePositionVolume(position, Number(position.holdVol));
    } catch (err) {
      closeError = err;
      await privatePost("/api/v1/private/position/close_all", {}).catch(() => {});
    }
    const extra = closeError ? `; normal kapatma hatası: ${closeError.message}` : "";
    throw new Error(`${mexcSymbol} koruyucu stop kurulamadı; pozisyon güvenlik için kapatıldı: ${stopErr.message}${extra}`);
  }

  return {
    result,
    symbol: mexcSymbol,
    side,
    vol,
    leverage,
    marginUsdt,
    availableUsdt: account.available,
    equityUsdt: account.equity,
    reserveUsdt: allocation.reserveUsdt,
    entryPrice: actualEntry,
    positionId: position.positionId,
    stopLossPrice: Number(stopProtection.stopLossPrice),
    takeProfitPrice: null,
    protectionOrderId: stopProtection.result,
    live: true,
  };
}

async function closeLivePosition(symbol) {
  assertLiveConfigured();
  const positions = await getOpenPositions(symbol);
  if (positions.length === 0) throw new Error("Açık MEXC pozisyonu yok");

  const results = [];
  for (const position of positions) {
    results.push(await closeLivePositionVolume(position, Number(position.holdVol)));
  }
  return results;
}

async function closeLivePositionVolume(position, requestedVol, options = {}) {
  assertLiveConfigured();
  if (!position?.positionId || !position?.symbol) throw new Error("Kapatılacak MEXC pozisyonu geçersiz");
  const contract = await getContract(position.symbol);
  const originalHold = Math.max(0, Number(position.holdVol));
  let vol = floorToStep(Math.min(originalHold, Number(requestedVol)), contract.volUnit);
  if (vol < Number(contract.minVol) && originalHold >= Number(contract.minVol)) {
    vol = floorToStep(originalHold, contract.volUnit);
  }
  if (vol < Number(contract.minVol)) throw new Error(`${position.symbol} kısmi kapatma miktarı minimumun altında`);

  const tpslOrders = await getCurrentTpslOrders(position.symbol).catch(() => []);
  const currentStop = tpslOrders.find((order) => String(order.positionId) === String(position.positionId) && Number(order.stopLossPrice) > 0);
  const fallbackStop = Number(options.restoreStopLossPrice || currentStop?.stopLossPrice || 0);
  await cancelPositionTpsl(position);

  let result;
  try {
    const refreshed = await waitForPosition(position.positionId, position.symbol, 3) || position;
    result = await privatePost("/api/v1/private/order/create", {
      symbol: refreshed.symbol,
      price: 0,
      vol,
      side: Number(refreshed.positionType) === 1 ? 4 : 2,
      type: 5,
      openType: Number(refreshed.openType),
      positionId: refreshed.positionId,
      positionMode: Number(process.env.MEXC_POSITION_MODE || 1),
      externalOid: `falix_partial_${Date.now()}`,
    });
  } catch (err) {
    const stillOpen = await waitForPosition(position.positionId, position.symbol, 3).catch(() => null);
    if (stillOpen && fallbackStop > 0) {
      await placePositionStop(stillOpen, fallbackStop).catch(() => {});
    }
    throw err;
  }

  const remaining = await waitForPositionChange(position.positionId, position.symbol, originalHold, 10);
  const fullyClosed = !remaining || Number(remaining.holdVol) <= 0;
  let protection = null;
  if (!fullyClosed) {
    const nextStop = Number(options.nextStopLossPrice || fallbackStop);
    if (!nextStop) throw new Error(`${position.symbol} kısmi kapanış sonrası kurulacak stop bulunamadı`);
    protection = await placePositionStop(remaining, nextStop, Number(remaining.holdVol));
  }
  return { result, vol, symbol: position.symbol, fullyClosed, remainingVol: Number(remaining?.holdVol || 0), protection };
}

function getConfigDiagnostics() {
  const rawApiKey = String(process.env.MEXC_API_KEY || "");
  const rawSecretKey = String(process.env.MEXC_SECRET_KEY || "");
  return {
    apiKeyConfigured: apiKey().length > 0,
    secretKeyConfigured: secretKey().length > 0,
    apiKeyLength: apiKey().length,
    secretKeyLength: secretKey().length,
    apiKeyHadOuterWhitespace: rawApiKey !== rawApiKey.trim(),
    secretKeyHadOuterWhitespace: rawSecretKey !== rawSecretKey.trim(),
  };
}

module.exports = {
  BASE_URL,
  LIVE_CONFIRMATION,
  normalizeSymbol,
  normalizeProtectionPrices,
  calculateTieredMargin,
  syncTime,
  getAssets,
  getUsdtAccountState,
  getAvailableUsdtBalance,
  getOpenPositions,
  getCurrentTpslOrders,
  cancelPositionTpsl,
  placePositionStop,
  openLiveTrade,
  closeLivePosition,
  closeLivePositionVolume,
  getConfigDiagnostics,
};
