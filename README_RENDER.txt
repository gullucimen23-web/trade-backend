Falix Trade Bot - Firestore kaldırılmış sürüm

Özellikler:
- Firestore/Firebase kullanılmaz.
- Bot açılışta aktif başlar.
- /stop-bot çağrılana kadar tarama devam eder.
- OpenAI limiti dolarsa bot durmaz, teknik analizle devam eder.
- Paper trade ve takip RAM'de tutulur.
- İşlem kâra geçtikçe risk otomatik azaltılır:
  - Yaklaşık %0.6 PnL sonrası SL giriş fiyatına çekilir.
  - Daha yüksek kârda trailing stop mantığı ile SL kâr korumaya çekilir.

Kurulum:
1) ZIP içindeki dosyaları trade-backend klasörüne kopyala.
2) .env dosyanı bu ZIP içine koyma. Render Environment kısmını kullan.
3) CMD:
   git add .
   git commit -m "Remove Firestore keep bot running risk tracking"
   git push origin main

Render:
- Environment değişkenlerini Render panelinden gir.
- Deploy latest commit veya Clear build cache & deploy yap.

Not:
Render restart/redeploy olursa RAM'deki açık işlemler sıfırlanır.
