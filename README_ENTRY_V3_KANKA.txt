# FALIX ENTRY V3 - KADEMELİ GİRİŞ + MESAJ SİSTEMİ

Bu sürümde bot artık tek seferde sadece “bekle / gir” yapmaz.

Yeni akış:

1) ⚡ ERKEN ADAY
- Bot hareketin oluşmaya başladığını görür.
- Risk yüksektir.
- İşlem açmak için tam onay yoktur.

2) 👀 HAZIRLIK
- Bot yönü ve bölgeyi belirler.
- Kullanıcı hazır olur.
- Breakout veya Pullback tetik beklenir.

3) 🔔 GİRİŞ ONAYLANDI
- Giriş bölgesi, stop, TP1, TP2, TP3 net gelir.
- Kullanıcı isterse manuel uygular.
- Bot canlı takip / paper kayıt yapar.

Önerilen ENV:

SWING_MIN_SCORE=70
SWING_MIN_CONFIDENCE=60
SWING_MIN_VOLUME_RATIO=0.65
SWING_MIN_RR=1.5
WATCH_ALERT_SCORE=55
EARLY_ENTRY_SCORE=60
PREPARE_ENTRY_SCORE=75
EARLY_MIN_VOLUME_RATIO=0.55
ENABLE_PULLBACK_ENTRY=true
PULLBACK_MIN_VOLUME_RATIO=0.75
PULLBACK_MAX_DISTANCE_PERCENT=0.85
PULLBACK_ENTRY_ZONE_PERCENT=0.22
BREAKOUT_ENTRY_ZONE_PERCENT=0.14
RADAR_ONLY_TOP=3
REQUIRE_ENTRY_TRIGGER=true
AUTO_PAPER_TRADING=true
TRADING_ENABLED=false
AUTO_MODE=false
PAPER_TRADING=true

Not: Bu sistem fırsat kaçırmayı azaltır ama sıfırlamaz. Test verisi tutulmalı.
