const axios = require("axios");

function isTradeOnlyAllowed(message) {
  if (process.env.TELEGRAM_TRADE_ONLY !== "true") return true;
  const text = String(message || "");
  return [
    "MEXC GERÇEK EMİR",
    "MEXC POZİSYON DURUMU",
    "MEXC TP1",
    "MEXC TP2",
    "MEXC TRAILING",
    "MEXC İŞLEM KAPANDI",
    "MEXC BAKİYE/KONTRAT UYUMSUZ",
    "MEXC canlı emir açılamadı",
    "Falix Trade Bot çalışıyor",
  ].some((marker) => text.includes(marker));
}

async function sendTelegram(message, chatIdOverride = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_TRADE_ONLY === "true"
    ? process.env.TELEGRAM_CHAT_ID
    : chatIdOverride || process.env.TELEGRAM_CHAT_ID;

  if (!isTradeOnlyAllowed(message)) return false;

  if (!token || !chatId || token.includes("BURAYA")) {
    console.log("Telegram ayarlı değil:", message);
    return false;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    return true;
  } catch (err) {
    console.error("Telegram hata:", err.response?.data || err.message);
    return false;
  }
}

async function sendTelegramWithButtons(message, buttons, chatIdOverride = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_TRADE_ONLY === "true"
    ? process.env.TELEGRAM_CHAT_ID
    : chatIdOverride || process.env.TELEGRAM_CHAT_ID;

  if (!isTradeOnlyAllowed(message)) return false;

  if (!token || !chatId || token.includes("BURAYA")) {
    console.log("Telegram butonlu mesaj ayarlı değil:", message);
    return false;
  }

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: buttons,
      },
    });

    return true;
  } catch (err) {
    console.error("Telegram buton hata:", err.response?.data || err.message);
    return false;
  }
}

async function answerCallbackQuery(callbackQueryId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token || token.includes("BURAYA")) return false;

  try {
    await axios.post(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false,
    });

    return true;
  } catch (err) {
    console.error("Callback cevap hata:", err.response?.data || err.message);
    return false;
  }
}

async function setTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const publicUrl = process.env.PUBLIC_URL;

  if (!token || !publicUrl) {
    throw new Error("TELEGRAM_BOT_TOKEN veya PUBLIC_URL eksik");
  }

  const webhookUrl = `${publicUrl}/telegram-webhook`;

  const res = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
    url: webhookUrl,
  });

  return res.data;
}

module.exports = {
  isTradeOnlyAllowed,
  sendTelegram,
  sendTelegramWithButtons,
  answerCallbackQuery,
  setTelegramWebhook,
};
