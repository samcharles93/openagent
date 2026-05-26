# copilot-oa.ps1: Run GitHub Copilot CLI via Node.js for full SDK extension support.
#
# The native Copilot binary uses itself as process.execPath, which breaks
# child_process.fork() when launching SDK extensions. Running via Node keeps
# process.execPath pointing at the Node binary, allowing fork() to work.
#
# Requires: node >= 24, @github/copilot installed via npm

$ErrorActionPreference = 'Stop'

$CopilotJS = $null

# 1. %USERPROFILE%\.copilot\pkg\win-x64\<version>\index.js — native binary's own JS,
#    always in sync with whatever version `copilot update` installed.
$PkgBase = Join-Path $env:USERPROFILE '.copilot\pkg\win-x64'
if (Test-Path $PkgBase) {
    $Latest = Get-ChildItem -Directory $PkgBase |
        Sort-Object { [version]($_.Name -replace '[^0-9.]', '') } |
        Select-Object -Last 1
    if ($Latest) {
        $Candidate = Join-Path $Latest.FullName 'index.js'
        if (Test-Path $Candidate) { $CopilotJS = $Candidate }
    }
}

# 2. npm global root
if (-not $CopilotJS) {
    $NpmRoot = $null
    try { $NpmRoot = (npm root -g 2>$null) } catch {}
    if ($NpmRoot -and (Test-Path (Join-Path $NpmRoot '@github/copilot/index.js'))) {
        $CopilotJS = Join-Path $NpmRoot '@github/copilot/index.js'
    }
}

# 3. Common npm global install locations
if (-not $CopilotJS) {
    $Candidates = @(
        (Join-Path $env:APPDATA 'npm/node_modules/@github/copilot/index.js'),
        (Join-Path $env:LOCALAPPDATA 'npm-global/node_modules/@github/copilot/index.js')
    )
    foreach ($Candidate in $Candidates) {
        if (Test-Path $Candidate) {
            $CopilotJS = $Candidate
            break
        }
    }
}

if (-not $CopilotJS) {
    Write-Error "Could not find Copilot CLI JS entry point. Run copilot once to populate ~/.copilot/pkg/, or install via: npm install -g @github/copilot"
    exit 1
}

$NodeMajor = [int](node -e "process.stdout.write(process.versions.node.split('.')[0])")
if ($NodeMajor -lt 24) {
    Write-Error "Copilot CLI JS mode requires Node.js >= 24 (found v$(node --version))."
    exit 1
}

& node $CopilotJS @args
