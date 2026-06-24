let botActive = true;
function isBotActive() { return botActive; }
function startBot() { botActive = true; return botActive; }
function stopBot() { botActive = false; return botActive; }
module.exports = { isBotActive, startBot, stopBot };
