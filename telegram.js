const axios = require("axios");

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId || token.includes("BURAYA")) {
    console.log("Telegram ayarlı değil:", message);
    return false;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    });

    return true;
  } catch (err) {
    console.error("Telegram hata:", err.response?.data || err.message);
    return false;
  }
}

module.exports = { sendTelegram };