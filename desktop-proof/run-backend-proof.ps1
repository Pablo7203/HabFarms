$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$scratch = Join-Path $env:TEMP 'habfarms-phase05-status'
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
$cli = Join-Path $repo 'node_modules\.bin\supabase.cmd'
$status = & $cli status --workdir $scratch --output json 2>$null | ConvertFrom-Json
if ($status.API_URL -ne 'http://127.0.0.1:60421') { throw 'Isolated local backend is unavailable' }
$env:LOCAL_API_URL = $status.API_URL
$env:LOCAL_ANON_KEY = $status.ANON_KEY
$env:LOCAL_SERVICE_KEY = $status.SERVICE_ROLE_KEY
$env:HABFARMS_NODE_MODULES = (Resolve-Path (Join-Path $repo 'node_modules')).Path
$env:PROOF_LOCAL_EXE = (Resolve-Path (Join-Path $PSScriptRoot 'local-core\target\debug\examples\lost_ack.exe')).Path
$env:Path = 'C:\Program Files\PostgreSQL\18\bin;' + $env:Path
node (Join-Path $PSScriptRoot 'backend-proof.cjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
