const axios = require("axios");

const BASE_URL = "https://api.binance.com";

async function getKlines(symbol = "BTCUSDT", interval = "5m", limit = 100) {
  const url = `${BASE_URL}/api/v3/klines`;

  const res = await axios.get(url, {
    params: { symbol, interval, limit },
  });

  return res.data.map((candle) => ({
    openTime: candle[0],
    open: Number(candle[1]),
    high: Number(candle[2]),
    low: Number(candle[3]),
    close: Number(candle[4]),
    volume: Number(candle[5]),
    closeTime: candle[6],
  }));
}

async function getPrice(symbol = "BTCUSDT") {
  const url = `${BASE_URL}/api/v3/ticker/price`;
  const res = await axios.get(url, { params: { symbol } });

  return {
    symbol,
    price: Number(res.data.price),
  };
}

module.exports = {
  getKlines,
  getPrice,
};