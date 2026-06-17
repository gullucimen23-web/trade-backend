const axios = require("axios");
const crypto = require("crypto");

const SPOT_BASE_URL = "https://api.binance.com";

function sign(queryString) {
  return crypto
    .createHmac("sha256", process.env.BINANCE_SECRET_KEY)
    .update(queryString)
    .digest("hex");
}

async function privateGet(path, params = {}) {
  const timestamp = Date.now();

  const query = new URLSearchParams({
    ...params,
    timestamp,
  }).toString();

  const signature = sign(query);

  const url = `${SPOT_BASE_URL}${path}?${query}&signature=${signature}`;

  const res = await axios.get(url, {
    headers: {
      "X-MBX-APIKEY": process.env.BINANCE_API_KEY,
    },
  });

  return res.data;
}

async function getSpotAccount() {
  return privateGet("/api/v3/account");
}

module.exports = {
  getSpotAccount,
};