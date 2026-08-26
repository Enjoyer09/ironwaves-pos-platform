!include "MUI2.nsh"

!define APPNAME "iRonWaves Print Agent"
!define VERSION "0.2.0"
!define PUBLISHER "iRonWaves"

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

Function RunSetup
  ExecShell "" '"$INSTDIR\setup.bat"'
FunctionEnd

Section "Install"
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
  Delete "$INSTDIR\ironwaves-print-agent.exe"
  Delete "$INSTDIR\setup-windows.ps1"
  Delete "$INSTDIR\setup.bat"
  Delete "$INSTDIR\clear-queue.bat"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
SectionEnd
