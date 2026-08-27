' iRonWaves Print Agent - Silent Background Launcher
' Runs ironwaves-print-agent.exe with window style 0 (COMPLETELY HIDDEN — no CMD/console window)
Set WshShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
exePath = scriptDir & "\ironwaves-print-agent.exe"
WshShell.CurrentDirectory = scriptDir
WshShell.Run """" & exePath & """", 0, False
