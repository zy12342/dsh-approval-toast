# Remove the dshnotify:// protocol handler and the AppUserModelId registered by the plugin.
$key = 'HKCU:\Software\Classes\dshnotify'
if (Test-Path $key) {
    Remove-Item -Path $key -Recurse -Force
    Write-Output 'dshnotify protocol removed'
} else {
    Write-Output 'dshnotify protocol not registered'
}

$aumid = 'HKCU:\Software\Classes\AppUserModelId\DSH.Notify'
if (Test-Path $aumid) {
    Remove-Item -Path $aumid -Recurse -Force
    Write-Output 'AppUserModelId DSH.Notify removed'
} else {
    Write-Output 'AppUserModelId DSH.Notify not registered'
}
