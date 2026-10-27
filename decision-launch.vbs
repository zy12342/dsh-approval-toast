Option Explicit
Dim fso, sh, dir, uri, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
uri = ""
If WScript.Arguments.Count > 0 Then uri = WScript.Arguments(0)
cmd = Chr(34) & "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & dir & "\decision.ps1" & Chr(34) & " " & Chr(34) & uri & Chr(34)
sh.Run cmd, 0, False
