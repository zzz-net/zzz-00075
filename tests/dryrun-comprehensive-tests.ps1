# ============================================================
# Dry-Run Comprehensive Regression Tests
# Covers: help discoverability / cross-restart consistency
#         / config-change dry-run / dry-run vs real operations
# ============================================================

param(
    [string]$WorkDir = "d:\workSpace\AI__SPACE\zzz-00075"
)

Set-Location $WorkDir
$ErrorActionPreference = "Continue"

# ---------- helpers ----------
function Step($msg)   { Write-Host ""; Write-Host ("=== " + $msg + " ===") -ForegroundColor Cyan }
function OK($msg)     { Write-Host ("  [OK] " + $msg) -ForegroundColor Green }
function FAIL($msg)   {
    Write-Host ("  [FAIL] " + $msg) -ForegroundColor Red
    $script:anyFailed = $true
    $script:currentSceneFailed = $true
}
function REQ($cond, $msg) { if (-not $cond) { FAIL $msg } else { OK $msg } }
function Assert-Equal($actual, $expected, $msg) {
    if ($actual -ne $expected) { FAIL "$msg : expected='$expected', actual='$actual'" }
    else { OK "$msg : '$actual'" }
}

function Start-Scene($name) {
    $script:currentScene = $name
    $script:currentSceneFailed = $false
    $script:sceneResults[$name] = $false
}
function End-Scene($name) {
    if ($script:currentSceneFailed) {
        $script:sceneResults[$name] = $false
        Write-Host ("  [SCENE FAILED] " + $name) -ForegroundColor Red
    } else {
        $script:sceneResults[$name] = $true
        Write-Host ("  [SCENE PASSED] " + $name) -ForegroundColor Green
    }
}

# Safe JSON read: returns $null + marks scene failed if file missing/invalid
function Read-JsonSafe($path) {
    if (-not (Test-Path $path)) {
        FAIL "JSON file missing: $path"
        return $null
    }
    try {
        $raw = Get-Content $path -Raw -ErrorAction Stop
        return ($raw | ConvertFrom-Json -ErrorAction Stop)
    } catch {
        FAIL "JSON parse failed for $path : $($_.Exception.Message)"
        return $null
    }
}

# ---------- state ----------
$script:anyFailed = $false
$script:currentScene = ""
$script:currentSceneFailed = $false
$script:sceneResults = @{}

$TEST_DATA = "review-missing-data"

# ---------- cleanup at start ----------
Remove-Item dryrun-s*.json, dryrun-debug-*.json, export-s4-manifest.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue

# ============================================================
# S1: Help discoverability
# ============================================================
Start-Scene "S1"
Step "S1: Help discoverability - root --help"
$rootHelp = & npm run dev -- --help 2>&1 | Out-String
REQ ($rootHelp -match "dry-run submit") "root help: contains 'dry-run submit'"
REQ ($rootHelp -match "dry-run publish") "root help: contains 'dry-run publish'"
REQ ($rootHelp -match "Pre-flight") "root help: contains 'Pre-flight Commands' section"
REQ ($rootHelp -match "submit --dry-run") "root help: contains 'submit --dry-run' alias"
REQ ($rootHelp -match "publish --dry-run") "root help: contains 'publish --dry-run' alias"

Step "S1: Help discoverability - init output"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
$initOut = & npm run dev -- init 2>&1 | Out-String
REQ ($initOut -match "RECOMMENDED WORKFLOW") "init output: contains RECOMMENDED WORKFLOW"
REQ ($initOut -match "dry-run submit") "init workflow: contains 'dry-run submit'"
REQ ($initOut -match "dry-run publish") "init workflow: contains 'dry-run publish'"
REQ ($initOut -match "Quick aliases") "init output: contains Quick aliases section"
End-Scene "S1"

# ============================================================
# S2: Cross-restart dry-run consistency
# ============================================================
Start-Scene "S2"
Step "S2: Cross-restart consistency - setup"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Remove-Item -Force dryrun-s2-*.json -ErrorAction SilentlyContinue
& npm run dev -- init 2>&1 | Out-Null
& npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
& npm run dev -- scan $TEST_DATA --by alice 2>&1 | Out-Null

$s2_state1 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s2_draftCount1 = @($s2_state1.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "draft" }).Count
REQ ($s2_draftCount1 -eq 1) "setup: exactly 1 draft version exists ($s2_draftCount1)"

Step "S2: First dry-run submit (before restart)"
& npm run dev -- dry-run submit --json dryrun-s2-before.json 2>&1 | Out-Null
$before = Read-JsonSafe "dryrun-s2-before.json"
$s2_hasData = $false
if ($before) {
    $summaryBefore = $before.summary
    REQ ($summaryBefore -ne $null) "1st dry-run: summary field exists"
    REQ ($summaryBefore.targetVersionLabel -match "^v\d+") "summary.targetVersionLabel present"
    REQ ($summaryBefore.targetVersionId -ne "") "summary.targetVersionId present"
    REQ ($summaryBefore.blockStage -in @("none","status_check","hard_block","verification")) "summary.blockStage valid: $($summaryBefore.blockStage)"
    REQ ($summaryBefore.blockStageLabel -ne "") "summary.blockStageLabel present"
    REQ ($summaryBefore.ruleVersion -ne "") "summary.ruleVersion present"
    REQ ($summaryBefore.fileCount -gt 0) "summary.fileCount > 0"
    $s2_tvLabel = $summaryBefore.targetVersionLabel
    $s2_tvId = $summaryBefore.targetVersionId
    $s2_blockStage = $summaryBefore.blockStage
    $s2_willReplace = $summaryBefore.willReplaceCurrentPublished
    $s2_nextCmd = $summaryBefore.suggestedNextCommand
    $s2_ruleVer = $summaryBefore.ruleVersion
    $s2_fc = $summaryBefore.fileCount
    $s2_ts = $summaryBefore.totalSize

    $s2_state2 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
    $s2_draftCount2 = @($s2_state2.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "draft" }).Count
    REQ ($s2_draftCount2 -eq 1) "after dry-run: still exactly 1 draft version"
    REQ ($s2_state2.versions.$s2_tvId -ne $null) "after dry-run: same version ID still exists"
    REQ ($s2_state2.versions.$s2_tvId.status -eq "draft") "after dry-run: version still draft"
    $s2_hasData = $true
}

Step "S2: Simulate CLI restart (run status + history)"
& npm run dev -- status counts 2>&1 | Out-Null
& npm run dev -- history flow 2>&1 | Out-Null

Step "S2: Second dry-run submit (after restart)"
& npm run dev -- dry-run submit --json dryrun-s2-after.json 2>&1 | Out-Null
$after = Read-JsonSafe "dryrun-s2-after.json"
if ($after -and $s2_hasData) {
    $summaryAfter = $after.summary

    Assert-Equal $summaryAfter.targetVersionLabel $s2_tvLabel "after restart: targetVersionLabel matches"
    Assert-Equal $summaryAfter.targetVersionId $s2_tvId "after restart: targetVersionId matches"
    Assert-Equal $summaryAfter.blockStage $s2_blockStage "after restart: blockStage matches"
    Assert-Equal $summaryAfter.willReplaceCurrentPublished $s2_willReplace "after restart: willReplaceCurrentPublished matches"
    REQ ($summaryAfter.suggestedNextCommand -eq $s2_nextCmd) "after restart: suggestedNextCommand matches ($s2_nextCmd)"
    Assert-Equal $summaryAfter.ruleVersion $s2_ruleVer "after restart: ruleVersion matches"
    Assert-Equal $summaryAfter.fileCount $s2_fc "after restart: fileCount matches"
    Assert-Equal $summaryAfter.totalSize $s2_ts "after restart: totalSize matches"

    $s2_sumBeforeJson = ($summaryBefore | ConvertTo-Json -Depth 10)
    $s2_sumAfterJson = ($summaryAfter | ConvertTo-Json -Depth 10)
    REQ ($s2_sumBeforeJson -eq $s2_sumAfterJson) "after restart: entire summary JSON identical"
}
End-Scene "S2"

# ============================================================
# S3: Dry-run after config change
# ============================================================
Start-Scene "S3"
Step "S3: Dry-run after config change - tighten license (MIT only, dataset is MIT)"
& npm run dev -- config set-license --allow MIT 2>&1 | Out-Null
& npm run dev -- dry-run submit --json dryrun-s3-mit-only.json 2>&1 | Out-Null
$s3Mit = Read-JsonSafe "dryrun-s3-mit-only.json"
if ($s3Mit) {
    $s3MitSum = $s3Mit.summary
    REQ ($s3MitSum.blockStage -eq "none") "MIT-only rules: blockStage=none (dataset is MIT)"
    REQ ($s3MitSum.ruleVersion -ne $s2_ruleVer) "MIT-only rules: ruleVersion incremented"
    $s3_mitRuleVer = $s3MitSum.ruleVersion
}

Step "S3: Dry-run after config change - tighten to Apache-only (dataset is MIT, should BLOCK)"
& npm run dev -- config set-license --allow Apache-2.0 2>&1 | Out-Null
& npm run dev -- dry-run submit --json dryrun-s3-tight.json 2>&1 | Out-Null
$s3Tight = Read-JsonSafe "dryrun-s3-tight.json"
if ($s3Tight) {
    $s3TightSum = $s3Tight.summary
    REQ ($s3TightSum.blockStage -eq "hard_block") "Apache-only rules: blockStage=hard_block (dataset is MIT)"
    REQ ($s3TightSum.blockStageLabel -eq "License Hard Block") "Apache-only rules: blockStageLabel=License Hard Block"
    REQ ($s3TightSum.ruleVersion -ne $s3_mitRuleVer) "Apache-only rules: ruleVersion incremented again"
    REQ ($s3TightSum.suggestedNextCommand -match "config set-license") "Apache-only rules: suggestedNextCommand hints config change"
    $s3_tightRuleVer = $s3TightSum.ruleVersion
    $s3_tightVid = $s3Tight.versionId
}

Step "S3: Real submit should also be blocked"
& npm run dev -- submit --by attacker 2>&1 | Out-Null
$s3_submitExit = $LASTEXITCODE
REQ ($s3_submitExit -ne 0) "real submit: exit!=0 (hard blocked)"

$s3_state3 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s3_draftCount3 = @($s3_state3.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "draft" }).Count
REQ ($s3_draftCount3 -eq 1) "after failed submit: still exactly 1 draft version"
if ($s3_tightVid) {
    REQ ($s3_state3.versions.$s3_tightVid.status -eq "draft") "after failed submit: version still draft"
}

Step "S3: Config change - relax license (add MIT back)"
& npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
& npm run dev -- dry-run submit --json dryrun-s3-relax.json 2>&1 | Out-Null
$s3Relax = Read-JsonSafe "dryrun-s3-relax.json"
if ($s3Relax) {
    $s3RelaxSum = $s3Relax.summary
    REQ ($s3RelaxSum.blockStage -eq "none") "relaxed rules: blockStage=none"
    REQ ($s3RelaxSum.blockStageLabel -eq "Not blocked") "relaxed rules: blockStageLabel=Not blocked"
    REQ ($s3RelaxSum.ruleVersion -ne $s3_tightRuleVer) "relaxed rules: ruleVersion incremented"
    REQ ($s3RelaxSum.suggestedNextCommand -match "dataset-cli submit") "relaxed rules: suggestedNextCommand hints submit"
    if ($s3Tight) {
        REQ ($s3RelaxSum.targetVersionId -eq $s3TightSum.targetVersionId) "relaxed rules: same target version ID (no re-scan)"
    }
    $s3_predCanSubmit = $s3Relax.canSubmit
}

Step "S3: Compare real submit result (should match dry-run)"
& npm run dev -- submit --by alice 2>&1 | Out-Null
$s3_submitExit2 = $LASTEXITCODE
if ($s3_predCanSubmit -eq $true) {
    REQ ($s3_submitExit2 -eq 0) "real submit matches dry-run: dry-run allows -> real exit=0"
} else {
    REQ ($s3_submitExit2 -ne 0) "real submit matches dry-run: dry-run blocks -> real exit!=0"
}

$s3_state4 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s3_pendingCount = @($s3_state4.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "pending_approval" }).Count
REQ ($s3_pendingCount -eq 1) "after successful submit: exactly 1 pending version"
End-Scene "S3"

# ============================================================
# S4: Dry-run publish vs real publish + export
# ============================================================
Start-Scene "S4"
Step "S4: Dry-run publish - first publish (no current version)"
& npm run dev -- dry-run publish --approver bob --comment "s4 release" --json dryrun-s4-pub.json 2>&1 | Out-Null
$s4Pre = Read-JsonSafe "dryrun-s4-pub.json"
if ($s4Pre) {
    $s4PreSum = $s4Pre.summary
    REQ ($s4Pre.canPublish -eq $true) "dry-run publish: canPublish=true"
    REQ ($s4PreSum.blockStage -eq "none") "dry-run publish: blockStage=none"
    REQ ($s4Pre.currentPublishedVersionId -eq $null) "dry-run publish: 1st publish, currentPublished=null"
    REQ ($s4PreSum.willReplaceCurrentPublished -eq $false) "dry-run publish: 1st publish, willReplace=false"
    REQ ($s4PreSum.suggestedNextCommand -match "dataset-cli publish") "dry-run publish: suggestedNextCommand hints publish"
    $s4_versionId = $s4Pre.versionId
    $s4_versionLabel = $s4Pre.versionLabel
    $s4_fileCount = $s4PreSum.fileCount
    $s4_totalSize = $s4PreSum.totalSize
    $s4_ruleVersion = $s4PreSum.ruleVersion
}

Step "S4: Real publish - compare with dry-run"
& npm run dev -- publish --approver bob --comment "s4 release" 2>&1 | Out-Null
$s4_pubExit = $LASTEXITCODE
REQ ($s4_pubExit -eq 0) "real publish exit=0"

$stateAfterPub = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
if ($s4_versionId) {
    REQ ($stateAfterPub.currentVersion -eq $s4_versionId) "real publish: currentVersion = dry-run versionId"
    $pubVer = $stateAfterPub.versions.$s4_versionId
    REQ ($pubVer.status -eq "published") "real publish: status=published"
    REQ ($pubVer.approval.approver -eq "bob") "real publish: approver=bob"
    REQ ($pubVer.approval.comment -eq "s4 release") "real publish: comment=s4 release"
    REQ ($pubVer.approval.ruleVersion -eq $s4_ruleVersion) "real publish: approval.ruleVersion matches dry-run ($s4_ruleVersion)"
}

Step "S4: Real export - compare with dry-run file count/size"
& npm run dev -- export --output export-s4-manifest.json 2>&1 | Out-Null
$manifest = Read-JsonSafe "export-s4-manifest.json"
if ($manifest -and $s4_versionId) {
    REQ ($manifest.datasetVersion -eq $s4_versionId) "export manifest: datasetVersion = dry-run versionId"
    REQ ($manifest.fileCount -eq $s4_fileCount) "export manifest: fileCount matches dry-run ($s4_fileCount)"
    REQ ($manifest.totalSize -eq $s4_totalSize) "export manifest: totalSize matches dry-run ($s4_totalSize)"
    REQ ($manifest.ruleVersion -eq $s4_ruleVersion) "export manifest: ruleVersion matches dry-run ($s4_ruleVersion)"
    REQ ($manifest.approval.approver -eq "bob") "export manifest: approver=bob"
    REQ ($manifest.approval.comment -eq "s4 release") "export manifest: comment=s4 release"
}
End-Scene "S4"

# ============================================================
# S5: New version dry-run publish - replace flag
# ============================================================
Start-Scene "S5"
Step "S5: New version dry-run publish - willReplace=true"
& npm run dev -- scan $TEST_DATA --by alice 2>&1 | Out-Null
& npm run dev -- dry-run submit --json dryrun-s5-submit.json 2>&1 | Out-Null
$s5sub = Read-JsonSafe "dryrun-s5-submit.json"
if ($s5sub) {
    $s5sum = $s5sub.summary
    REQ ($s5sum.blockStage -eq "none") "v2 dry-run submit passes"
    REQ ($s5sum.willReplaceCurrentPublished -eq $false) "dry-run submit: replace flag=false (submit doesn't replace)"
}
& npm run dev -- submit --by alice 2>&1 | Out-Null

& npm run dev -- dry-run publish --approver carol --comment "s5 v2 release" --json dryrun-s5-pub.json 2>&1 | Out-Null
$s5pre = Read-JsonSafe "dryrun-s5-pub.json"
if ($s5pre) {
    $s5preSum = $s5pre.summary
    REQ ($s5preSum.blockStage -eq "none") "v2 dry-run publish passes"
    REQ ($s5preSum.willReplaceCurrentPublished -eq $true) "v2 dry-run publish: willReplace=true (replaces v1)"
    if ($s4_versionLabel) {
        REQ ($s5preSum.currentPublishedVersionLabel -eq $s4_versionLabel) "v2 dry-run publish: currentPublishedLabel = v1 ($s4_versionLabel)"
    }
    if ($s4_versionId) {
        REQ ($s5preSum.currentPublishedVersionId -eq $s4_versionId) "v2 dry-run publish: currentPublishedId = v1 ID"
    }
    REQ ($s5preSum.suggestedNextCommand -match "dataset-cli publish") "v2 dry-run publish: next cmd = publish"
    $s5_vid = $s5pre.versionId
}

Step "S5: Real publish v2 - verify replacement"
& npm run dev -- publish --approver carol --comment "s5 v2 release" 2>&1 | Out-Null
$s5_pubExit = $LASTEXITCODE
REQ ($s5_pubExit -eq 0) "v2 real publish exit=0"
$s5state = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
if ($s5_vid) { REQ ($s5state.currentVersion -eq $s5_vid) "after v2 publish: currentVersion = v2" }
if ($s4_versionId) { REQ ($s5state.previousVersion -eq $s4_versionId) "after v2 publish: previousVersion = v1 ($s4_versionId)" }
if ($s4_versionId -and $s5_vid) {
    $v1After = $s5state.versions.$s4_versionId
    REQ ($v1After.replacedBy -eq $s5_vid) "v1 replacedBy = v2 ID"
}
End-Scene "S5"

# ============================================================
# S6: submit/publish --dry-run aliases
# ============================================================
Start-Scene "S6"
Step "S6: Command aliases - submit --dry-run and publish --dry-run"
& npm run dev -- scan $TEST_DATA --by tester 2>&1 | Out-Null

$aliasSubmit = & npm run dev -- submit --dry-run 2>&1 | Out-String
$s6_subDryExit = $LASTEXITCODE
REQ ($aliasSubmit -match "DRY-RUN EXECUTION SUMMARY") "submit --dry-run: shows summary box"
REQ ($aliasSubmit -match "Target version:") "submit --dry-run: summary contains Target version"
REQ ($aliasSubmit -match "Suggested next:") "submit --dry-run: summary contains Suggested next"
REQ ($aliasSubmit -match "No state was changed") "submit --dry-run: explicitly says no state change"

$s6state = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$latestDraft = @($s6state.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "draft" } | Sort-Object { $_.createdAt } -Descending)[0]
REQ ($latestDraft.status -eq "draft") "submit --dry-run: status stays draft (no change)"

& npm run dev -- submit --by tester 2>&1 | Out-Null

$aliasPub = & npm run dev -- publish --dry-run --approver dave 2>&1 | Out-String
$s6_pubDryExit = $LASTEXITCODE
REQ ($aliasPub -match "DRY-RUN EXECUTION SUMMARY") "publish --dry-run: shows summary box"
REQ ($aliasPub -match "Replace current:") "publish --dry-run: summary contains Replace current"
REQ ($aliasPub -match "No state was changed") "publish --dry-run: explicitly says no state change"
End-Scene "S6"

# ============================================================
# S7: JSON export stability summary
# ============================================================
Start-Scene "S7"
Step "S7: JSON export summary stability - re-export identical"
& npm run dev -- dry-run publish --approver eve --comment "s7 test" --json dryrun-s7-a.json 2>&1 | Out-Null
& npm run dev -- dry-run publish --approver eve --comment "s7 test" --json dryrun-s7-b.json 2>&1 | Out-Null

$s7a = Read-JsonSafe "dryrun-s7-a.json"
$s7b = Read-JsonSafe "dryrun-s7-b.json"
if ($s7a -and $s7b) {
    REQ ($s7a.summary.targetVersionLabel -eq $s7b.summary.targetVersionLabel) "re-export: targetVersionLabel identical"
    REQ ($s7a.summary.targetVersionId -eq $s7b.summary.targetVersionId) "re-export: targetVersionId identical"
    REQ ($s7a.summary.blockStage -eq $s7b.summary.blockStage) "re-export: blockStage identical"
    REQ ($s7a.summary.blockStageLabel -eq $s7b.summary.blockStageLabel) "re-export: blockStageLabel identical"
    REQ ($s7a.summary.willReplaceCurrentPublished -eq $s7b.summary.willReplaceCurrentPublished) "re-export: willReplace identical"
    REQ ($s7a.summary.suggestedNextCommand -eq $s7b.summary.suggestedNextCommand) "re-export: suggestedNextCommand identical"
    REQ ($s7a.summary.ruleVersion -eq $s7b.summary.ruleVersion) "re-export: ruleVersion identical"
    REQ ($s7a.summary.fileCount -eq $s7b.summary.fileCount) "re-export: fileCount identical"
    REQ ($s7a.summary.totalSize -eq $s7b.summary.totalSize) "re-export: totalSize identical"
}
End-Scene "S7"

# ============================================================
# SUMMARY - driven by actual scene results, not hardcoded
# ============================================================
Step "TEST SUMMARY"
Write-Host ""

$sceneLabels = [ordered]@{
    "S1" = "Help discoverability (root + init)"
    "S2" = "Cross-restart dry-run consistency (summary)"
    "S3" = "Config-change dry-run + real submit match"
    "S4" = "Dry-run publish vs real publish + export"
    "S5" = "New-version publish replace flag correct"
    "S6" = "submit/publish --dry-run aliases"
    "S7" = "JSON export summary re-export stability"
}

$passedCount = 0
$failedCount = 0

foreach ($key in $sceneLabels.Keys) {
    $label = $sceneLabels[$key]
    if ($script:sceneResults.ContainsKey($key) -and $script:sceneResults[$key] -eq $true) {
        Write-Host ("  PASS  " + $key + "  " + $label) -ForegroundColor Green
        $passedCount++
    } else {
        Write-Host ("  FAIL  " + $key + "  " + $label) -ForegroundColor Red
        $failedCount++
    }
}

Write-Host ""
Write-Host ("  Total: {0} passed, {1} failed out of {2} scenes" -f $passedCount, $failedCount, $sceneLabels.Count) -ForegroundColor Cyan
Write-Host ""

# ---------- cleanup ----------
Remove-Item dryrun-s*.json, dryrun-debug-*.json, export-s4-manifest.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Write-Host "  Cleanup done." -ForegroundColor Gray

# ---------- final exit code ----------
if ($script:anyFailed) {
    Write-Host "  EXIT CODE: 1 (some tests failed)" -ForegroundColor Red
    exit 1
} else {
    Write-Host "  EXIT CODE: 0 (all tests passed)" -ForegroundColor Green
    exit 0
}
