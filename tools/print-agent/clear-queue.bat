@echo off
:: iRonWaves Print Agent - Windows Print Queue Spooler Fixer
:: This script clears any stuck print queues on Windows.
:: MUST BE RUN AS ADMINISTRATOR!

echo ==========================================================
echo iRonWaves Print Agent - Windows Print Spooler Fixer
echo ==========================================================
echo.
echo [1/3] Windows Print Spooler xidmeti dayandirilir...
net stop spooler /y
echo.
echo [2/3] C:\Windows\System32\spool\PRINTERS icindeki kohne cap isleri silinir...
del /q /f /s "%systemroot%\System32\spool\PRINTERS\*.*"
echo.
echo [3/3] Windows Print Spooler xidmeti yeniden basladilir...
net start spooler
echo.
echo ==========================================================
echo Windows cap novbesi ugurla temizlendi!
echo ==========================================================
echo.
pause
