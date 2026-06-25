FALIX TRADE V6 - FIRSAT RADARI

Yeni eklenenler:
- /opportunities endpointi: en yakın fırsatları JSON olarak gösterir.
- /radar endpointi: okunabilir fırsat radarı verir.
- /radar?send=1: fırsat radarını Telegram'a gönderir.
- /market-status artık signals + opportunities döndürür.
- Bot belirli aralıkla Telegram'a "FALIX FIRSAT RADARI" yollar.

Mantık:
- Bot sadece PRO sinyal gelince konuşmaz.
- Önceden hangi coin yaklaşıyor, hangi yön hazırlanıyor, ne bekleniyor yazar.
- "Tahmini 5-15 dk / 15-45 dk" kesin tahmin değil, hazırlık derecesidir.

Önerilen ENV:
SCAN_EVERY_SECONDS=30
FOLLOW_REPORT_SECONDS=45
OPPORTUNITY_RADAR_ENABLED=true
OPPORTUNITY_RADAR_MINUTES=15
WATCH_ALERT_SCORE=60
SIGNAL_THRESHOLD=88
ENTRY_APPROVAL_SCORE=88
OPENAI_ENABLED=false

Test linkleri:
/status
/market-status
/opportunities
/radar
/radar?send=1
/scan-now
