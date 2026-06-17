const TelegramBot = require("node-telegram-bot-api");
const {
  approveTrade,
  rejectTrade,
  getAllApprovals,
} = require("./approvalStore");
const { getOpenTrades } = require("./paperTrade");
const { getRiskStats } = require("./riskGuard");

function startTelegramCommands() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("Telegram komut sistemi kapalı.");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });

  bot.on("message", async (msg) => {
    const text = (msg.text || "").trim().toUpperCase();
    if (String(msg.chat.id) !== String(chatId)) return;

    if (text === "DURUM" || text === "/DURUM") {
      const openTrades = getOpenTrades();
      const risk = getRiskStats();

      return bot.sendMessage(chatId, `
📊 Bot Durumu

Açık işlem: ${openTrades.length}
Bugünkü işlem: ${risk.tradesToday}
Bugünkü zarar: %${risk.lossPercentToday}
Trading: ${process.env.TRADING_ENABLED === "true" ? "AKTİF" : "KAPALI"}
`);
    }

    if (text === "BEKLEYEN" || text === "/BEKLEYEN") {
      const approvals = getAllApprovals();

      if (!approvals.length) {
        return bot.sendMessage(chatId, "Bekleyen onay yok.");
      }

      return bot.sendMessage(
        chatId,
        approvals
          .map((a) => `${a.symbol} ${a.side} ${a.score}/100 - ${a.status}`)
          .join("\n")
      );
    }

    if (text.startsWith("ONAYLA ")) {
      const symbol = text.replace("ONAYLA ", "").trim();
      const approval = approveTrade(symbol);

      if (!approval) {
        return bot.sendMessage(chatId, `Onay bekleyen işlem yok: ${symbol}`);
      }

      return bot.sendMessage(chatId, `✅ Onaylandı: ${symbol} ${approval.side}`);
    }

    if (text.startsWith("RED ")) {
      const symbol = text.replace("RED ", "").trim();
      const approval = rejectTrade(symbol);

      if (!approval) {
        return bot.sendMessage(chatId, `Reddedilecek işlem yok: ${symbol}`);
      }

      return bot.sendMessage(chatId, `❌ Reddedildi: ${symbol}`);
    }
  });

  console.log("🤖 Telegram komut sistemi başlatıldı.");
}

module.exports = { startTelegramCommands };