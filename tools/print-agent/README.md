# iRonWaves Print Agent

Local Windows (+ macOS) silent print helper for iRonWaves POS.

## User experience (sıfır iş öhdəliyi)

1. User `ironwaves-print-agent-setup.exe`-ni yükləyib qurur.
2. Installer "Next → Install → Finish" — başqa heç nə soruşmur.
3. Agent sistem tepsisindən (tray) işə düşür — pəncərə, terminal yoxdur.
4. Windows-a hər giriş etdikdə agent avtomatik başlayır (Registry `HKCU\Run`).
5. POS bir dəfə ayarlarda printer adını yazır — bundan sonra hər çap sessiz gedir.

## Texniki arxitektura

```
Browser (POS)  →  POST http://127.0.0.1:17777/print-html  →  Agent
                                                              ↓
                                                 Chrome --kiosk-printing (dialog yoxdur)
                                                              ↓
                                                    Printer ← spool job
                                                              ↓
                                                 Chrome prosesi 12 saniyə sonra kill olunur
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{ ok, version, platform }` |
| GET | `/version` | `{ ok, version }` |
| GET | `/printers` | `{ ok, printers: [{name, default}] }` |
| POST | `/print-html` | `{ html, printer_name? }` → `{ ok, result }` |

## Build — Windows `.exe` + installer

**Tələb:** Windows PC, Node.js 20+, [Inno Setup 6](https://jrsoftware.org/isinfo.php)

```powershell
cd tools\print-agent

# 1. Asılılıqları yüklə
npm install

# 2. Standalone .exe + Inno Setup installer birlikdə build et
npm run build:all
```

Nəticə:
```
tools\print-agent\dist\ironwaves-print-agent-setup.exe
```

## Deploy

```powershell
# POS-un public qovluğuna kopyala
copy tools\print-agent\dist\ironwaves-print-agent-setup.exe public\downloads\ironwaves-print-agent-setup.exe
```

Sonra `public/downloads/print-agent-latest.json` içindəki `latest_version` dəyərini yeni versiya ilə yenilə.

---

## macOS `.pkg` installer

```bash
cd tools/print-agent
npm install
npm run build:mac:all
```

Output: `tools/print-agent/dist/ironwaves-print-agent-macos-installer.pkg`

---

## Inkişaf — lokal test

```powershell
cd tools\print-agent
node ironwaves-print-agent.js
```

Health check:
```
curl http://127.0.0.1:17777/health
curl http://127.0.0.1:17777/printers
```

---

## Sistem tepsisi (Tray) ikonası

`tools/print-agent/icon.ico` mövcud olduqda agent tray-da göstərilir.
İkon olmasa belə agent işləyir (tray ikonasız).

Tövsiyə: 256×256 ICO faylı. Windows Task Manager-də `ironwaves-print-agent.exe` kimi görünür.

---

## Versiya tarixi

| Versiya | Dəyişiklik |
|---------|------------|
| 0.2.0 | Tray ikonası, terminal pəncərəsiz background iş, Chrome-u çap sonrası kill edir, EADDRINUSE-da silent exit |
| 0.1.0 | İlk MVP — Chrome kiosk print |
