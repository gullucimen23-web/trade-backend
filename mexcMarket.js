const axios = require("axios");
const { normalizeSymbol } = require("./mexcFutures");

const BASE_URL = "https://api.mexc.com";
const INTERVALS = {
  "1m": { mexc: "Min1", seconds: 60 },
  "5m": { mexc: "Min5", seconds: 300 },
  "15m": { mexc: "Min15", seconds: 900 },
  "30m": { mexc: "Min30", seconds: 1800 },
  "1h": { mexc: "Min60", seconds: 3600 },
  "4h": { mexc: "Hour4", seconds: 14400 },
  "8h": { mexc: "Hour8", seconds: 28800 },
  "1d": { mexc: "Day1", seconds: 86400 },
};
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

function scheduledGet(url, config) {
  const spacing = Math.max(110, Number(process.env.MEXC_PUBLIC_REQUEST_SPACING_MS || 130));
  const task = requestQueue.then(async () => {
    const wait = Math.max(0, spacing - (Date.now() - lastRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return axios.get(url, config);
  });
  requestQueue = task.catch(() => {});
  return task;
}

function ensureSuccess(response) {
  if (!response || response.success !== true) {
    throw new Error(`MEXC Market: ${response?.message || response?.msg || `kod ${response?.code}`}`);
  }
  return response.data;
}

async function getKlines(symbol = "BTCUSDT", interval = "5m", limit = 100) {
  const rule = INTERVALS[interval];
  if (!rule) throw new Error(`MEXC mum aralığı desteklenmiyor: ${interval}`);
  const mexcSymbol = normalizeSymbol(symbol);
  const safeLimit = Math.min(2000, Math.max(2, Number(limit || 100)));
  const end = Math.floor(Date.now() / 1000);
  const start = end - rule.seconds * (safeLimit + 5);
  const { data: response } = await scheduledGet(`${BASE_URL}/api/v1/contract/kline/${mexcSymbol}`, {
    params: { interval: rule.mexc, start, end },
    timeout: 15000,
  });
  const data = ensureSuccess(response);
  const count = Math.min(
    data?.time?.length || 0,
    data?.open?.length || 0,
    data?.high?.length || 0,
    data?.low?.length || 0,
    data?.close?.length || 0,
    data?.vol?.length || 0
  );
  if (count < 2) throw new Error(`${mexcSymbol} için yeterli MEXC mum verisi yok`);

  const candles = [];
  for (let i = 0; i < count; i += 1) {
    candles.push({
      openTime: Number(data.time[i]) * 1000,
      open: Number(data.open[i]),
      high: Number(data.high[i]),
      low: Number(data.low[i]),
      close: Number(data.close[i]),
      volume: Number(data.vol[i]),
      closeTime: (Number(data.time[i]) + rule.seconds) * 1000 - 1,
    });
  }
  // MEXC son dizide halen oluşan mumu da döndürebilir. Hacim ve sinyal
  // hesaplarında yalnızca kapanmış mumları kullanarak x0.01 gibi sahte oranları önle.
  const closedCandles = candles.filter((candle) => candle.closeTime <= Date.now() - 1500);
  if (closedCandles.length < 2) throw new Error(`${mexcSymbol} için yeterli kapanmış MEXC mumu yok`);
  return closedCandles.slice(-safeLimit);
}

async function getPrice(symbol = "BTCUSDT") {
  const mexcSymbol = normalizeSymbol(symbol);
  const { data: response } = await scheduledGet(`${BASE_URL}/api/v1/contract/ticker`, {
    params: { symbol: mexcSymbol },
    timeout: 15000,
  });
  const ticker = ensureSuccess(response);
  return { symbol: mexcSymbol, price: Number(ticker.lastPrice) };
}

module.exports = { getKlines, getPrice };
