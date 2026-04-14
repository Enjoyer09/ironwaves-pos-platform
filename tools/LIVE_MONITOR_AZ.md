# Live Monitor (Streamlit)

Bu alət canlı olaraq:
- Backend endpoint-lərin status/latency-sini
- Frontend URL cavab sürətini
- Neon DB bağlantı və aktiv query göstəricilərini
yoxlayır.

## Quraşdırma

```bash
cd /Users/admin/ironwaves-pos-platform
python3 -m venv /tmp/ironwaves-live-venv
source /tmp/ironwaves-live-venv/bin/activate
pip install streamlit psycopg2-binary
```

## İşə salma

```bash
cd /Users/admin/ironwaves-pos-platform
source /tmp/ironwaves-live-venv/bin/activate
streamlit run tools/live_monitor_streamlit.py
```

## İstifadə

1. `Backend URL` daxil et
2. Endpoint listini ver (hər sətirdə bir path)
3. Lazımdırsa `x-tenant-domain` və `Bearer token` daxil et
4. `Frontend URL` yaz
5. `Neon connection string` əlavə et
6. `Probe et` bas və ya `Canlı auto-refresh` aktiv et

## Qeyd

- Bu alət Chrome-un daxili DevTools logunu birbaşa oxumur.
- Amma frontend/backend/neon latency və statusları ilə real bottleneck-i praktik olaraq göstərir.
- Chrome HAR analizi üçün ayrıca `tools/log_correlator_streamlit.py` istifadə et.
