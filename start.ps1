# Builds the web client and serves the whole app from one Python server on port 8000.
$ErrorActionPreference = 'Stop'

Push-Location "$PSScriptRoot\client"
try {
    if (-not (Test-Path node_modules)) { npm install; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
    npm run build
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally { Pop-Location }

Push-Location "$PSScriptRoot\server"
try {
    if (-not (Test-Path .venv)) {
        py -m venv .venv
        .\.venv\Scripts\python -m pip install -r requirements.txt
    }
    if (-not (Test-Path .env)) { Copy-Item .env.example .env }
    Write-Host "Stem Guess running at http://localhost:8000 (Ctrl+C to stop)"
    .\.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
} finally { Pop-Location }
