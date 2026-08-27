!include "MUI2.nsh"

!define APPNAME "iRonWaves Print Agent"
!define VERSION "0.5.2"
!define PUBLISHER "iRonWaves"

; Stop any previously installed agent so its executable isn't locked (Error opening
; file for writing) while the installer tries to overwrite it. /T also kills the
; Chrome child the agent spawns for printing.
!macro KillRunningAgent
  ExecWait '"$WINDIR\System32\cmd.exe" /C taskkill /IM ironwaves-print-agent.exe /F /T'
  ExecWait 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $$_.CommandLine -like $\"*ironwaves-print-agent*$\" -or $$_.ExecutablePath -like $\"*ironwaves-print-agent*$\" } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Sleep 800
!macroend

Name "${APPNAME} ${VERSION}"
OutFile "ironwaves-print-agent-setup.exe"
InstallDir "$LOCALAPPDATA\iRonWavesPrintAgent"
RequestExecutionLevel user

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "iRonWaves Print Agent-i başlat (arxa planda)"
!define MUI_FINISHPAGE_RUN_FUNCTION RunSetup
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  !insertmacro KillRunningAgent
FunctionEnd

Function RunSetup
  ; Launch completely hidden in background via wscript + launch-silent.vbs
  ExecShell "" '"$WINDIR\System32\wscript.exe"' '"$INSTDIR\launch-silent.vbs"'
FunctionEnd

Section "Install"
  !insertmacro KillRunningAgent
  SetOutPath "$INSTDIR"
  File "${SETUP_STAGE}\ironwaves-print-agent.exe"
  File "${SETUP_STAGE}\launch-silent.vbs"
  File "${SETUP_STAGE}\setup-windows.ps1"
  File "${SETUP_STAGE}\setup.bat"
  File "${SETUP_STAGE}\clear-queue.bat"
  File "${SETUP_STAGE}\README.txt"

  ; Create silent auto-start shortcut in Windows Startup folder (no CMD window)
  CreateShortcut "$SMSTARTUP\iRonWavesPrintAgent.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\launch-silent.vbs"' "$INSTDIR\ironwaves-print-agent.exe" 0

  ; Create Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$WINDIR\System32\wscript.exe" '"$INSTDIR\launch-silent.vbs"' "$INSTDIR\ironwaves-print-agent.exe" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "InstallLocation" "$INSTDIR"
SectionEnd

Section "Uninstall"
  !insertmacro KillRunningAgent
  Delete "$SMSTARTUP\iRonWavesPrintAgent.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"

  Delete "$INSTDIR\ironwaves-print-agent.exe"
  Delete "$INSTDIR\launch-silent.vbs"
  Delete "$INSTDIR\setup-windows.ps1"
  Delete "$INSTDIR\setup.bat"
  Delete "$INSTDIR\clear-queue.bat"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "iRonWavesPrintAgent"
SectionEnd
