FALIX AI TRADE PLANNER - FINAL SISTEM

Bu paket scalp otomatik al-sat mantığını kapatır.
Bot artık kullanıcıya profesyonel emir planı verir ve kullanıcı işlemi açtıysa takip eder.

ANA AKIŞ
1) Bot piyasayı tarar.
2) Fırsat varsa önce HAZIRLIK mesajı atar.
   - Bu mesajda "ŞU AN GİRME" yazar.
   - Giriş tetikleyicisi net yazılır.
   - Örn: 15m mum 1558 üstünde/altında kapanmalı + hacim x0.90+ olmalı.
3) Şart oluşursa ayrı mesaj gelir:
   - "GİRİŞ ONAYLANDI — EMİR PLANI"
   - Giriş bölgesi, stop, TP1, TP2, TP3, hedef kâr ve risk görünür.
4) Kullanıcı işlemi açarsa Telegram butonuna basar:
   - "Açtım / Canlı Takibe Al"
5) Bot pozisyonu takip eder:
   - TP1: %30 kapat, stop'u girişe çek.
   - TP2: %40 kapat.
   - TP3: kalan pozisyonu kapat.
   - Stop: işlem kapatılır.
   - Plan bozulursa uyarı verir.

ÖNERİLEN RENDER ENV
TRADING_ENABLED=false
AUTO_MODE=false
PAPER_TRADING=true
REQUIRE_ENTRY_TRIGGER=true
SWING_MIN_SCORE=90
SWING_MIN_CONFIDENCE=75
SWING_MIN_VOLUME_RATIO=0.90
SWING_MIN_RR=2
TARGET_PROFIT_USDT=5
ACCOUNT_BALANCE_USDT=100
SWING_LEVERAGE=5
SCAN_EVERY_SECONDS=60
WATCH_ALERT_SCORE=65
WATCH_ALERT_COOLDOWN_SECONDS=300
FOLLOW_REPORT_SECONDS=900
OPENAI_SIGNAL_REVIEW=false

ÖNEMLİ
Bu sistem otomatik emir açmaz. Kullanıcı planı kendisi uygular.
Canlı para ile kullanmadan önce paper/test sonuçlarını takip et.
