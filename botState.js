const { readJson, writeJson } = require("./dataStore");

let state = readJson("botState.json", {
  active: true,
  updatedAt: new Date().toISOString(),
});

function persist() {
  state.updatedAt = new Date().toISOString();
  writeJson("botState.json", state);
}

function isBotActive() {
  return state.active !== false;
}

function startBot() {
  state.active = true;
  persist();
}

function stopBot() {
  state.active = false;
  persist();
}

function getBotState() {
  return { ...state, active: isBotActive() };
}

module.exports = {
  isBotActive,
  startBot,
  stopBot,
  getBotState,
};
