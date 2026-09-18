# FALIX EDGE V9 — maliyet sonrası avantaj motoru

Bu sürüm her yüksek puana işlem açmaz. Amaç, yalnızca tahmini hareket işlem maliyetini anlamlı biçimde aştığında ve üç zaman dilimi aynı işlemi desteklediğinde aday seçmektir.

## Karar sırası

1. `1h`: Ana trendi belirler. EMA yapısı, ADX ve yön gücü net değilse işlem yoktur.
2. `15m`: Ana yön içinde EMA21 pullback dönüşü veya hacimli kırılım bekler.
3. `5m`: Giriş zamanlamasını doğrular; tek başına yön seçmez.
4. Maliyet: TP1 hareketi tahmini toplam maliyetin en az 3 katı değilse işlem yoktur.
5. Risk: Marj sabit değildir. Stop uzaklığına göre, hesap değerinin en fazla `%0.75` riske gireceği şekilde hesaplanır.
6. Emir: Gerçek giriş doğrulanır, ardından borsaya stop yerleştirilir. Stop kurulamazsa pozisyon güvenlik için kapatılır.

## Render ayarları

```env
LIVE_ENTRY_MODE=EDGE_V9
MEXC_AUTO_MIN_SCORE=78
MEXC_LEVERAGE=3

AUTO_SYMBOL_UNIVERSE=true
UNIVERSE_SIZE=10
CRYPTO_ONLY_UNIVERSE=true
MIN_24H_TURNOVER_USDT=2000000
MAX_OPEN_POSITIONS=1

EDGE_MIN_SCORE=78
EDGE_MIN_1H_ADX=20
EDGE_MIN_15M_VOLUME_RATIO=0.80
EDGE_MAX_PULLBACK_DISTANCE_PERCENT=0.65
EDGE_MAX_EXTENSION_PERCENT=1.20
EDGE_STOP_ATR_MULTIPLIER=1.30
EDGE_ALL_IN_COST_PERCENT=0.20
EDGE_MIN_COST_MULTIPLE=3
EDGE_MIN_EXPECTED_NET_USDT=0.05
RISK_PER_TRADE_PERCENT=0.75

MAX_TRADES_PER_DAY=3
MAX_DAILY_LOSS_PERCENT=2
MAX_CONSECUTIVE_LIVE_LOSSES=2
LOSS_STREAK_PAUSE_MINUTES=360

PROFIT_GUARD_ENABLED=true
PROFIT_GUARD_ARM_USDT=0.15
PROFIT_GUARD_GIVEBACK_PERCENT=10
PROFIT_GUARD_FEE_PERCENT=0.20
PROFIT_GUARD_MIN_NET_USDT=0.03
MAX_POSITION_MINUTES=180
DOLLAR_EXIT_MODE=false

EDGE_VALIDATION_MIN_TRADES=100
EDGE_VALIDATION_MIN_PROFIT_FACTOR=1.30
EDGE_VALIDATION_MAX_DRAWDOWN_PERCENT=10
```

`EDGE_ALL_IN_COST_PERCENT` komisyon, spread, slippage ve olası funding için ihtiyatlı toplam tahmindir. MEXC gerçekleşen işlemlerindeki toplam maliyet farklıysa bu değer güncellenmelidir.

## Canlı kilit

Gerçek emir için ayrıca:

```env
MEXC_FUTURES_ENABLED=true
MEXC_LIVE_TRADING_ENABLED=true
MEXC_LIVE_CONFIRM=MEXC_REAL_MONEY
```

Gerçek para riski vardır; kâr garantisi yoktur. Botun sık işlem açmaması hata değildir. Avantaj şartları oluşmadığında beklemek sistemin bir parçasıdır.

## Kontrol

Deploy sonrasında `/status` içinde şunlar görünmelidir:

```json
{
  "mexcLive": {
    "entryMode": "EDGE_V9",
    "minScore": 78,
    "leverage": 3
  },
  "profitPolicy": {
    "riskPerTradePercent": 0.75,
    "estimatedAllInCostPercent": 0.2,
    "minCostMultiple": 3,
    "timeframeLogic": "1h_direction_15m_setup_5m_trigger"
  }
}
```

`edgeValidation` bölümü yalnızca yeni V9 paper işlemlerini maliyet düşerek değerlendirir. `liveEvidenceReady=true` olması kâr garantisi değildir; minimum forward doğrulama eşiğinin geçildiğini gösterir.
