Falix Trade V5 - Anında Hazırlık + Onaylı Sinyal

Bu sürümde amaç gecikmeyi azaltmak ama kör giriş yaptırmamak:

1) WATCH / HAZIRLIK uyarısı
- Skor 60+ olduğunda ama giriş onayı yoksa Telegram'a hazırlık mesajı atar.
- Mesajda 'ŞİMDİ GİRME — ONAY BEKLE' yazar.
- Hangi seviye kırılırsa sinyal geleceğini söyler.

2) ONAYLI SİNYAL
- Hacim + kırılım + MTF teyidi gelmeden PRO/STRONG sinyal göndermez.
- Direnç kırılmadan LONG, destek kırılmadan SHORT dayatmaz.

3) Canlı pozisyon takibi
- Açtım / Canlı Takibe Al veya /track-now endpointi ile pozisyonu izler.
- Devam et, kârı koru, çıkışa hazırlan, şimdi çık uyarıları verir.

Yeni endpointler:
/status
/signal/BTCUSDT
/market-status
/scan-now
/track-now/BTCUSDT/LONG?entry=60000&leverage=15&amount=100
/track-stop/BTCUSDT

Deploy:
git add .
git commit -m "Falix Trade v5 instant watch alerts"
git push origin main
