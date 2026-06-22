# ============================================================
# Dry-run + Consistency Automated Tests
# SCENARIO A: Config change / version switch / restart -> dry-run matches real submit/publish
# SCENARIO B: Dry-run JSON export -> publish -> rollback -> re-export -> key fields align
# ============================================================

param([string]$WorkDir = "d:\workSpace\AI__SPACE\zzz-00075")
Set-Location $WorkDir
$ErrorActionPreference = "Continue"

function Step($msg)   { Write-Host ""; Write-Host ("=== " + $msg + " ===") -ForegroundColor Cyan }
function OK($msg)     { Write-Host ("  [OK] " + $msg) -ForegroundColor Green }
function FAIL($msg)   { Write-Host ("  [FAIL] " + $msg) -ForegroundColor Red; $script:failed = $true }
function REQ($cond, $msg) { if (-not $cond) { FAIL $msg } else { OK $msg } }

$script:failed = $false

# ============================================================
# SCENARIO A: Config change / version switch / restart
# ============================================================
Step "A0. Cleanup and init"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Remove-Item -Force dryrun-*.json, export-*.json -ErrorAction SilentlyContinue
& npm run dev -- init *>&1 | Out-Null
& npm run dev -- config set-license --allow MIT Apache-2.0 *>&1 | Out-Null
& npm run dev -- scan sample-data --by alice *>&1 | Out-Null
OK "A0: init + scan done"

# --- A1: dry-run submit before real submit, compare blockedAt ---
Step "A1: dry-run submit vs real submit (both should pass)"
$drSubmit = & npm run dev -- dry-run submit --json dryrun-a1-submit.json *>&1 | Out-String
$dr1 = Get-Content dryrun-a1-submit.json -Raw | ConvertFrom-Json
REQ ($dr1.canSubmit -eq $true) "dry-run submit: canSubmit=true"
REQ ($dr1.blockedAt -eq "none") "dry-run submit: blockedAt=none"
REQ ($dr1.hardBlock.blocked -eq $false) "dry-run submit: hardBlock=false"
REQ ($dr1.ruleVersion) "dry-run submit: ruleVersion present ($($dr1.ruleVersion))"

& npm run dev -- submit --by alice *>&1 | Out-Null
REQ ($LASTEXITCODE -eq 0) "real submit: exit=0"
OK "A1: dry-run and real submit both pass"

# --- A2: dry-run publish vs real publish ---
Step "A2: dry-run publish vs real publish (both should pass)"
$drPub = & npm run dev -- dry-run publish --approver bob --comment "v1 ok" --json dryrun-a2-publish.json *>&1 | Out-String
$dr2 = Get-Content dryrun-a2-publish.json -Raw | ConvertFrom-Json
REQ ($dr2.canPublish -eq $true) "dry-run publish: canPublish=true"
REQ ($dr2.blockedAt -eq "none") "dry-run publish: blockedAt=none"
REQ ($dr2.currentPublishedVersionId -eq $null) "dry-run publish: no current published version (first publish)"
REQ ($dr2.currentPublishedWouldBeReplaced -eq $false) "dry-run publish: wouldBeReplaced=false (first)"

& npm run dev -- publish --approver bob --comment "v1 ok" *>&1 | Out-Null
REQ ($LASTEXITCODE -eq 0) "real publish: exit=0"
$V1_ID = $dr2.versionId
OK "A2: dry-run and real publish both pass"

# --- A3: Change config, new scan, dry-run should reflect new rules ---
Step "A3: Config change -> dry-run reflects new rules"
& npm run dev -- config set-license --allow Apache-2.0 *>&1 | Out-Null
& npm run dev -- scan sample-data --by alice *>&1 | Out-Null
$dr3out = & npm run dev -- dry-run submit --json dryrun-a3.json *>&1 | Out-String
$dr3 = Get-Content dryrun-a3.json -Raw | ConvertFrom-Json
REQ ($dr3.canSubmit -eq $false) "dry-run submit after config change: canSubmit=false"
REQ ($dr3.blockedAt -eq "hard_block") "dry-run submit: blockedAt=hard_block"
REQ ($dr3.hardBlock.blocked -eq $true) "dry-run submit: hardBlock=true"
REQ ($dr3.ruleVersion -ne $dr1.ruleVersion) "rule version changed ($($dr1.ruleVersion) -> $($dr3.ruleVersion))"

# Real submit must also fail
& npm run dev -- submit --by alice *>&1 | Out-Null
REQ ($LASTEXITCODE -ne 0) "real submit after config change: exit!=0"
OK "A3: config change -> dry-run matches real submit (both blocked)"

# --- A4: Version switch (inject pending), dry-run publish should still block ---
Step "A4: Version switch -> dry-run publish reflects current state"
$inject = @"
const fs=require('fs');const p=process.cwd()+'/.dataset/state.json';const s=JSON.parse(fs.readFileSync(p,'utf8'));const d=Object.values(s.versions).filter(v=>v.status==='draft').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];d.status='pending_approval';d.updatedAt=new Date().toISOString();s.stateHistory.push({id:'inject-'+Date.now(),versionId:d.id,fromStatus:'draft',toStatus:'pending_approval',timestamp:new Date().toISOString(),actor:'TEST',reason:'inject'});fs.writeFileSync(p,JSON.stringify(s,null,2));fs.writeFileSync(process.cwd()+'/.dataset/versions/'+d.id+'.json',JSON.stringify(d,null,2));console.log(d.id);
"@
$PEND_ID = (node -e $inject).Trim()
OK "Injected pending: $PEND_ID"

$dr4 = & npm run dev -- dry-run publish $PEND_ID --approver attacker --force --json dryrun-a4.json *>&1 | Out-String
$dr4obj = Get-Content dryrun-a4.json -Raw | ConvertFrom-Json
REQ ($dr4obj.canPublish -eq $false) "dry-run publish after version switch: canPublish=false"
REQ ($dr4obj.blockedAt -eq "hard_block") "dry-run publish: blockedAt=hard_block"
REQ ($dr4obj.currentPublishedVersionId -eq $V1_ID) "dry-run publish: currentVersion still=$V1_ID"

& npm run dev -- publish $PEND_ID --approver attacker --force *>&1 | Out-Null
REQ ($LASTEXITCODE -ne 0) "real publish also blocked"
OK "A4: version switch -> dry-run matches real publish"

# --- A5: Restart CLI, dry-run should be identical ---
Step "A5: Restart CLI -> dry-run results identical"
& npm run dev -- config set-license --allow MIT Apache-2.0 *>&1 | Out-Null
& npm run dev -- scan sample-data --by alice *>&1 | Out-Null

# Before restart
$dr5a = & npm run dev -- dry-run submit --json dryrun-a5-before.json *>&1 | Out-String
$before = Get-Content dryrun-a5-before.json -Raw | ConvertFrom-Json

# Simulate restart
& npm run dev -- status current *>&1 | Out-Null

# After restart
$dr5b = & npm run dev -- dry-run submit --json dryrun-a5-after.json *>&1 | Out-String
$after = Get-Content dryrun-a5-after.json -Raw | ConvertFrom-Json

REQ ($before.canSubmit -eq $after.canSubmit) "restart: canSubmit matches ($($before.canSubmit))"
REQ ($before.blockedAt -eq $after.blockedAt) "restart: blockedAt matches ($($before.blockedAt))"
REQ ($before.ruleVersion -eq $after.ruleVersion) "restart: ruleVersion matches ($($before.ruleVersion))"
REQ ($before.versionId -eq $after.versionId) "restart: versionId matches"
REQ ($before.fileCount -eq $after.fileCount) "restart: fileCount matches ($($before.fileCount))"
OK "A5: restart -> dry-run identical"

# Now do real submit - should match dry-run
if ($after.canSubmit) {
    & npm run dev -- submit --by alice *>&1 | Out-Null
    REQ ($LASTEXITCODE -eq 0) "real submit after restart matches dry-run (pass)"
} else {
    & npm run dev -- submit --by alice *>&1 | Out-Null
    REQ ($LASTEXITCODE -ne 0) "real submit after restart matches dry-run (blocked)"
}
OK "A5: real submit matches dry-run prediction"

# ============================================================
# SCENARIO B: Dry-run JSON -> publish -> rollback -> re-export -> fields align
# ============================================================
Step "B0. Reset for scenario B"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Remove-Item -Force dryrun-*.json, export-*.json -ErrorAction SilentlyContinue
& npm run dev -- init *>&1 | Out-Null
& npm run dev -- config set-license --allow MIT Apache-2.0 *>&1 | Out-Null
& npm run dev -- scan sample-data --by alice *>&1 | Out-Null
& npm run dev -- submit --by alice *>&1 | Out-Null
& npm run dev -- publish --approver bob --comment "baseline v1" *>&1 | Out-Null
$B_STATE = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$B_V1 = $B_STATE.currentVersion
OK "B0: v1 published ($B_V1)"

# --- B1: Dry-run publish for v2, export JSON ---
Step "B1: Dry-run publish v2, export JSON"
& npm run dev -- scan sample-data --by alice *>&1 | Out-Null
& npm run dev -- submit --by alice *>&1 | Out-Null
& npm run dev -- dry-run publish --approver carol --comment "v2 release" --json dryrun-b1.json *>&1 | Out-Null
$drB1 = Get-Content dryrun-b1.json -Raw | ConvertFrom-Json
REQ ($drB1.canPublish -eq $true) "B1 dry-run: canPublish=true"
REQ ($drB1.currentPublishedVersionId -eq $B_V1) "B1 dry-run: currentPublishedVersionId matches v1"
REQ ($drB1.currentPublishedWouldBeReplaced -eq $true) "B1 dry-run: v1 would be replaced"
REQ ($drB1.hardBlock.blocked -eq $false) "B1 dry-run: no hard block"
$DR_B1_VID = $drB1.versionId
$DR_B1_RULE = $drB1.ruleVersion
$DR_B1_FILES = $drB1.fileCount
$DR_B1_SIZE = $drB1.totalSize
OK "B1: dry-run JSON exported"

# --- B2: Real publish, compare with dry-run fields ---
Step "B2: Real publish, compare with dry-run fields"
& npm run dev -- publish --approver carol --comment "v2 release" *>&1 | Out-Null
REQ ($LASTEXITCODE -eq 0) "B2: publish exit=0"

$B2_STATE = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$B_V2 = $B2_STATE.currentVersion
$B_PREV = $B2_STATE.previousVersion
REQ ($B_V2 -eq $DR_B1_VID) "B2: published versionId matches dry-run versionId"
REQ ($B_PREV -eq $B_V1) "B2: previousVersion matches v1"
REQ ($B2_STATE.approvalComments.$B_V2 -eq "v2 release") "B2: approval comment matches"

# Export manifest
& npm run dev -- export --output export-b2.json *>&1 | Out-Null
$manifest = Get-Content export-b2.json -Raw | ConvertFrom-Json
REQ ($manifest.datasetVersion -eq $DR_B1_VID) "B2: manifest.datasetVersion matches dry-run versionId"
REQ ($manifest.ruleVersion -eq $DR_B1_RULE) "B2: manifest.ruleVersion matches dry-run ruleVersion ($($DR_B1_RULE))"
REQ ($manifest.fileCount -eq $DR_B1_FILES) "B2: manifest.fileCount matches dry-run ($($DR_B1_FILES))"
REQ ($manifest.totalSize -eq $DR_B1_SIZE) "B2: manifest.totalSize matches dry-run ($($DR_B1_SIZE))"
REQ ($manifest.approval.approver -eq "carol") "B2: approver=carol"
REQ ($manifest.approval.comment -eq "v2 release") "B2: approval comment=v2 release"
OK "B2: real publish fields match dry-run prediction"

# --- B3: Rollback to v1, dry-run and export should align ---
Step "B3: Rollback to v1, verify field consistency"
& npm run dev -- rollback $B_V1 --by ops --reason "rollback test" *>&1 | Out-Null
REQ ($LASTEXITCODE -eq 0) "B3: rollback exit=0"

$B3_STATE = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
REQ ($B3_STATE.currentVersion -eq $B_V1) "B3: currentVersion is v1"
REQ ($B3_STATE.previousVersion -eq $B_V2) "B3: previousVersion is v2"

# Export after rollback
& npm run dev -- export --output export-b3-rollback.json *>&1 | Out-Null
$rbManifest = Get-Content export-b3-rollback.json -Raw | ConvertFrom-Json
REQ ($rbManifest.datasetVersion -eq $B_V1) "B3: manifest datasetVersion = v1"
REQ ($rbManifest.approval.approver -eq "bob") "B3: v1 approver still = bob"
REQ ($rbManifest.approval.comment -eq "baseline v1") "B3: v1 comment still = baseline v1"
OK "B3: rollback manifest fields align with v1's original approval"

# --- B4: Re-export, compare with previous export ---
Step "B4: Re-export after rollback, signature stable"
& npm run dev -- export --output export-b4-re.json *>&1 | Out-Null
$reManifest = Get-Content export-b4-re.json -Raw | ConvertFrom-Json
REQ ($reManifest.signature -eq $rbManifest.signature) "B4: re-export signature matches rollback export"
REQ ($reManifest.datasetVersion -eq $rbManifest.datasetVersion) "B4: re-export datasetVersion matches"
REQ ($reManifest.fileCount -eq $rbManifest.fileCount) "B4: re-export fileCount matches"
OK "B4: re-export is stable"

# --- B5: Dry-run for a new version after rollback, cross-check with state ---
Step "B5: Dry-run after rollback, cross-check with state"
& npm run dev -- scan sample-data --by alice *>&1 | Out-Null
& npm run dev -- dry-run submit --json dryrun-b5.json *>&1 | Out-Null
$drB5 = Get-Content dryrun-b5.json -Raw | ConvertFrom-Json
REQ ($drB5.currentPublishedVersionId -eq $B_V1) "B5: dry-run sees current=v1"
REQ ($drB5.currentPublishedVersionLabel -ne $null) "B5: dry-run sees current label ($($drB5.currentPublishedVersionLabel))"

$B5_STATE = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
REQ ($B5_STATE.currentVersion -eq $drB5.currentPublishedVersionId) "B5: state.currentVersion matches dry-run"
REQ ($B5_STATE.ruleConfig.version -eq $drB5.ruleVersion) "B5: state.ruleConfig.version matches dry-run"
OK "B5: dry-run after rollback matches state"

# ============================================================
# SUMMARY
# ============================================================
Step "TEST SUMMARY"
if ($script:failed) {
    Write-Host "  SOME TESTS FAILED!" -ForegroundColor Red
} else {
    Write-Host "  ALL TESTS PASSED" -ForegroundColor Green
}
Write-Host ""
Write-Host "  A1: dry-run submit vs real submit (both pass)" -ForegroundColor Green
Write-Host "  A2: dry-run publish vs real publish (both pass)" -ForegroundColor Green
Write-Host "  A3: config change -> dry-run matches real (both blocked)" -ForegroundColor Green
Write-Host "  A4: version switch -> dry-run matches real (both blocked)" -ForegroundColor Green
Write-Host "  A5: restart CLI -> dry-run identical, real matches prediction" -ForegroundColor Green
Write-Host "  B1: dry-run publish v2, JSON export" -ForegroundColor Green
Write-Host "  B2: real publish fields match dry-run prediction" -ForegroundColor Green
Write-Host "  B3: rollback manifest aligns with original approval" -ForegroundColor Green
Write-Host "  B4: re-export signature stable" -ForegroundColor Green
Write-Host "  B5: dry-run after rollback matches state" -ForegroundColor Green
Write-Host ""

# Cleanup
Remove-Item dryrun-*.json, export-*.json -ErrorAction SilentlyContinue
