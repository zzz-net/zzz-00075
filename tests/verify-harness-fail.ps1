# Verify: test harness correctly reports FAIL when assertions fail
param([string]$WorkDir = "d:\workSpace\AI__SPACE\zzz-00075")
Set-Location $WorkDir
$ErrorActionPreference = "Continue"

$script:anyFailed = $false
$script:currentSceneFailed = $false
$script:sceneResults = @{}

function Step($msg) { Write-Host ""; Write-Host ("=== " + $msg + " ===") -ForegroundColor Cyan }
function OK($msg)   { Write-Host ("  [OK] " + $msg) -ForegroundColor Green }
function FAIL($msg) {
    Write-Host ("  [FAIL] " + $msg) -ForegroundColor Red
    $script:anyFailed = $true
    $script:currentSceneFailed = $true
}
function REQ($cond, $msg) { if (-not $cond) { FAIL $msg } else { OK $msg } }
function Start-Scene($n) { $script:currentSceneFailed = $false; $script:sceneResults[$n] = $false }
function End-Scene($n) {
    $script:sceneResults[$n] = -not $script:currentSceneFailed
    if ($script:currentSceneFailed) { Write-Host ("  [SCENE FAILED] " + $n) -ForegroundColor Red }
    else { Write-Host ("  [SCENE PASSED] " + $n) -ForegroundColor Green }
}

# ---- SCENE A: should PASS ----
Start-Scene "A"
Step "Scene A (should PASS)"
REQ ($true) "true assertion"
REQ (1 -eq 1) "1==1"
End-Scene "A"

# ---- SCENE B: should FAIL ----
Start-Scene "B"
Step "Scene B (should FAIL)"
REQ ($true) "true assertion first"
REQ ($false) "false assertion - this MUST be reported as FAIL"
REQ (1 -eq 2) "1==2 - this MUST also FAIL"
End-Scene "B"

# ---- SCENE C: should PASS ----
Start-Scene "C"
Step "Scene C (should PASS)"
REQ ("hello" -eq "hello") "string equality"
End-Scene "C"

# ---- SUMMARY ----
Step "SUMMARY"
$labels = [ordered]@{ "A" = "Scene A (intentionally pass)"; "B" = "Scene B (intentionally FAIL)"; "C" = "Scene C (intentionally pass)" }
$pass = 0; $fail = 0
foreach ($k in $labels.Keys) {
    if ($script:sceneResults[$k] -eq $true) {
        Write-Host ("  PASS  " + $k + "  " + $labels[$k]) -ForegroundColor Green
        $pass++
    } else {
        Write-Host ("  FAIL  " + $k + "  " + $labels[$k]) -ForegroundColor Red
        $fail++
    }
}
Write-Host ""
Write-Host ("  Total: {0} passed, {1} failed out of {2}" -f $pass, $fail, $labels.Count) -ForegroundColor Cyan
Write-Host ""

# ---- VALIDATE HARNESS ----
Step "HARNESS SELF-CHECK"
$harnessOk = $true
if (-not $script:sceneResults["A"]) { Write-Host "  [HARNESS BUG] A should pass but sceneResults[A]=$($script:sceneResults["A"])" -ForegroundColor Red; $harnessOk = $false }
if ($script:sceneResults["B"]) { Write-Host "  [HARNESS BUG] B should fail but sceneResults[B]=$($script:sceneResults["B"])" -ForegroundColor Red; $harnessOk = $false }
if (-not $script:sceneResults["C"]) { Write-Host "  [HARNESS BUG] C should pass but sceneResults[C]=$($script:sceneResults["C"])" -ForegroundColor Red; $harnessOk = $false }
if (-not $script:anyFailed) { Write-Host "  [HARNESS BUG] anyFailed should be true" -ForegroundColor Red; $harnessOk = $false }
if ($pass -ne 2) { Write-Host "  [HARNESS BUG] pass count should be 2, got $pass" -ForegroundColor Red; $harnessOk = $false }
if ($fail -ne 1) { Write-Host "  [HARNESS BUG] fail count should be 1, got $fail" -ForegroundColor Red; $harnessOk = $false }
if ($harnessOk) { Write-Host "  [OK] Harness correctly reports pass/fail. Exit code will be 1 because B failed." -ForegroundColor Green }

if (-not $script:anyFailed) { Write-Host "  EXIT CODE: 0" -ForegroundColor Green; exit 0 }
else { Write-Host "  EXIT CODE: 1" -ForegroundColor Red; exit 1 }
