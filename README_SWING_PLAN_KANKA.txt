FALIX SWING PLAN SİSTEMİ

Bu sürüm 5m scalp yerine emir planı üretir. Bot otomatik al-sat yapmaz.

Ana kurallar:
- 15m giriş
- 1h trend teyidi
- 4h ana yön teyidi
- Skor < 90 ise işlem yok
- Güven < 75 ise işlem yok
- Hacim < x0.90 ise işlem yok
- Risk/ödül < 1:2 ise işlem yok

Önerilen Render ENV:
TRADING_ENABLED=false
AUTO_MODE=false
PAPER_TRADING=true
SWING_MIN_SCORE=90
SWING_MIN_CONFIDENCE=75
SWING_MIN_VOLUME_RATIO=0.90
SWING_MIN_RR=2
TARGET_PROFIT_USDT=5
ACCOUNT_BALANCE_USDT=100
SWING_LEVERAGE=5
SCAN_EVERY_SECONDS=60
OPENAI_SIGNAL_REVIEW=false

Telegram mesajı kullanıcıya giriş bölgesi, stop, TP1/TP2/TP3, hedef kâr ve tahmini riski gösterir.
