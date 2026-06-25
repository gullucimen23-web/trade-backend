function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, d = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(d));
}

function getCandidateSide(signal) {
  if (!signal) return "NONE";
  if (signal.side && signal.side !== "NONE") return signal.side;
  return toNum(signal.longScore) >= toNum(signal.shortScore) ? "LONG" : "SHORT";
}

function getDirectionScore(signal, side) {
  if (!signal) return 0;
  return side === "LONG" ? toNum(signal.longScore) : toNum(signal.shortScore);
}

function getOppositeScore(signal, side) {
  if (!signal) return 0;
  return side === "LONG" ? toNum(signal.shortScore) : toNum(signal.longScore);
}

function estimateSignalWindow(readiness, signal) {
  const vol = toNum(signal?.volumeRatio, 0);
  if (signal?.entryApproved) return "ŞİMDİ / ONAYLI";
  if (readiness >= 85 && vol >= 0.75) return "5-15 dk";
  if (readiness >= 72) return "15-45 dk";
  if (readiness >= 60) return "45-120 dk";
  return "Belirsiz";
}

function buildNextCondition(signal, side) {
  if (!signal || side === "NONE") return "Net yön oluşması bekleniyor.";
  if (side === "LONG") {
    if (!signal.breakoutConfirmed) return `${signal.resistance} üstü hacimli 5m kapanış bekleniyor.`;
    return "Long yönü onaylı; risk filtreleri kontrol ediliyor.";
  }
  if (!signal.breakdownConfirmed) return `${signal.support} altı hacimli 5m kapanış bekleniyor.`;
  return "Short yönü onaylı; risk filtreleri kontrol ediliyor.";
}

function scoreOpportunity(signal) {
  if (!signal) return null;
  const side = getCandidateSide(signal);
  if (side === "NONE") {
    return {
      side,
      readiness: 0,
      quality: "BEKLE",
      window: "Belirsiz",
      reason: "Net yön yok",
      next: "Net yön oluşması bekleniyor.",
    };
  }

  const base = getDirectionScore(signal, side);
  const opposite = getOppositeScore(signal, side);
  const directionGap = Math.max(0, base - opposite);
  const confidence = toNum(signal.confidence, signal.score);
  const vol = toNum(signal.volumeRatio, 0);
  const regimeAllows = signal.marketRegime?.allowEntry !== false;
  const blocked = signal.entryBlocked === true || signal.entryApproved === false;

  let readiness = 0;
  readiness += Math.min(45, base * 0.45);
  readiness += Math.min(20, directionGap * 0.35);
  readiness += Math.min(15, confidence * 0.15);
  readiness += Math.min(15, vol * 10);
  if (signal.entryApproved) readiness += 18;
  if (signal.breakoutConfirmed || signal.breakdownConfirmed) readiness += 10;
  if (!regimeAllows) readiness -= 18;
  if (blocked) readiness -= 8;
  if (vol < 0.55) readiness -= 18;
  if (vol < 0.25) readiness -= 10;
  readiness = Math.max(0, Math.min(100, Math.round(readiness)));

  let quality = "BEKLE";
  if (signal.entryApproved && readiness >= 88) quality = "ONAYLI SİNYAL";
  else if (readiness >= 78) quality = "ÇOK YAKIN";
  else if (readiness >= 65) quality = "HAZIRLIK";
  else if (readiness >= 50) quality = "İZLEME";

  const blockers = Array.isArray(signal.filters) ? signal.filters.slice(0, 2).join(" | ") : "";
  const next = buildNextCondition(signal, side);

  return {
    side,
    readiness,
    quality,
    window: estimateSignalWindow(readiness, signal),
    technicalScore: toNum(signal.score),
    confidence: toNum(signal.confidence, signal.score),
    longScore: toNum(signal.longScore),
    shortScore: toNum(signal.shortScore),
    volumeRatio: round(vol, 2),
    price: signal.lastClose,
    resistance: signal.resistance,
    support: signal.support,
    entryApproved: !!signal.entryApproved,
    entryBlocked: !!signal.entryBlocked,
    marketRegime: signal.marketRegime?.label || "-",
    next,
    blockers,
    reason: signal.entryApproved
      ? "Giriş onayı var; yine de manuel karar ve risk kontrolü şart."
      : blockers || next,
  };
}

function buildOpportunityList(latestSignals) {
  return Object.entries(latestSignals || {})
    .map(([symbol, signal]) => ({ symbol, ...scoreOpportunity(signal), signal }))
    .filter((x) => x && x.signal)
    .sort((a, b) => b.readiness - a.readiness);
}

function formatOpportunityTable(latestSignals) {
  const list = buildOpportunityList(latestSignals);
  if (!list.length) {
    return "📡 <b>FALIX FIRSAT RADARI</b>\n\nHenüz veri yok. /scan-now çalıştır veya ilk taramayı bekle.";
  }

  const rows = list.slice(0, 8).map((o, i) => {
    const icon = o.entryApproved ? "🚀" : o.readiness >= 78 ? "🔥" : o.readiness >= 65 ? "⚠️" : o.readiness >= 50 ? "👀" : "⏳";
    return `${i + 1}) ${icon} <b>${o.symbol}</b> — <b>${o.quality}</b>\nYön: <b>${o.side}</b> | Hazırlık: <b>${o.readiness}/100</b> | Tahmini: <b>${o.window}</b>\nFiyat: <b>${o.price}</b> | Hacim: <b>x${o.volumeRatio}</b> | Piyasa: <b>${o.marketRegime}</b>\nBeklenen: ${o.next}${o.blockers ? `\nEngel: ${o.blockers}` : ""}`;
  }).join("\n\n");

  return `📡 <b>FALIX FIRSAT RADARI</b>\n\n${rows}\n\nNot: Bu tablo kesinlik değil, <b>hazırlık derecesi</b> gösterir. Onay gelmeden işlem açma.`;
}

module.exports = {
  scoreOpportunity,
  buildOpportunityList,
  formatOpportunityTable,
};
