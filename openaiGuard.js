const OpenAI = require("openai");
const { sendTelegram } = require("./telegram");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let dailyCalls = 0;
let monthlyCalls = 0;
let lastDay = new Date().getDate();
let lastMonth = new Date().getMonth();
let lastLimitNoticeDay = null;

function resetCountersIfNeeded() {
  const now = new Date();

  if (now.getDate() !== lastDay) {
    dailyCalls = 0;
    lastDay = now.getDate();
    lastLimitNoticeDay = null;
  }

  if (now.getMonth() !== lastMonth) {
    monthlyCalls = 0;
    lastMonth = now.getMonth();
  }
}

function getOpenAIStats() {
  resetCountersIfNeeded();

  return {
    enabled: process.env.OPENAI_ENABLED === "true",
    mode: "optional_technical_analysis_continues",
    dailyCalls,
    monthlyCalls,
    dailyLimit: Number(process.env.OPENAI_DAILY_MAX_CALLS || 20),
    monthlyLimit: Number(process.env.OPENAI_MONTHLY_MAX_CALLS || 500),
  };
}

async function notifyLimitOnce(message) {
  const today = new Date().toISOString().slice(0, 10);
  if (lastLimitNoticeDay === today) return;
  lastLimitNoticeDay = today;
  try {
    await sendTelegram(message);
  } catch (err) {
    console.error("OpenAI limit bildirimi gönderilemedi:", err.message);
  }
}

async function askOpenAIWithGuard(marketData) {
  resetCountersIfNeeded();

  const enabled = process.env.OPENAI_ENABLED === "true";
  const dailyLimit = Number(process.env.OPENAI_DAILY_MAX_CALLS || 20);
  const monthlyLimit = Number(process.env.OPENAI_MONTHLY_MAX_CALLS || 500);

  if (!enabled || !process.env.OPENAI_API_KEY) {
    return {
      allowed: false,
      reason: "OpenAI kapalı veya API key yok. Bot teknik analizle devam ediyor.",
      decision: "SKIP",
      stats: getOpenAIStats(),
    };
  }

  if (dailyCalls >= dailyLimit) {
    await notifyLimitOnce("⚠️ OpenAI günlük limit doldu. Bot durmadı, teknik analiz modunda devam ediyor.");
    return {
      allowed: false,
      reason: "Günlük OpenAI limiti doldu. Teknik analiz devam ediyor.",
      decision: "SKIP",
      stats: getOpenAIStats(),
    };
  }

  if (monthlyCalls >= monthlyLimit) {
    await notifyLimitOnce("🚨 OpenAI aylık limit doldu. Bot durmadı, teknik analiz modunda devam ediyor.");
    return {
      allowed: false,
      reason: "Aylık OpenAI limiti doldu. Teknik analiz devam ediyor.",
      decision: "SKIP",
      stats: getOpenAIStats(),
    };
  }

  dailyCalls++;
  monthlyCalls++;

  const prompt = `
Sen kripto işlem risk analiz asistanısın.
Kesin yatırım tavsiyesi verme.
Sadece verilen teknik verilere göre risk skorunu yorumla.

Veri:
${JSON.stringify(marketData, null, 2)}

Cevabı sadece JSON ver:
{
  "confidence": 0-100,
  "risk": "LOW/MEDIUM/HIGH",
  "action": "ALLOW/WAIT/REJECT",
  "reason": "kısa açıklama"
}
`;

  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Sen kısa, disiplinli ve risk odaklı bir analiz asistanısın.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 250),
      temperature: 0.2,
    });

    const text = response.choices?.[0]?.message?.content || "";

    return {
      allowed: true,
      raw: text,
      stats: getOpenAIStats(),
    };
  } catch (err) {
    console.error("OpenAI hata:", err.message);

    return {
      allowed: false,
      reason: "OpenAI hata verdi. Bot teknik analizle devam ediyor.",
      error: err.message,
      decision: "SKIP",
      stats: getOpenAIStats(),
    };
  }
}

module.exports = {
  askOpenAIWithGuard,
  getOpenAIStats,
};
