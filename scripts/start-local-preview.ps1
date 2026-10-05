$ErrorActionPreference = 'Stop'
$previewRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$previewScript = Join-Path $previewRoot 'scripts\run-framework.mjs'
$previewUrl = 'http://127.0.0.1:3001/'
$previewListener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
if ($previewListener) {
    $previewLockPath = Join-Path $previewRoot '.vinext\dev\lock.json'
    if (Test-Path -LiteralPath $previewLockPath) {
        $previewLock = Get-Content -LiteralPath $previewLockPath -Raw | ConvertFrom-Json
        if ($previewLock.cwd -eq $previewRoot -and $previewListener.OwningProcess -contains $previewLock.pid) {
            Write-Output "Project OS ya está abierto: $previewUrl"
            return
        }
    }
    throw 'El puerto 3001 está ocupado por otro proceso. No se ha detenido ni modificado.'
}
$previewNode = (Get-Command node -ErrorAction Stop).Source
$previewOutput = Join-Path $previewRoot 'outputs'
if (!(Test-Path -LiteralPath $previewOutput)) { New-Item -ItemType Directory -Path $previewOutput | Out-Null }
$previewProcess = Start-Process -FilePath $previewNode -ArgumentList @(('"' + $previewScript + '"'), 'preview', '--port', '3001') -WorkingDirectory $previewRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $previewOutput 'local-preview.stdout.log') -RedirectStandardError (Join-Path $previewOutput 'local-preview.stderr.log') -PassThru
for ($previewAttempt = 0; $previewAttempt -lt 60; $previewAttempt++) {
    $previewProcess.Refresh()
    if ($previewProcess.HasExited) { throw 'El servidor no pudo iniciar. Consulta outputs/local-preview.stderr.log.' }
    try {
        $previewResponse = Invoke-WebRequest -Uri ($previewUrl + 'api/state') -TimeoutSec 2
        if ($previewResponse.StatusCode -eq 200) {
            Write-Output "Project OS sin login: $previewUrl (PID $($previewProcess.Id))"
            return
        }
    } catch { }
    Start-Sleep -Milliseconds 250
}
throw "El servidor sigue iniciando (PID $($previewProcess.Id)). Consulta outputs/local-preview.stderr.log."
