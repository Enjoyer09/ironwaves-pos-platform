iRonWaves Print Agent - Windows və macOS artifact-ları

Bu qovluq Ayarlar -> Cap -> "Printer Agent quraşdırılması" pəncərəsindən serv olunur:

Windows:
  ironwaves-print-agent-setup.exe        - NSIS ilə hazırlanmış Windows quraşdırıcısı (EXE installer)
  ironwaves-print-agent-windows.zip      - Portable ZIP (ironwaves-print-agent.exe + setup-windows.ps1 + köməkçi .bat faylları)

macOS:
  ironwaves-print-agent-macos-arm64.pkg  - Apple Silicon (.pkg, LaunchAgent ilə auto-start)
  ironwaves-print-agent-macos-x64.pkg    - Intel Mac (.pkg, LaunchAgent ilə auto-start)

Digər:
  print-agent-latest.json               - Versiya manifesti ("Yeniləmə var?" yoxlaması)
  qz-digital-certificate.txt            - QZ Tray sertifikatı (əgər QZ istifadə olunursa)

Agent haqqında:
  - Windows 10/11 (x64) və macOS 11+ (arm64/x64) dəstəklənir.
  - 127.0.0.1:17777 ünvanında dinleyir; POS bu ünvana çap göndərir.
  - Tələb: Google Chrome (HTML çapı üçün). macOS-da /Applications/Google Chrome.app.
  - Auto-start: Windows Startup qovluğu; macOS LaunchAgent (RunAtLoad + KeepAlive).
