const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(name) {
  ensureDataDir();
  return path.join(DATA_DIR, name);
}

function readJson(name, fallback) {
  try {
    const fp = filePath(name);
    if (!fs.existsSync(fp)) return fallback;
    const raw = fs.readFileSync(fp, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error(`JSON okuma hatası (${name}):`, err.message);
    return fallback;
  }
}

function writeJson(name, data) {
  try {
    const fp = filePath(name);
    const tmp = `${fp}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, fp);
    return true;
  } catch (err) {
    console.error(`JSON yazma hatası (${name}):`, err.message);
    return false;
  }
}

module.exports = { DATA_DIR, readJson, writeJson, ensureDataDir };
