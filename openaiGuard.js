const OpenAI = require("openai");
const { readJson, writeJson } = require("./dataStore");

let client = null;

function getClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

let stats = readJson("openaiStats.json", {
  dailyCalls: 0,
  monthlyCalls: 0,
  lastDay: new Date().getDate(),
  lastMonth: new Date().getMonth(),
  dailyLimitWarnedAt: null,
  monthlyLimitWarnedAt: null,
});

function persist() {
  writeJson("openaiStats.json", stats);
}

function resetCountersIfNeeded() {
  const now = new Date();
  let changed = false;

  if (now.getDate() !== stats.lastDay) {
    stats.dailyCalls = 0;
    stats.lastDay = now.getDate();
    stats.dailyLimitWarnedAt = null;
    changed = true;
  }

  if (now.getMonth() !== stats.lastMonth) {
    stats.monthlyCalls = 0;
    stats.lastMonth = now.getMonth();
    stats.monthlyLimitWarnedAt = null;
    changed = true;
  }

  if (changed) persist();
}

function getOpenAIStats() {
  resetCountersIfNeeded();

  return {
    enabled: process.env.OPENAI_ENABLED === "true",
    mode: "optional_technical_analysis_continues",
    dailyCalls: stats.dailyCalls,
    monthlyCalls: stats.monthlyCalls,
    dailyLimit: Number(process.env.OPENAI_DAILY_MAX_CALLS || 20),
    monthlyLimit: Number(process.env.OPENAI_MONTHLY_MAX_CALLS || 500),
  };
}

async function askOpenAIWithGuard(marketData) {
  resetCountersIfNeeded();

  const enabled = process.env.OPENAI_ENABLED === "true";
  const dailyLimit = Number(process.env.OPENAI_DAILY_MAX_CALLS || 20);
  const monthlyLimit = Number(process.env.OPENAI_MONTHLY_MAX_CALLS || 500);

  if (!enabled || !process.env.OPENAI_API_KEY) {
    return { allowed: false, reason: "OpenAI kapalı veya API key yok", decision: "SKIP" };
  }

  if (stats.dailyCalls >= dailyLimit) {
    return { allowed: false, reason: "Günlük OpenAI limiti doldu; teknik analiz devam ediyor", decision: "SKIP" };
  }

  if (stats.monthlyCalls >= monthlyLimit) {
    return { allowed: false, reason: "Aylık OpenAI limiti doldu; teknik analiz devam ediyor", decision: "SKIP" };
  }

  stats.dailyCalls += 1;
  stats.monthlyCalls += 1;
  persist();

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
    const openaiClient = getClient();
    if (!openaiClient) {
      return { allowed: false, reason: "OpenAI API key yok; teknik analiz devam ediyor", decision: "SKIP" };
    }

    const response = await openaiClient.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "Sen kısa, disiplinli ve risk odaklı bir analiz asistanısın." },
        { role: "user", content: prompt },
      ],
      max_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 250),
      temperature: 0.2,
    });

    const text = response.choices?.[0]?.message?.content || "";
    return { allowed: true, raw: text, stats: getOpenAIStats() };
  } catch (err) {
    console.error("OpenAI hata, bot teknik analizle devam ediyor:", err.message);
    return { allowed: false, reason: "OpenAI hata verdi; teknik analiz devam ediyor", error: err.message, decision: "SKIP" };
  }
}

module.exports = { askOpenAIWithGuard, getOpenAIStats };
