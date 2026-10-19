$ErrorActionPreference = 'Stop'
$deployment = if ($env:INHERITI_BUILD_DEPLOYMENT) { $env:INHERITI_BUILD_DEPLOYMENT } else { 'local' }
if ($deployment -notin @('local', 'dev', 'stg', 'prod')) { throw 'Invalid Workspace deployment' }
$env:TAURI_CONFIG = @{ identifier = "com.safetech.inheriti.workspace.$deployment" } | ConvertTo-Json -Compress
$workspace = Resolve-Path (Join-Path $PSScriptRoot '..')
$tauri = Join-Path $workspace 'src-tauri'
$release = Join-Path $tauri 'target/release'
$target = (rustc -vV | Select-String '^host: (.+)$').Matches.Groups[1].Value
if (-not $target) { throw 'Rust host target unavailable' }
if ($target -notmatch '^(x86_64|aarch64)-pc-windows-msvc$') { throw "Unsupported Windows package target: $target" }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeMajor = [int]((& $node --version) -replace '^v([0-9]+).*$', '$1')
if ($nodeMajor -lt 22) { throw 'Node.js 22 or newer is required' }
$nodeLicense = Join-Path (Split-Path $node -Parent) 'LICENSE'
if (-not (Test-Path $nodeLicense)) { throw 'Node.js license unavailable' }

Push-Location $workspace
try {
    pnpm build:host
    if ($LASTEXITCODE -ne 0) { throw 'Workspace host build failed' }
    node scripts/stage-workspace-vm.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Workspace VM bundle invalid or unavailable' }
    foreach ($resource in @('dist/host.cjs', 'dist/node_modules', 'src-tauri/workspace-vm/manifest.sha256.json')) {
        if (-not (Test-Path (Join-Path $workspace $resource))) { throw "Missing Workspace bundle resource: $resource" }
    }
} finally {
    Pop-Location
}

Push-Location $tauri
try {
    cargo build --release --bin inheriti-workspace --bin preview-helper
    if ($LASTEXITCODE -ne 0) { throw 'Workspace build failed' }

    $source = Join-Path $tauri 'native/windows/preview-broker.cpp'
    $broker = Join-Path $release 'preview-broker.exe'
    & cl.exe /nologo /std:c++17 /EHsc /O2 $source "/Fo:$(Join-Path $release 'preview-broker.obj')" "/Fe:$broker" /link userenv.lib advapi32.lib
    if ($LASTEXITCODE -ne 0) { throw 'Preview broker build failed' }

    foreach ($name in @('inheriti-workspace.exe', 'preview-helper.exe', 'preview-broker.exe')) {
        if (-not (Test-Path (Join-Path $release $name))) { throw "Missing Windows sidecar: $name" }
    }

    $binaries = Join-Path $tauri 'binaries'
    New-Item -ItemType Directory -Force $binaries | Out-Null
    Copy-Item (Join-Path $release 'preview-helper.exe') (Join-Path $binaries "preview-helper-$target.exe") -Force
    Copy-Item $broker (Join-Path $binaries "preview-broker-$target.exe") -Force
    Copy-Item $node (Join-Path $binaries "node-$target.exe") -Force
    Copy-Item $nodeLicense (Join-Path $binaries 'NODE-LICENSE') -Force

    $config = @{
        identifier = "com.safetech.inheriti.workspace.$deployment"
        bundle = @{
            active = $true
            externalBin = @('binaries/preview-helper', 'binaries/preview-broker')
            resources = @{
                '../dist/host.cjs' = 'host.cjs'
                '../dist/node_modules' = 'node_modules'
                "binaries/node-$target.exe" = 'node.exe'
                'binaries/NODE-LICENSE' = 'NODE-LICENSE'
                'workspace-vm/' = 'workspace-vm/'
            }
        }
    } | ConvertTo-Json -Depth 5 -Compress
    $bundleStarted = (Get-Date).ToUniversalTime()
    cargo tauri build --bundles nsis --ci --config $config
    if ($LASTEXITCODE -ne 0) { throw 'Workspace installer build failed' }
    $nsis = Join-Path $release 'bundle/nsis'
    $installers = @(Get-ChildItem $nsis -Filter '*.exe' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTimeUtc -ge $bundleStarted.AddSeconds(-2) })
    if ($installers.Count -eq 0) { throw 'Workspace NSIS installer unavailable' }
} finally {
    Pop-Location
}
