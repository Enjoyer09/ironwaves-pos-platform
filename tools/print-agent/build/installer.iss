; iRonWaves Print Agent — Inno Setup 6 installer script
; Builds a single "Next → Next → Finish" installer that:
;   • Copies the .exe to Program Files
;   • Registers it to run at Windows login (no console window) via HKCU Run registry key
;   • Starts the agent immediately after install
;   • Removes everything on uninstall (kills process, removes registry key, removes files)

[Setup]
AppId={{B8592FB9-DA12-4EFC-9E89-0FA4E7A6F2C1}
AppName=iRonWaves Print Agent
AppVersion=0.2.0
AppPublisher=iRonWaves
AppPublisherURL=https://ironwaves.store
DefaultDirName={autopf}\iRonWaves Print Agent
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=ironwaves-print-agent-setup
SetupIconFile=..\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
WizardSmallImageFile=..\icon.ico
ArchitecturesInstallIn64BitMode=x64
; Lowest = no UAC prompt (installs to per-user AppData if not admin)
; admin  = UAC prompt, installs to Program Files for all users
PrivilegesRequired=lowest
; Close any running instance before overwriting the exe
CloseApplications=yes
CloseApplicationsFilter=ironwaves-print-agent.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
; Keep the installer UI minimal and friendly
WelcomeLabel1=iRonWaves Print Agent Setup
WelcomeLabel2=This will install the iRonWaves Print Agent on your computer.%n%nThe agent runs silently in the background and allows the iRonWaves POS to print receipts without a print dialog.%n%nClick Install to continue.
FinishedHeadingLabel=iRonWaves Print Agent installed
FinishedLabel=The agent is now running and will start automatically every time you log in to Windows.%n%nYou can find its icon in the system tray (bottom-right corner).

[Files]
; Main executable
Source: "..\dist\ironwaves-print-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
; Tray icon (optional – packed into the exe by pkg, but keep a copy for the shortcut)
Source: "..\icon.ico"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
; Start-menu shortcut (so the user can find it if they want to)
Name: "{autoprograms}\iRonWaves Print Agent"; Filename: "{app}\ironwaves-print-agent.exe"; IconFilename: "{app}\icon.ico"

[Registry]
; Auto-start at login — no UAC required, runs only for the current user
; The key is deleted on uninstall (uninsdeletevalue flag)
Root: HKCU
Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"
ValueType: string
ValueName: "IronWavesPrintAgent"
; Run without a console window by wrapping in cmd /c start "" /B
; This ensures zero terminal pop-up on startup
ValueData: """{app}\ironwaves-print-agent.exe"""
Flags: uninsdeletevalue

[Run]
; Start the agent immediately after install finishes (no console window)
Filename: "{app}\ironwaves-print-agent.exe"
Description: "Start iRonWaves Print Agent now"
Flags: nowait postinstall skipifsilent

[UninstallRun]
; Kill the running process before uninstall removes the files
Filename: "{cmd}"
Parameters: "/C taskkill /IM ironwaves-print-agent.exe /F"
Flags: runhidden skipifdoesntexist
RunOnceId: KillAgent

[Code]
// Kill any running instance before the installer copies the new exe
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    Exec(ExpandConstant('{cmd}'), '/C taskkill /IM ironwaves-print-agent.exe /F', '',
         SW_HIDE, ewNoWait, ResultCode);
end;
