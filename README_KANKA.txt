FALIX TRADE BOT - FIRESTORESUZ SÜRÜM

Bu pakette Firestore/Firebase devre dışı bırakıldı.
Bot artık sunucu açılınca otomatik AKTİF başlar ve sen /stop-bot diyene kadar çalışır.

ÖNEMLİ:
- .env ve Firebase service account JSON güvenlik için ZIP'e konmadı.
- Render Environment Variables kısmındaki mevcut API keylerini kullanmaya devam et.
- FIREBASE_SERVICE_ACCOUNT artık gerekli değil, silebilirsin.
- Render restart olursa RAM'deki açık paper işlemler sıfırlanır.
- Telegram sinyal, buton ve takip sistemi çalışır.

DEPLOY KOMUTLARI:

git add .
git commit -m "Remove Firestore and keep bot active"
git push origin main

DURUM KONTROL:
/status

BOTU BAŞLAT:
/start-bot

BOTU DURDUR:
/stop-bot
