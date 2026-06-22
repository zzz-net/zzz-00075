# ============================================================
# Reproduction Cases: License Hard Block
# ============================================================

param(
    [string]$WorkDir = "d:\workSpace\AI__SPACE\zzz-00075"
)

Set-Location $WorkDir
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host ""; Write-Host ("=== " + $msg + " ===") -ForegroundColor Cyan }
function Write-OK($msg)  { Write-Host ("  [OK] " + $msg) -ForegroundColor Green }
function Write-Fail($msg){ Write-Host ("  [FAIL] " + $msg) -ForegroundColor Red; exit 1 }

Write-Step "0. Cleanup"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Remove-Item -Force exported-*.json -ErrorAction SilentlyContinue
Write-OK "Cleaned"

# ============================================================
# CASE 1: submit --skip-verify cannot bypass license
# ============================================================
Write-Step "CASE 1: submit --skip-verify should BLOCK MIT when only Apache-2.0 allowed"

& npm run dev -- init 2>&1 | Out-Null
& npm run dev -- config set-license --allow Apache-2.0 2>&1 | Out-Null
Write-OK "Rules: only Apache-2.0 allowed"

& npm run dev -- scan sample-data --by tester 2>&1 | Out-Null
Write-OK "Scanned sample-data (contains MIT license)"

$out1 = (& npm run dev -- submit --skip-verify 2>&1)
$case1Blocked = ($out1 -join "`n") -match "HARD BLOCK"
$case1Exit = $LASTEXITCODE

if (-not $case1Blocked) { Write-Fail "CASE1: HARD BLOCK message missing" }
if ($case1Exit -eq 0)      { Write-Fail "CASE1: should exit non-zero but got 0" }
Write-OK ("CASE1: --skip-verify blocked, exit=" + $case1Exit)

$statusCounts = (& npm run dev -- status counts 2>&1 | Out-String)
$pendingCount = [regex]::Match($statusCounts, "PENDING:\s+(\d+)").Groups[1].Value
if ($pendingCount -ne "0") { Write-Fail ("CASE1: status leaked - pending=" + $pendingCount) }
$draftCount = [regex]::Match($statusCounts, "DRAFT:\s+(\d+)").Groups[1].Value
if ($draftCount -ne "1")   { Write-Fail ("CASE1: status leaked - draft=" + $draftCount) }
Write-OK ("CASE1: status unchanged draft=" + $draftCount + " pending=" + $pendingCount)

# ============================================================
# CASE 2: publish --force cannot bypass license
# ============================================================
Write-Step "CASE 2: publish --force should BLOCK MIT when only Apache-2.0 allowed"

Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
& npm run dev -- init 2>&1 | Out-Null
& npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
& npm run dev -- scan sample-data --by tester 2>&1 | Out-Null
& npm run dev -- submit --by tester 2>&1 | Out-Null
$statusAll1 = (& npm run dev -- status all 2>&1 | Out-String)
$v1Match = [regex]::Match($statusAll1, "ID:\s+(v[\d-]+[a-f0-9]+)")
$V1_ID = $v1Match.Groups[1].Value
& npm run dev -- publish $V1_ID --approver boss --comment "baseline v1" 2>&1 | Out-Null
Write-OK ("Published v1 " + $V1_ID + " with relaxed rules")

& npm run dev -- config set-license --allow Apache-2.0 2>&1 | Out-Null
Write-OK "Rules tightened: only Apache-2.0 allowed now"

& npm run dev -- scan sample-data --by tester 2>&1 | Out-Null

$injector = @"
const fs = require('fs');
const p = process.cwd() + '/.dataset/state.json';
const s = JSON.parse(fs.readFileSync(p,'utf8'));
const drafts = Object.values(s.versions).filter(v => v.status === 'draft').sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
if (drafts.length > 0) {
  const d = drafts[0];
  d.status = 'pending_approval';
  d.updatedAt = new Date().toISOString();
  s.stateHistory.push({id:'inject-'+Date.now(),versionId:d.id,fromStatus:'draft',toStatus:'pending_approval',timestamp:new Date().toISOString(),actor:'TEST_INJECT',reason:'Inject pending to test publish force'});
  fs.writeFileSync(p, JSON.stringify(s,null,2));
  const vp = process.cwd() + '/.dataset/versions/' + d.id + '.json';
  fs.writeFileSync(vp, JSON.stringify(d,null,2));
  console.log(d.id);
}
"@
$injectOutput = node -e $injector
$PENDING_ID = $injectOutput.Trim()
Write-OK ("Injected pending via test harness: " + $PENDING_ID)

$out2 = (& npm run dev -- publish $PENDING_ID --approver boss --comment "trying force" --force 2>&1)
$case2Blocked = ($out2 -join "`n") -match "HARD BLOCK"
$case2Exit = $LASTEXITCODE

if (-not $case2Blocked) { Write-Fail "CASE2: HARD BLOCK message missing" }
if ($case2Exit -eq 0)      { Write-Fail "CASE2: should exit non-zero but got 0" }
Write-OK ("CASE2: --force blocked, exit=" + $case2Exit)

$statusCur = (& npm run dev -- status current 2>&1 | Out-String)
$curVerMatch = [regex]::Match($statusCur, "ID:\s+(v[\d-]+[a-f0-9]+)")
$CUR_ID = $curVerMatch.Groups[1].Value
if ($CUR_ID -ne $V1_ID) { Write-Fail ("CASE2: currentVersion leaked! got=" + $CUR_ID + " expected=" + $V1_ID) }
Write-OK ("CASE2: currentVersion unchanged: " + $CUR_ID)

$hist = (& npm run dev -- history all 2>&1 | Out-String)
if ($hist -match ("PENDING.*PUBLISHED.*" + $PENDING_ID)) { Write-Fail "CASE2: history contains leaked transition" }
Write-OK "CASE2: history clean"

# ============================================================
# CASE 3: publish --skip-verify cannot bypass license
# ============================================================
Write-Step "CASE 3: publish --skip-verify should BLOCK MIT when only Apache-2.0 allowed"

$out3 = (& npm run dev -- publish $PENDING_ID --approver boss --comment "trying skip-verify" --skip-verify 2>&1)
$case3Blocked = ($out3 -join "`n") -match "HARD BLOCK"
$case3Exit = $LASTEXITCODE

if (-not $case3Blocked) { Write-Fail "CASE3: HARD BLOCK message missing" }
if ($case3Exit -eq 0)      { Write-Fail "CASE3: should exit non-zero but got 0" }
Write-OK ("CASE3: --skip-verify blocked, exit=" + $case3Exit)

$statusCur3 = (& npm run dev -- status current 2>&1 | Out-String)
$curVerMatch3 = [regex]::Match($statusCur3, "ID:\s+(v[\d-]+[a-f0-9]+)")
$CUR_ID3 = $curVerMatch3.Groups[1].Value
if ($CUR_ID3 -ne $V1_ID) { Write-Fail "CASE3: currentVersion leaked" }
Write-OK ("CASE3: currentVersion still: " + $CUR_ID3)

# ============================================================
# SUMMARY
# ============================================================
Write-Step "ALL REPRODUCTION CASES PASSED"
Write-Host ""
Write-Host "  CASE1: submit --skip-verify   ->  BLOCKED by HARD BLOCK" -ForegroundColor Green
Write-Host "  CASE2: publish --force        ->  BLOCKED by HARD BLOCK" -ForegroundColor Green
Write-Host "  CASE3: publish --skip-verify  ->  BLOCKED by HARD BLOCK" -ForegroundColor Green
Write-Host ""
Write-Host "  Invariants:" -ForegroundColor Gray
Write-Host "   - Exit code non-zero on hard block" -ForegroundColor Gray
Write-Host "   - Status counters correct (no leak)" -ForegroundColor Gray
Write-Host "   - currentVersion not mutated on fail" -ForegroundColor Gray
Write-Host "   - History has no unauthorized transitions" -ForegroundColor Gray
Write-Host ""
