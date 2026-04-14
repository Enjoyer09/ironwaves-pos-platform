# Log Korelyatoru (Streamlit)

Bu utilit Railway backend logları, Chrome HAR və Neon query loglarını bir araya gətirib gecikmə/qırılma nöqtəsini tez tapmaq üçündür.

## Quraşdırma

```bash
cd /Users/admin/ironwaves-pos-platform
python3 -m venv /tmp/ironwaves-log-venv
source /tmp/ironwaves-log-venv/bin/activate
pip install streamlit
```

## İşə salma

```bash
cd /Users/admin/ironwaves-pos-platform
source /tmp/ironwaves-log-venv/bin/activate
streamlit run tools/log_correlator_streamlit.py
```

## Yüklənən fayllar

- Railway log: JSON (array və ya object)
- Chrome: HAR və ya JSON export
- Neon: CSV və ya JSON

## Nə verir

- Endpoint üzrə `avg/p95/max` gecikmə
- Chrome request-lərin Railway endpoint-lərlə timestamp korrelyasiyası
- Uyğun gəlməyən (backendə düşməyən) request-lərin sayı
- Xam timeline (mənbə, status, duration)

## Məsləhət

- Test zamanı eyni 1-2 dəqiqəlik intervalda 3 mənbədən log topla.
- Login + Masalar + Maliyyə keçidini bir sessiyada et.
- Korrelyasiya pəncərəsini əvvəl `15s`, sonra `5s` yoxla.
