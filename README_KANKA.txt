FALIX TRADE V3 - SMART PROFIT SUPERVISOR

Bu sürümün ana amacı: çok sinyal atmak değil, kötü işlemleri elemek ve açık pozisyonu canlı yönetmek.

Eklenen ana mantık:
- 5m + 15m + 1h çoklu zaman dilimi teyidi.
- Hacim zayıfsa aktif giriş sinyali göndermez.
- Direnç kırılmadan PRO_LONG vermez.
- Destek kırılmadan PRO_SHORT vermez.
- /signal endpoint artık 5m+15m+1h filtresiyle gerçek bot kararını gösterir.
- Açık pozisyon takip eder: DEVAM / DİKKAT / KÂRI KORU / ÇIKIŞA HAZIRLAN / ŞİMDİ ÇIK.
- SL/TP dayatmaz; yön bozulunca uyarı verir.
- OpenAI opsiyoneldir, botu durdurmaz.
- Firestore yok, JSON kayıt var: data/*.json

Manuel pozisyon takip örneği:
https://SENIN-RENDER.onrender.com/track-now/BTCUSDT/LONG?entry=60000&leverage=15&amount=100

Kontrol linkleri:
/status
/signal/BTCUSDT
/tracked
/test-telegram

Önemli:
Garanti kâr yok. Bu sistem riskli/erken sinyalleri azaltmak, kâr erimesini takip etmek ve ters dönüşte hızlı uyarmak için tasarlandı.
