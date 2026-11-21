Unicode True
!include "MUI2.nsh"
!ifndef APP_ROOT
!error "APP_ROOT is required"
!endif
!ifndef VERSION
!error "VERSION is required"
!endif
Name "iRonWaves Print Agent ${VERSION}"
OutFile "${APP_ROOT}\dist\ironwaves-print-agent-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\iRonWaves Print Agent"
RequestExecutionLevel user
SetCompressor /SOLID lzma
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "iRonWaves Print Agent"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "iRonWaves Print Agent Setup"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Start iRonWaves Print Agent"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchAgent
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  ; Never stop an agent or clear the Windows spooler during an upgrade.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "if (Get-NetTCPConnection -LocalPort 17777 -State Listen -ErrorAction SilentlyContinue) { exit 42 }; exit 0"'
  Pop $0
  Pop $1
  StrCmp $0 "0" safe
  MessageBox MB_OK|MB_ICONEXCLAMATION "Finish current print jobs, then quit the existing Print Agent from its tray menu and run setup again. No printer queues or settings were changed." /SD IDOK
  SetErrorLevel 42
  Quit
  safe:
FunctionEnd
Section "Install"
  ; Older ZIP setups used this exact per-user shortcut in addition to HKCU Run.
  ; Remove only our legacy launcher to prevent two agents at next login.
  SetShellVarContext current
  Delete "$SMSTARTUP\iRonWavesPrintAgent.lnk"
  SetOutPath "$INSTDIR"
  File "${APP_ROOT}\dist\ironwaves-print-agent.exe"
  File "${APP_ROOT}\launch-silent.vbs"
  File "${APP_ROOT}\README.txt"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\iRonWavesPrintAgent" "DisplayName" "iRonWaves Print Agent"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\iRonWavesPrintAgent" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\iRonWavesPrintAgent" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
SectionEnd
Function LaunchAgent
  ExecShell "open" "$SYSDIR\wscript.exe" '$\"$INSTDIR\launch-silent.vbs$\"'
FunctionEnd
Function un.onInit
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "if (Get-NetTCPConnection -LocalPort 17777 -State Listen -ErrorAction SilentlyContinue) { exit 42 }; exit 0"'
  Pop $0
  Pop $1
  StrCmp $0 "0" safe
  MessageBox MB_OK|MB_ICONEXCLAMATION "Quit the Print Agent after current jobs finish, then retry. No settings were changed." /SD IDOK
  SetErrorLevel 42
  Quit
  safe:
FunctionEnd
Section "Uninstall"
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "iRonWavesPrintAgent"
  StrCmp $0 '$\"$INSTDIR\ironwaves-print-agent.exe$\"' remove_startup
  StrCmp $0 '$INSTDIR\ironwaves-print-agent.exe' remove_startup keep_startup
  remove_startup:
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "iRonWavesPrintAgent"
  keep_startup:
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\iRonWavesPrintAgent"
  Delete "$INSTDIR\ironwaves-print-agent.exe"
  Delete "$INSTDIR\launch-silent.vbs"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  ; Intentionally retain job history and all printer/tenant configuration.
SectionEnd
