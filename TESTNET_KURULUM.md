# Binance Futures Testnet kurulumu

Bu sürüm yalnızca Binance'in güncel USD-M Futures Testnet adresi olan `https://demo-fapi.binance.com` uç noktasına emir gönderir. Gerçek Binance hesabına emir göndermez.

## 1. Ortam dosyasını hazırla

`.env.example` dosyasını `.env` olarak kopyala. Binance Futures Testnet'ten oluşturduğun anahtarları gir:

```env
BINANCE_TESTNET_API_KEY=...
BINANCE_TESTNET_SECRET_KEY=...
FUTURES_TESTNET_ENABLED=true
AUTO_TESTNET_TRADING=false
AUTO_TESTNET_MIN_SCORE=88
TESTNET_MARGIN_USDT=10
TESTNET_LEVERAGE=3
```

İlk kontrolde `AUTO_TESTNET_TRADING=false` kalsın.

## 2. Başlat

```bash
npm install
npm start
```

## 3. Bağlantıyı test et

Tarayıcıda veya Postman'de aç:

```text
GET http://localhost:3000/test-futures-testnet
```

`ok: true` ve `environment: BINANCE_FUTURES_TESTNET` görmelisin.

## 4. Otomatik test işlemlerini aç

Bağlantı doğrulandıktan sonra `.env` içindeki değeri değiştir ve servisi yeniden başlat:

```env
AUTO_TESTNET_TRADING=true
```

Bot yalnızca strateji skoru `AUTO_TESTNET_MIN_SCORE` değerine ulaştığında testnet emri açar. Aynı sembolde açık pozisyon varsa yenisini açmaz. Girişten sonra stop ve kâr alma emri kurar; koruma emirleri kurulamazsa açtığı test pozisyonunu kapatmaya çalışır.

## 5. Acil test pozisyonu kapatma

```text
POST http://localhost:3000/testnet/close/BTCUSDT
```

## Güvenlik

- Anahtarları `.env` dışında koda yazma.
- `.env` dosyasını ZIP'e veya Git'e ekleme.
- Bu pakette gerçek emir adresi bulunmaz.
- Eski ZIP'te bulunan Binance, Telegram, OpenAI ve Firebase anahtarlarını yenile.
