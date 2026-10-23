$ErrorActionPreference = 'Stop'
$vc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207'
$sdk = 'C:\Program Files (x86)\Windows Kits\10'
$env:LIB = "$vc\lib\x64;$sdk\Lib\10.0.22621.0\um\x64;$sdk\Lib\10.0.22621.0\ucrt\x64"
$env:INCLUDE = "$vc\include;$sdk\Include\10.0.22621.0\um;$sdk\Include\10.0.22621.0\ucrt;$sdk\Include\10.0.22621.0\shared"
$openssl = 'C:\Program Files\PostgreSQL\18'
$env:OPENSSL_DIR = $openssl
$env:OPENSSL_LIB_DIR = "$openssl\lib"
$env:OPENSSL_INCLUDE_DIR = "$openssl\include"
$env:OPENSSL_NO_VENDOR = '1'
$env:Path = "$openssl\bin;$vc\bin\Hostx64\x64;$sdk\bin\10.0.22621.0\x64;" + $env:Path
Push-Location $PSScriptRoot
try { npm run tauri:build } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$release = Join-Path $PSScriptRoot 'src-tauri\target\release'
Copy-Item -LiteralPath "$openssl\bin\libcrypto-3-x64.dll" -Destination $release -Force
Copy-Item -LiteralPath "$openssl\bin\libssl-3-x64.dll" -Destination $release -Force
