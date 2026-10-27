# Show (or remove) a Windows toast notification for DSH.
# Uses Windows PowerShell 5.1 WinRT; no extra modules required.
# IMPORTANT: this file must be saved as UTF-8 with BOM, otherwise
# Windows PowerShell 5.1 parses it as GBK and the button labels corrupt.

param(
    [string]$Title = 'DeepSeek Harness',
    [string]$Body = '',
    [string]$AllowUri = '',
    [string]$DenyUri = '',
    [string]$OpenUri = '',
    [string]$Tag = '',
    [string]$LogoPath = '',
    [string]$HeroPath = '',
    [string]$SessionTitle = '',
    [switch]$Approval,
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$Aumid = 'DSH.Notify'
$LogPath = Join-Path $env:LOCALAPPDATA 'Temp\dsh-notify.log'

function Write-NotifyLog([string]$message) {
    try {
        if ((Test-Path $LogPath) -and ((Get-Item $LogPath).Length -gt 200KB)) { Remove-Item $LogPath -Force }
        $line = ('[{0:yyyy-MM-dd HH:mm:ss.fff}] pid={1} {2}' -f (Get-Date), $PID, $message)
        Add-Content -Path $LogPath -Value $line -Encoding UTF8
    } catch { }
}

try {
    Write-NotifyLog ('START remove=' + [bool]$Remove)

    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

    if ($Remove) {
        try {
            if ($Tag -ne '') {
                [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($Tag, 'dsh-approval', $Aumid) | Out-Null
            } else {
                [Windows.UI.Notifications.ToastNotificationManager]::History.Remove('dsh-approval', $Aumid) | Out-Null
            }
        } catch { }
        Write-NotifyLog ('REMOVE done tag=' + $Tag)
        exit 0
    }

    function Esc([string]$s) {
        if ($null -eq $s) { return '' }
        return [Security.SecurityElement]::Escape($s)
    }

    function FileUri([string]$path) {
        if ([string]::IsNullOrWhiteSpace($path)) { return '' }
        if ($path -match '^file:') { return $path }
        try { return ([Uri]::new($path)).AbsoluteUri } catch { return '' }
    }

    # Active-conversation filtering happens in the host (reported by the client
    # composer dock); this script only renders the toast it is asked to show.

    $hasActions = ($OpenUri -ne '') -or (($AllowUri -ne '') -and ($DenyUri -ne ''))
    $actions = ''
    if ($OpenUri -ne '') {
        $actions = '<actions>' +
            '<action content="去处理" activationType="protocol" arguments="' + (Esc $OpenUri) + '" />' +
            '</actions>'
    } elseif ($hasActions) {
        $actions = '<actions>' +
            '<action content="允许一次" activationType="protocol" arguments="' + (Esc $AllowUri) + '" />' +
            '<action content="拒绝" activationType="protocol" arguments="' + (Esc $DenyUri) + '" />' +
            '</actions>'
    }

    $heroUri = FileUri $HeroPath
    $images = ''
    if ($heroUri -ne '') {
        $images += '<image placement="hero" src="' + (Esc $heroUri) + '" />'
    }

    # A toast needs at least one text node; an empty Title means "brand-only header,
    # straight to the details". Only fall back to a text line if everything is empty.
    $textXml = ''
    if ($Title -ne '') { $textXml += '<text>' + (Esc $Title) + '</text>' }
    if ($Body -ne '') { $textXml += '<text>' + (Esc $Body) + '</text>' }
    if ($textXml -eq '') { $textXml = '<text>DeepSeek Harness</text>' }

    $tagXml = if ($Tag -ne '') { ' tag="' + (Esc $Tag) + '"' } else { '' }
    $groupXml = ' group="dsh-approval"'

    $xml = '<toast' + $tagXml + $groupXml + '><visual><binding template="ToastGeneric">' +
        $textXml +
        $images +
        '</binding></visual>' + $actions + '</toast>'

    Write-NotifyLog ('XML hasActions=' + [bool]$hasActions + ' tag=' + $Tag + ' titleLen=' + $Title.Length)
    $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml($xml)
    $toast = New-Object Windows.UI.Notifications.ToastNotification $doc
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid).Show($toast)
    Write-NotifyLog 'SHOWN ok'
} catch {
    Write-NotifyLog ('ERROR ' + $_.Exception.GetType().FullName + ': ' + $_.Exception.Message)
    exit 4
}