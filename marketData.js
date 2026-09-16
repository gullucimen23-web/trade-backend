const binance = require("./binance");
const mexc = require("./mexcMarket");

function provider() {
  const source = String(process.env.MARKET_DATA_SOURCE || process.env.EXECUTION_EXCHANGE || "BINANCE").toUpperCase();
  return source === "MEXC" ? mexc : binance;
}

function getKlines(...args) {
  return provider().getKlines(...args);
}

function getPrice(...args) {
  return provider().getPrice(...args);
}

function getMarketDataSource() {
  return provider() === mexc ? "MEXC" : "BINANCE";
}

module.exports = { getKlines, getPrice, getMarketDataSource };
