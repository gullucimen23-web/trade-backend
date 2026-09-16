# MEXC Global vadeli otomatik al-sat kurulumu

## Önemli

MEXC API için testnet/sandbox yoktur. Bu bağlantı gerçek hesaba ve gerçek paraya emir gönderir. Paket güvenlik amacıyla canlı işlem kapalı gelir.

## 1. MEXC API anahtarı

MEXC hesabında KYC tamamlanmış olmalı. API anahtarında şunları aç:

- Futures işlem bilgilerini görüntüleme
- Futures emir verme
- Mümkünse sunucunun sabit IP adresini bağla
- Para çekme yetkisini açma

## 2. `.env` ayarları

`.env.example` dosyasını `.env` olarak kopyala ve önce bağlantı kontrolü için şunları doldur:

```env
EXECUTION_EXCHANGE=MEXC
MEXC_API_KEY=...
MEXC_SECRET_KEY=...
MEXC_FUTURES_ENABLED=true
MEXC_LIVE_TRADING_ENABLED=false
MEXC_LIVE_CONFIRM=
MEXC_AUTO_MIN_SCORE=90
MEXC_MARGIN_USDT=10
MEXC_LEVERAGE=3
MEXC_OPEN_TYPE=1
MEXC_POSITION_MODE=1
ADMIN_TOKEN=uzun-rastgele-bir-parola
```

`MEXC_OPEN_TYPE=1` izole, `2` cross marjdır. Varsayılan izoledir. `MEXC_POSITION_MODE=1` hedge, `2` one-way moddur.

## 3. Bağlantıyı kontrol et

```bash
npm install
npm start
```

Postman ile:

```text
GET http://localhost:3000/test-mexc
X-Admin-Token: .env içindeki ADMIN_TOKEN
```

`ok: true` görmeden canlı işlemi açma.

## 4. Gerçek otomatik işlemi aç

Yalnızca bağlantı testi başarılıysa `.env` içinde:

```env
MEXC_LIVE_TRADING_ENABLED=true
MEXC_LIVE_CONFIRM=MEXC_REAL_MONEY
```

Servisi yeniden başlat. Bot yalnızca skor 90 ve üzerindeyse, strateji girişe açıkça onay verdiyse ve aynı paritede açık pozisyon yoksa gerçek MEXC vadeli emri açar. İlk kullanım için kod marjı en fazla 25 USDT, kaldıracı en fazla 10x ile sınırlar.

## 5. Açık pozisyonlar ve acil kapatma

```text
GET  /mexc/positions
POST /mexc/close/BTCUSDT
X-Admin-Token: .env içindeki ADMIN_TOKEN
```

## Güvenlik

- `.env` dosyasını ZIP'e veya Git'e ekleme.
- Para çekme yetkisi verme.
- İlk gün `MEXC_MARGIN_USDT=5` ve `MEXC_LEVERAGE=1` kullan.
- API anahtarını sabit sunucu IP'sine bağla.
