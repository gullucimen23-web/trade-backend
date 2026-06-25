FALIX TRADE V2 - CANLI POZISYON YONETICI

Bu surumun mantigi:
- Firestore yok.
- JSON kayit var: data/*.json
- Bot 30 saniyede bir piyasayi tarar.
- Acik pozisyonu 60 saniyede bir takip eder.
- Risk gorurse normal sureyi beklemeden Telegram'a uyarir.
- SL/TP dayatmaz; acik pozisyonu gidebildigi yere kadar tasimaya calisir.
- Kar erimeye baslarsa: KARI KORU / CIKISA HAZIRLAN / SIMDI CIK der.
- Ters yon guclenirse: SIMDI CIK / TERS YONE HAZIRLAN der.

Manuel pozisyon takip ornegi:
https://SENIN-RENDER.onrender.com/track-now/BTCUSDT/SHORT?entry=59300&leverage=15&amount=100

Amount zorunlu degil. Yazarsan tahmini USDT kar/zarar hesaplar.

Deploy:
git add .
git commit -m "Falix Trade v2 profit supervisor"
git push origin main

Render:
Manual Deploy -> Clear build cache & deploy

Onemli:
Garanti kar yok. Bu sistem riski erken yakalamak ve kari korumak icin tasarlandi.
