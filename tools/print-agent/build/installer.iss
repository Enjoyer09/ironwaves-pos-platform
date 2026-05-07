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
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
CloseApplications=yes
CloseApplicationsFilter=ironwaves-print-agent.exe

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\ironwaves-print-agent.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\iRonWaves Print Agent"; Filename: "{app}\ironwaves-print-agent.exe"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "IronWavesPrintAgent"; ValueData: """{app}\ironwaves-print-agent.exe"""; Flags: uninsdeletevalue

[Run]
Filename: "{app}\ironwaves-print-agent.exe"; Description: "Start iRonWaves Print Agent now"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM ironwaves-print-agent.exe /F"; Flags: runhidden skipifdoesntexist

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssInstall then
    Exec(ExpandConstant('{cmd}'), '/C taskkill /IM ironwaves-print-agent.exe /F', '', SW_HIDE, ewNoWait, ResultCode);
end;
