$ErrorActionPreference = 'Stop'
$app = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $app '..\..')).Path
$scratch = Join-Path $env:TEMP 'habfarms-phase1-status'
$scratchSupabase = Join-Path $scratch 'supabase'
New-Item -ItemType Directory -Path $scratchSupabase -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'supabase\templates') -Destination $scratchSupabase -Recurse -Force
$config = [IO.File]::ReadAllText((Join-Path $repo 'supabase\config.toml'))
$config = $config.Replace('project_id = "My_work"', 'project_id = "habfarms-desktop-proof-20261020"')
foreach ($pair in @(
  @('54321','60421'), @('54322','60422'), @('54320','60420'),
  @('54329','60429'), @('54323','60423'), @('54324','60424'),
  @('54327','60427'), @('8083','60883')
)) { $config = $config.Replace($pair[0], $pair[1]) }
[IO.File]::WriteAllText((Join-Path $scratchSupabase 'config.toml'), $config)
$status = & (Join-Path $repo 'node_modules\.bin\supabase.cmd') status --workdir $scratch --output json 2>$null | ConvertFrom-Json
if ($status.API_URL -ne 'http://127.0.0.1:60421') { throw 'The isolated local Supabase project is unavailable.' }
$env:LOCAL_API_URL = $status.API_URL
$env:LOCAL_ANON_KEY = $status.ANON_KEY
$env:HABFARMS_NODE_MODULES = (Resolve-Path (Join-Path $repo 'node_modules')).Path
$envText = "VITE_SUPABASE_URL=$($status.API_URL)`nVITE_SUPABASE_ANON_KEY=$($status.ANON_KEY)`nVITE_DESKTOP_BRIDGE_URL=http://127.0.0.1:61421`n"
[IO.File]::WriteAllText((Join-Path $app '.env.local'), $envText)
$vc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207'
$sdk = 'C:\Program Files (x86)\Windows Kits\10'
$env:LIB = "$vc\lib\x64;$sdk\Lib\10.0.22621.0\um\x64;$sdk\Lib\10.0.22621.0\ucrt\x64"
$env:INCLUDE = "$vc\include;$sdk\Include\10.0.22621.0\um;$sdk\Include\10.0.22621.0\ucrt;$sdk\Include\10.0.22621.0\shared"
$env:OPENSSL_DIR = 'C:\Program Files\PostgreSQL\18'
$env:OPENSSL_LIB_DIR = 'C:\Program Files\PostgreSQL\18\lib'
$env:OPENSSL_INCLUDE_DIR = 'C:\Program Files\PostgreSQL\18\include'
$env:OPENSSL_NO_VENDOR = '1'
$env:Path = "C:\Program Files\PostgreSQL\18\bin;$vc\bin\Hostx64\x64;$sdk\bin\10.0.22621.0\x64;" + $env:Path
$server = Join-Path $app 'dev-backend\server.cjs'
$node = (Get-Command node).Source
$bridge = Start-Process -FilePath $node -ArgumentList ('"' + $server + '"') -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 2
  if ($bridge.HasExited) { throw 'The local development bridge did not start.' }
  Push-Location $app
  try { npm run tauri:dev } finally { Pop-Location }
} finally {
  if (-not $bridge.HasExited) { Stop-Process -Id $bridge.Id }
}
