$ErrorActionPreference = "Continue"
Set-Location "D:\selfimpulse"
function Step($n) { "=== $n ===" }

Step "1/6 derived engine artifacts"
node tools/build-host.mjs
Step "2/6 mcp engine bundle"
node tools/build-mcp.mjs
Step "3/6 offline verify pack"
node tools/build-offline-verify.mjs
Step "4/6 certified gate"
node tools/rebuild-pack.mjs
if ($LASTEXITCODE -ne 0) { "GATE FAILED ($LASTEXITCODE) - stopping, NOT packaging"; exit 1 }
Step "5/6 electron package"
Remove-Item "D:\selfimpulse\release\electron" -Recurse -Force -ErrorAction SilentlyContinue
node node_modules\electron-builder\cli.js --win nsis portable
if ($LASTEXITCODE -ne 0) { "PACKAGE FAILED ($LASTEXITCODE)"; exit 1 }
Step "6/6 install"
$un = "C:\Users\HARSHEN\AppData\Local\Programs\SelfImpulse\Uninstall SelfImpulse.exe"
if (Test-Path $un) { (Start-Process $un -ArgumentList "/S" -Wait -PassThru) | Out-Null }
Start-Sleep -Seconds 3
Remove-Item "C:\Users\HARSHEN\AppData\Local\Programs\SelfImpulse" -Recurse -Force -ErrorAction SilentlyContinue
(Start-Process "D:\selfimpulse\release\electron\SelfImpulse-1.9.2-setup.exe" -ArgumentList "/S" -Wait -PassThru) | Out-Null
Start-Sleep -Seconds 4
"INSTALL OK: " + (Test-Path "C:\Users\HARSHEN\AppData\Local\Programs\SelfImpulse\SelfImpulse.exe")
"ALL DONE"