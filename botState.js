const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "botState.json");

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { active: true };
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { active: parsed.active !== false };
  } catch (err) {
    console.error("Bot state okunamadı, aktif başlatılıyor:", err.message);
    return { active: true };
  }
}

function writeState(active) {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ active, updatedAt: new Date().toISOString() }, null, 2)
    );
  } catch (err) {
    console.error("Bot state yazılamadı:", err.message);
  }
}

let botActive = readState().active;

function isBotActive() {
  return botActive;
}

function startBot() {
  botActive = true;
  writeState(true);
}

function stopBot() {
  botActive = false;
  writeState(false);
}

module.exports = {
  isBotActive,
  startBot,
  stopBot,
};
