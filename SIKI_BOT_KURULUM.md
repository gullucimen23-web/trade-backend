# FALIX sıkı MEXC modu

Bu sürüm en likit MEXC USDT vadeli kontratlarını tarar, bütün adayları karşılaştırır ve yalnızca sıkı canlı filtrelerden geçen en iyi adayı seçer. Aynı anda varsayılan olarak tek pozisyon açar.

## Güvenli başlangıç

İlk aşamada şunları kapalı bırak:

```env
MEXC_LIVE_TRADING_ENABLED=false
MEXC_LIVE_CONFIRM=
```

En az 7 gün paper sonuçlarını incele. Kâr garantisi yoktur; pump yakalama filtresi geç kalmış girişleri azaltır ama tüm ters hareketleri öngöremez.

## Ne değişti?

- Hacme göre ilk 50 likit kontrat.
- Geç kalmış pump/dump, aşırı hacim, aşırı RSI, zayıf ADX, uygunsuz ATR ve ters üst-zaman filtresi.
- Her taramada tek bir en iyi aday.
- Aynı anda en fazla bir MEXC pozisyonu.
- 50 USDT altı hesapta tek pozisyon ve 10 USDT marjin; 50 USDT ve üstünde farklı coinlerde en fazla iki pozisyon ve işlem başına 20 USDT marjin.
- 50 USDT ve üstünde yeni işlem açarken en az 10 USDT kullanılabilir rezerv bırakma.
- İşlem kapanınca aynı coine hemen dönmek yerine farklı fırsata geçiş; kapanan coin için 30 dakika bekleme.
- Borsaya girişle beraber sert stop ve TP3 gönderimi.
- TP1'de %40, TP2'de %30 kısmi kapatma; kalan pozisyonda kâr sonrası trailing çıkış.
- TP1 gelmeden önce yeterli kâr oluşursa kâr korumayı devreye alma; zirveden geri dönüşte yalnızca tahmini komisyon sonrası sonuç pozitifse pozisyonu kapatma.
- 5 dakikalık fırsat işlemi 90 dakika içinde hedefe gitmezse, başa başa yakın bölgede sermayeyi saatlerce kilitlemeden zaman çıkışı yapma.
- Arka arkaya iki gerçek zarar oluşursa üç saat yeni işlem açmayarak zarar kovalamayı engelleme.
- API hız sınırına karşı istek kuyruğu.
- Telegram trade-only modunda yalnızca gerçek emir, periyodik kâr/zarar, TP ve kapanış bildirimleri.
- Mevcut marjin ve kaldıraçla minimum kontratı alınamayan coinleri emirden önce eleme; başarısız coini 30 dakika yeniden denememe.
- Paper, testnet ve gerçek MEXC günlük işlem/zarar sayaçlarını tamamen ayrı tutma.
- Hacim hesabında yalnızca kapanmış mumları kullanma; WAIT sinyallerini onay listesine almama ve emir öncesi güncel fiyat kayma kontrolü.
- Stop fiyatını her kontratın `priceUnit` adımına göre yönlü yuvarlama; varsayılan olarak girişe yalnızca sert stop ekleyip TP1/TP2/trailing kâr yönetimini pozisyon yöneticisine bırakma.

## Kâr koruma ayarları

```env
PROFIT_GUARD_ENABLED=true
PROFIT_GUARD_ARM_PERCENT=0.25
PROFIT_GUARD_GIVEBACK_PERCENT=40
PROFIT_GUARD_FEE_PERCENT=0.10
PROFIT_GUARD_MIN_NET_USDT=0.02
MAX_POSITION_MINUTES=90
TIME_EXIT_MAX_LOSS_PERCENT=0.12
MAX_CONSECUTIVE_LIVE_LOSSES=2
LOSS_STREAK_PAUSE_MINUTES=180
```

Bu koruma her yeşil rakamda çıkmaz. Önce fiyatın işlem yönünde en az `%0.25` ilerlemesini bekler; zirve kârın `%40` kadarı geri verilirse ve tahmini komisyon sonrası hâlâ pozitif sonuç varsa pozisyonu kapatır. Böylece küçük hesapta komisyonun altında kalan yalancı kârların peşinden koşulmaz.

## Canlıya geçmeden önce

Render ortam değişkenlerini `.env.example` ile karşılaştır. Önce `MEXC_FUTURES_ENABLED=true` yalnızca okuma/test için kullanılabilir. Gerçek emir için iki ayrı kilit gerekir:

```env
MEXC_LIVE_TRADING_ENABLED=true
MEXC_LIVE_CONFIRM=MEXC_REAL_MONEY
```

Canlı kilit açıldığında gerçek para riske girer. Varsayılan ayar 50 USDT altı için 10 USDT, 50 USDT ve üstü için işlem başına 20 USDT marjin ve `MEXC_LEVERAGE=3` değeridir. Günlük zarar limiti dolarsa yeni işlem açılmaz; kârlı işlemden sonra bot taramaya devam eder.
