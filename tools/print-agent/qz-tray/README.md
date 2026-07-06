# QZ Tray — iRonWaves POS "Always Allow" Quraşdırma

Bu 2 faylı QZ Tray qovluğuna kopyaladıqdan sonra çap zamanı heç bir 
"Allow/Block" dialog-u görünməyəcək. İmza avtomatik qəbul edilir.

## Lazım olan fayllar:
- `ironwaves-pos.crt` — iRonWaves POS sertifikatı (2036-ya qədər etibarlı)
- `qz-tray.properties` — konfiqurasiya

---

## Windows (staff terminal-ları)

```batch
copy ironwaves-pos.crt "C:\Program Files\QZ Tray\"
copy qz-tray.properties "C:\Program Files\QZ Tray\"
```
QZ Tray-i restart edin (system tray → sağ klik → Exit → yenidən aç).

---

## macOS

```bash
cp ironwaves-pos.crt qz-tray.properties ~/Library/Application\ Support/QZ\ Tray/
```
QZ Tray-i restart edin.

---

## Linux

```bash
mkdir -p ~/.config/qz-tray
cp ironwaves-pos.crt qz-tray.properties ~/.config/qz-tray/
```
QZ Tray-i restart edin.

---

## Sertifikat məlumatları

| Sahə | Dəyər |
|------|-------|
| Common Name | iRonWaves POS Platform |
| Valid From | 2026-05-26 |
| Valid To | 2036-05-23 |
| SHA1 Fingerprint | 7B:20:2B:D5:4B:F3:DB:C7:C9:39:40:01:D2:ED:BD:AE:C8:5D:D8:DF |
| SHA256 Fingerprint | 3E:7F:93:4A:52:DC:5B:0E:0D:68:79:A4:93:EB:B2:D0:5F:31:B3:D2:D0:B1:1F:EA:C2:B8:95:51:4D:97:21:07 |

---

## Problem həlli

Əgər yenə dialog gəlirsə:
1. QZ Tray-i tam bağlayın (sadəcə minimize deyil, Exit)
2. Faylların düzgün yerdə olduğunu yoxlayın
3. QZ Tray-i administrator olaraq açın (Windows)
4. QZ Tray 2.2+ versiya olduğundan əmin olun
