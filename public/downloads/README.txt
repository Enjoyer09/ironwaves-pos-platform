iRonWaves Print Agent — Windows 0.6.0 (x64, Windows 10/11)

ironwaves-print-agent-setup.exe — istifadəçi hesabında quraşdırılan Windows installer-i.
ironwaves-print-agent-windows.zip — eyni installer, setup.bat, setup-windows.ps1 və təlimat.
print-agent-windows-checksums.json — Windows CI-də yoxlanmış faylların SHA256/ölçüləri.
print-agent-latest.json — platformaya görə versiya məlumatı.

Yeniləmə: cari çapları tamamlayın, köhnə agenti tray menyusundan bağlayın,
sonra installer-i açın. Installer işləyən agenti zorla bağlamır və printer
növbəsini təmizləmir. Tenant məlumatı və printer ayarları dəyişmir.
Quraşdırma bitdikdə Start iRonWaves Print Agent seçimi ilə agenti açın.

Agent localhost 127.0.0.1:17777 üzərində işləyir. Node.js ayrıca tələb olunmur.
RAW çapında printerlər üçün ayrı növbələr və job ID üzrə təkrar sorğu qorunması var.
HTML çapı Chrome/Edge tələb edir. Bu buraxılış macOS paketlərini yeniləmir.
