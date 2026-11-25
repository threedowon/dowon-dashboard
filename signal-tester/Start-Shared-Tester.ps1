param([string]$WorkspacePath)
$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'SignalTester\shared'
$exePath = Join-Path $installRoot 'SignalTester.exe'
try {
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    if (-not (Test-Path -LiteralPath $exePath)) {
        Write-Host 'Installing the shared Signal Tester (Python is not required)...'
        $manifest = Invoke-RestMethod 'https://github.com/threedowon/dowon-dashboard/releases/latest/download/update.json'
        if ($manifest.tag_name -notmatch '^signal-tester-v(\d+\.\d+\.\d+)$' -or [version]$Matches[1] -lt [version]'1.4.0') { throw 'Signal Tester v1.4.0 or newer is required.' }
        $asset = @($manifest.assets | Where-Object { $_.name -eq 'SignalTester.exe' })
        if ($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:([a-f0-9]{64})$') { throw 'Invalid download checksum.' }
        $expectedHash = $Matches[1]
        $expectedUrl = 'https://github.com/threedowon/dowon-dashboard/releases/download/' + $manifest.tag_name + '/SignalTester.exe'
        if ($asset[0].browser_download_url -ne $expectedUrl) { throw 'Unexpected download location.' }
        $temporaryExe = Join-Path $installRoot ('download-' + [guid]::NewGuid().ToString('N') + '.tmp')
        Invoke-WebRequest -UseBasicParsing -Uri $expectedUrl -OutFile $temporaryExe
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $actualHash = ([BitConverter]::ToString($hasher.ComputeHash([IO.File]::ReadAllBytes($temporaryExe)))).Replace('-', '').ToLower() }
        finally { $hasher.Dispose() }
        if ($actualHash -ne $expectedHash) { throw 'Download checksum does not match. Run again to retry.' }
        Move-Item -LiteralPath $temporaryExe -Destination $exePath
    }
    $launchArguments = @('--web-ui')
    if ($WorkspacePath) {
        $resolvedWorkspace = [IO.Path]::GetFullPath($WorkspacePath)
        $launchArguments += @('--config', ('"' + $resolvedWorkspace + '"'))
    }
    Start-Process -FilePath $exePath -ArgumentList $launchArguments -WindowStyle Hidden
    Write-Host 'Signal Tester started. In the web page, connect this PC and allow the connection.'
} catch {
    Write-Error $_
    exit 1
}
