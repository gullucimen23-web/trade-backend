FALIX 1 HAFTALIK PAPER TEST MODU

Amaç:
- Bot 1 hafta boyunca kendi kurallarına göre paper trade açar.
- Gerçek emir açmaz.
- Her planı, TP1/TP2/TP3/STOP sonucunu kaydeder.
- Günlük/haftalık rapor üretir.

Render ENV:
AUTO_PAPER_TRADING=true
PAPER_OPEN_NOTIFY=false
PAPER_ALLOW_MULTIPLE_PER_SYMBOL=false
WEEKLY_REPORT_ENABLED=true
REPORT_EVERY_HOURS=24
REPORT_DAYS=7
TRADING_ENABLED=false
AUTO_MODE=false
PAPER_TRADING=true
REQUIRE_ENTRY_TRIGGER=true

Kontrol linkleri:
/status
/paper/open
/paper/all
/paper/report
/paper/report/send
/paper/export
/radar
/scan-now

Kural:
1 hafta stratejiye dokunma.
Sadece raporu topla.
1 hafta sonunda paper_trades.csv veya /paper/report çıktısını ChatGPT'ye at.

Rapor şunları gösterir:
- Toplam plan
- Kapanan işlem
- Kazanan / kaybeden
- Win rate
- TP1 / TP2 / TP3 / Stop sayıları
- Toplam paper sonuç
- En iyi / en kötü coin
- En iyi / en kötü saat


# Pullback giriş modu: breakout beklemeden EMA21/destek-direnç dönüşünü de test eder
ENABLE_PULLBACK_ENTRY=true
PULLBACK_MIN_VOLUME_RATIO=0.75
PULLBACK_MAX_DISTANCE_PERCENT=0.85
