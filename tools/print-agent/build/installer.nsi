!include "MUI2.nsh"

!define APPNAME "iRonWaves Print Agent"
!define VERSION "0.2.0"
!define PUBLISHER "iRonWaves"

; Stop any previously installed agent so its executable isn't locked (Error opening
; file for writing) while the installer tries to overwrite it. /T also kills the
; Chrome child the agent spawns for printing. Uses the built-in ExecWait + cmd so no
; external NSIS plugin (e.g. nsExec) is required.
!macro KillRunningAgent
  ExecWait '$WINDIR\System32\cmd.exe /C taskkill /IM ironwaves-print-agent.exe /F /T >nul 2>&1'
  Sleep 500
!macroend

Name "${APPNAME} ${VERSION}"
OutFile "ironwaves-print-agent-setup.exe"
InstallDir "$LOCALAPPDATA\iRonWavesPrintAgent"
RequestExecutionLevel user

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunSetup
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  !insertmacro KillRunningAgent
FunctionEnd

Function RunSetup
  ExecShell "" '"$INSTDIR\setup.bat"'
FunctionEnd

Section "Install"
  !insertmacro KillRunningAgent
  SetOutPath "$INSTDIR"
  File "${SETUP_STAGE}\ironwaves-print-agent.exe"
  File "${SETUP_STAGE}\setup-windows.ps1"
  File "${SETUP_STAGE}\setup.bat"
  File "${SETUP_STAGE}\clear-queue.bat"
  File "${SETUP_STAGE}\README.txt"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "InstallLocation" "$INSTDIR"
SectionEnd

Section "Uninstall"
  !insertmacro KillRunningAgent
  Delete "$INSTDIR\ironwaves-print-agent.exe"
  Delete "$INSTDIR\setup-windows.ps1"
  Delete "$INSTDIR\setup.bat"
  Delete "$INSTDIR\clear-queue.bat"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
SectionEnd
