# ============================================================================
#  Local preview server for COLDSTART.
#
#  Run it by right-clicking this file -> "Run with PowerShell", or from a
#  terminal in this folder:   pwsh -File serve.ps1
#  Then open http://localhost:4322 in a browser. Ctrl+C stops it.
#
#  Why this exists: service workers and IndexedDB need the app served over
#  http(s), not opened as a file:// path. Node and Python are not installed
#  on this machine, so this is a small web server written in PowerShell.
# ============================================================================
param(
  [string]$Root = $PSScriptRoot,
  [int]$Port = 4322
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path

$mime = @{
  ".html"="text/html; charset=utf-8"; ".htm"="text/html; charset=utf-8"
  ".css"="text/css; charset=utf-8";   ".js"="application/javascript; charset=utf-8"
  ".json"="application/json; charset=utf-8"; ".webmanifest"="application/manifest+json; charset=utf-8"
  ".md"="text/plain; charset=utf-8"
  ".png"="image/png"; ".jpg"="image/jpeg"; ".jpeg"="image/jpeg"; ".gif"="image/gif"
  ".svg"="image/svg+xml"; ".webp"="image/webp"; ".ico"="image/x-icon"
  ".woff"="font/woff"; ".woff2"="font/woff2"; ".ttf"="font/ttf"; ".otf"="font/otf"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $Root at http://localhost:$Port/"

while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    $path = if ($rel -eq "") { Join-Path $Root "index.html" } else { Join-Path $Root ($rel -replace '/', '\') }

    if (Test-Path -LiteralPath $path -PathType Container) {
      $path = Join-Path $path "index.html"
    }

    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { "application/octet-stream" }
      $res.Headers.Add("Cache-Control", "no-store")
      if ($path -like "*manifest.json") { $res.Headers.Add("Service-Worker-Allowed", "/") }
      $bytes = [IO.File]::ReadAllBytes($path)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes("404 - not found: /$rel")
      $res.ContentType = "text/plain; charset=utf-8"
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    $res.Close()
  } catch {
    Write-Host "ERR: $_"
    try { $ctx.Response.Close() } catch {}
  }
}
