iRonWaves Print Agent - Windows artifacts

Bu qovluqda aşağıdakı fayllar serv olunur (Ayarlar -> Cap -> "Printer Agent quraşdırılması"):

  ironwaves-print-agent-setup.exe        - NSIS ilə hazırlanmış Windows quraşdırıcısı (EXE installer)
  ironwaves-print-agent-windows.zip      - Portable ZIP (ironwaves-print-agent.exe + setup-windows.ps1 + köməkçi .bat faylları)
  print-agent-latest.json               - Versiya manifesti (Ayarlar pəncərəsində "Yeniləmə var?" yoxlaması üçün)
  qz-digital-certificate.txt            - QZ Tray sertifikatı (əgər QZ istifadə olunursa)

Agent haqqında:
  - Windows 10/11 (x64) üçün tək başına işləyən .exe (Node.js quraşdırmağı tələb etmir).
  - 127.0.0.1:17777 ünvanında dinleyir; POS bu ünvana çap göndərir.
  - Quraşdırma: setup.exe işə salın VƏYA zip-i çıxarıb setup.bat-ə klikləyin.
  - Tələb: Google Chrome (HTML çapı üçün).
