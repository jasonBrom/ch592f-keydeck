# Uses Python paired BLE when available; otherwise serves the static console.
# Both servers listen on loopback only. Does not alter system policy.
$ErrorActionPreference = 'Stop'
$consolePython = Get-Command python.exe -ErrorAction SilentlyContinue
if ($consolePython -and $consolePython.Source -notmatch 'WindowsApps') {
 & $consolePython.Source (Join-Path $PSScriptRoot 'start-console.py') --install-bluetooth
 exit $LASTEXITCODE
}
$consoleRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'public'))
$consoleListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 8792)
try { $consoleListener.Start() } catch { Write-Host 'Port 8792 is occupied. Close the previous console window and retry.'; Read-Host 'Enter to close'; exit 1 }
$consoleMime = @{'.html'='text/html; charset=utf-8';'.css'='text/css; charset=utf-8';'.js'='text/javascript; charset=utf-8';'.json'='application/json';'.svg'='image/svg+xml';'.png'='image/png';'.pdf'='application/pdf';'.zip'='application/zip';'.md'='text/plain; charset=utf-8'}
Write-Host 'C5 Console: http://localhost:8792/'
Write-Host 'Keep this window open. Ctrl+C stops the local server.'
Start-Process 'http://localhost:8792/'
try {
 while ($true) {
  $consoleClient = $consoleListener.AcceptTcpClient()
  try {
   $consoleStream = $consoleClient.GetStream(); $consoleStream.ReadTimeout = 3000
   $consoleHeader = [Collections.Generic.List[byte]]::new()
   while ($consoleHeader.Count -lt 16384) {
    $consoleByte = $consoleStream.ReadByte(); if ($consoleByte -lt 0) { break }
    $consoleHeader.Add([byte]$consoleByte)
    $n = $consoleHeader.Count
    if ($n -ge 4 -and $consoleHeader[$n-4] -eq 13 -and $consoleHeader[$n-3] -eq 10 -and $consoleHeader[$n-2] -eq 13 -and $consoleHeader[$n-1] -eq 10) { break }
   }
   $consoleLine = ([Text.Encoding]::ASCII.GetString($consoleHeader.ToArray()) -split "`r`n")[0] -split ' '
   if ($consoleLine.Count -lt 2) { continue }
   $consoleMethod = $consoleLine[0]
   $consolePath = [Uri]::UnescapeDataString(($consoleLine[1] -split '\?')[0]).TrimStart('/')
   if (!$consolePath) { $consolePath = 'index.html' }
   $consoleFull = [IO.Path]::GetFullPath((Join-Path $consoleRoot $consolePath))
   $consoleValid = $consoleFull.StartsWith($consoleRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($consoleFull) -and ($consoleMethod -eq 'GET' -or $consoleMethod -eq 'HEAD')
   if (!$consoleValid) {
    $consoleBody = [Text.Encoding]::UTF8.GetBytes('Not found')
    $consoleResponse = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 404 Not Found`r`nContent-Length: $($consoleBody.Length)`r`nConnection: close`r`n`r`n")
    $consoleStream.Write($consoleResponse,0,$consoleResponse.Length); $consoleStream.Write($consoleBody,0,$consoleBody.Length)
    continue
   }
   $consoleType = $consoleMime[[IO.Path]::GetExtension($consoleFull).ToLowerInvariant()]
   if (!$consoleType) { $consoleType = 'application/octet-stream' }
   $consoleFile = [IO.File]::OpenRead($consoleFull)
   try {
    $consoleResponse = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 200 OK`r`nContent-Type: $consoleType`r`nContent-Length: $($consoleFile.Length)`r`nCache-Control: no-cache`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n")
    $consoleStream.Write($consoleResponse,0,$consoleResponse.Length)
    if ($consoleMethod -eq 'GET') { $consoleFile.CopyTo($consoleStream) }
   } finally { $consoleFile.Dispose() }
  } catch { Write-Host ('Request ended: ' + $_.Exception.Message) }
  finally { $consoleClient.Close() }
 }
} finally { $consoleListener.Stop() }
