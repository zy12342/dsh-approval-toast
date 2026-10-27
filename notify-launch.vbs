Option Explicit
Dim sh, fso, path, cmd, code
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count = 0 Then WScript.Quit 1
path = WScript.Arguments(0)
cmd = Chr(34) & "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & path & Chr(34)
code = sh.Run(cmd, 0, True)
On Error Resume Next
fso.DeleteFile path, True
On Error GoTo 0
WScript.Quit code
