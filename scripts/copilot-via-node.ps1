# copilot-oa.ps1: Run GitHub Copilot CLI via Node.js for full SDK extension support.
#
# The native Copilot binary uses itself as process.execPath, which breaks
# child_process.fork() when launching SDK extensions. Running via Node keeps
# process.execPath pointing at the Node binary, allowing fork() to work.
#
# Requires: node >= 24, @github/copilot installed via npm

$ErrorActionPreference = 'Stop'

$CopilotJS = $null

$NpmRoot = $null
try {
    $NpmRoot = (npm root -g 2>$null)
} catch {}

if ($NpmRoot -and (Test-Path (Join-Path $NpmRoot '@github/copilot/index.js'))) {
    $CopilotJS = Join-Path $NpmRoot '@github/copilot/index.js'
}

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
    Write-Error "Could not find @github/copilot npm package. Install it with: npm install -g @github/copilot"
    exit 1
}

$NodeMajor = [int](node -e "process.stdout.write(process.versions.node.split('.')[0])")
if ($NodeMajor -lt 24) {
    Write-Error "Copilot CLI JS mode requires Node.js >= 24 (found v$(node --version))."
    exit 1
}

& node $CopilotJS @args
