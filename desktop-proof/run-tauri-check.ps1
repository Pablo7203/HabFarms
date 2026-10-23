$ErrorActionPreference = 'Stop'
$vc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.44.35207'
$sdk = 'C:\Program Files (x86)\Windows Kits\10'
$env:LIB = "$vc\lib\x64;$sdk\Lib\10.0.22621.0\um\x64;$sdk\Lib\10.0.22621.0\ucrt\x64"
$env:INCLUDE = "$vc\include;$sdk\Include\10.0.22621.0\um;$sdk\Include\10.0.22621.0\ucrt;$sdk\Include\10.0.22621.0\shared"
$env:OPENSSL_DIR = 'C:\Program Files\PostgreSQL\18'
$env:OPENSSL_LIB_DIR = 'C:\Program Files\PostgreSQL\18\lib'
$env:OPENSSL_INCLUDE_DIR = 'C:\Program Files\PostgreSQL\18\include'
$env:OPENSSL_NO_VENDOR = '1'
$env:Path = "C:\Program Files\PostgreSQL\18\bin;$vc\bin\Hostx64\x64;$sdk\bin\10.0.22621.0\x64;" + $env:Path
cargo check --manifest-path "$PSScriptRoot\shell\src-tauri\Cargo.toml"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
