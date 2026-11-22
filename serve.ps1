# serve.ps1 — tiny static file server for the History Atlas (no dependencies).
# Also accepts POST /api/save to persist editor changes to data_overrides.json.
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [port]
param([int]$Port = 8123)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "History Atlas served at http://localhost:$Port/  (Ctrl+C to stop)"

$types = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8';
  '.css'='text/css; charset=utf-8';   '.jpg'='image/jpeg'; '.jpeg'='image/jpeg';
  '.png'='image/png'; '.svg'='image/svg+xml'; '.json'='application/json'; '.ico'='image/x-icon';
  '.webmanifest'='application/manifest+json'
}

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $req = $ctx.Request; $res = $ctx.Response
  try {
    # ── POST /api/save — editor persistence ─────────────────────
    if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -eq '/api/save') {
      # Writes are same-origin only: a web page open in any browser must not be
      # able to POST here cross-site (CSRF) or via DNS rebinding while the
      # atlas runs locally. Non-browser local tools send no Origin/Referer.
      $hosts = @("localhost:$Port", "127.0.0.1:$Port", "[::1]:$Port")
      $origins = $hosts | ForEach-Object { "http://$_" }
      $origin = $req.Headers['Origin']
      $referer = $req.Headers['Referer']
      $sameOrigin =
        ((-not $origin)   -or ($origins -contains $origin)) -and
        ((-not $referer)  -or ($null -ne ($origins | Where-Object { $referer.StartsWith($_ + '/') }))) -and
        ($hosts -contains $req.UserHostName)
      if (-not $sameOrigin) { $res.StatusCode = 403 }
      elseif ($req.ContentLength64 -gt 5242880) { $res.StatusCode = 413 }   # 5 MB cap
      if ($res.StatusCode -ge 400) {
        $bytes = [Text.Encoding]::UTF8.GetBytes('forbidden')
        $res.ContentType = 'text/plain'
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
        continue
      }
      $reader = New-Object IO.StreamReader($req.InputStream, $req.ContentEncoding)
      $body = $reader.ReadToEnd()
      $ok = $false
      try {
        $json = $body | ConvertFrom-Json
        if ($null -ne $json) {
          [IO.File]::WriteAllText((Join-Path $root 'data_overrides.json'), $body)
          $ok = $true
        }
      } catch { $ok = $false }
      $res.StatusCode = if ($ok) { 200 } else { 400 }
      $res.ContentType = 'application/json'
      $bytes = [Text.Encoding]::UTF8.GetBytes(('{"ok":' + ($ok.ToString().ToLower()) + '}'))
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      continue
    }

    # ── static files ────────────────────────────────────────────
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    if ($path -eq '/') { $path = '/index.html' }
    $file = Join-Path $root ($path -replace '/', '\')
    $full = [IO.Path]::GetFullPath($file)
    # separator in the check so a sibling dir like "history_map_evil" can't pass
    if (-not ($full.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) -or -not (Test-Path $full -PathType Leaf)) {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('404')
    } else {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      # tiles never change -> cache forever; everything else revalidates
      if ($path -like '/world_map/tiles/*') {
        $res.Headers['Cache-Control'] = 'public, max-age=31536000, immutable'
      } else {
        $res.Headers['Cache-Control'] = 'no-cache'
      }
      $bytes = [IO.File]::ReadAllBytes($full)
    }
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    try { $res.StatusCode = 500 } catch {}
  } finally { try { $res.Close() } catch {} }
}
