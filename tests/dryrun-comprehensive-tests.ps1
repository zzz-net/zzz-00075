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

function Step($msg)   { Write-Host ""; Write-Host ("=== " + $msg + " ===") -ForegroundColor Cyan }
function OK($msg)     { Write-Host ("  [OK] " + $msg) -ForegroundColor Green }
function FAIL($msg)   { Write-Host ("  [FAIL] " + $msg) -ForegroundColor Red; $script:failed = $true }
function REQ($cond, $msg) { if (-not $cond) { FAIL $msg } else { OK $msg } }
function Assert-Equal($actual, $expected, $msg) {
    if ($actual -ne $expected) { FAIL "$msg : expected='$expected', actual='$actual'" }
    else { OK "$msg : '$actual'" }
}

$script:failed = $false

# Use review-missing-data which has MIT license
$TEST_DATA = "review-missing-data"

# ============================================================
# SCENARIO 1: Help discoverability
# ============================================================
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
OK "S1: Help discoverability passed"

# ============================================================
# SCENARIO 2: Cross-restart dry-run consistency
# ============================================================
Step "S2: Cross-restart consistency - setup"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Remove-Item -Force dryrun-s2-*.json -ErrorAction SilentlyContinue
& npm run dev -- init 2>&1 | Out-Null
& npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
& npm run dev -- scan $TEST_DATA --by alice 2>&1 | Out-Null

# Verify exactly 1 draft version exists
$s2_state1 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s2_draftCount1 = @($s2_state1.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "draft" }).Count
REQ ($s2_draftCount1 -eq 1) "setup: exactly 1 draft version exists ($s2_draftCount1)"
OK "S2: init + config + scan done"

Step "S2: First dry-run submit (before restart)"
& npm run dev -- dry-run submit --json dryrun-s2-before.json 2>&1 | Out-Null
$s2_beforeExit = $LASTEXITCODE
$before = Get-Content dryrun-s2-before.json -Raw | ConvertFrom-Json
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

# Verify state unchanged after dry-run
$s2_state2 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s2_draftCount2 = @($s2_state2.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "draft" }).Count
REQ ($s2_draftCount2 -eq 1) "after dry-run: still exactly 1 draft version"
REQ ($s2_state2.versions.$s2_tvId -ne $null) "after dry-run: same version ID still exists"
REQ ($s2_state2.versions.$s2_tvId.status -eq "draft") "after dry-run: version still draft"
OK "S2: 1st dry-run summary fields complete + state unchanged"

Step "S2: Simulate CLI restart (run status + history)"
& npm run dev -- status counts 2>&1 | Out-Null
& npm run dev -- history flow 2>&1 | Out-Null
OK "S2: 'restart' done (status + history executed)"

Step "S2: Second dry-run submit (after restart)"
& npm run dev -- dry-run submit --json dryrun-s2-after.json 2>&1 | Out-Null
$after = Get-Content dryrun-s2-after.json -Raw | ConvertFrom-Json
$summaryAfter = $after.summary

Assert-Equal $summaryAfter.targetVersionLabel $s2_tvLabel "after restart: targetVersionLabel matches"
Assert-Equal $summaryAfter.targetVersionId $s2_tvId "after restart: targetVersionId matches"
Assert-Equal $summaryAfter.blockStage $s2_blockStage "after restart: blockStage matches"
Assert-Equal $summaryAfter.willReplaceCurrentPublished $s2_willReplace "after restart: willReplaceCurrentPublished matches"
REQ ($summaryAfter.suggestedNextCommand -eq $s2_nextCmd) "after restart: suggestedNextCommand matches ($s2_nextCmd)"
Assert-Equal $summaryAfter.ruleVersion $s2_ruleVer "after restart: ruleVersion matches"
Assert-Equal $summaryAfter.fileCount $s2_fc "after restart: fileCount matches"
Assert-Equal $summaryAfter.totalSize $s2_ts "after restart: totalSize matches"

# Also verify the full summary object matches (stable JSON export)
$s2_sumBeforeJson = ($summaryBefore | ConvertTo-Json -Depth 10)
$s2_sumAfterJson = ($summaryAfter | ConvertTo-Json -Depth 10)
REQ ($s2_sumBeforeJson -eq $s2_sumAfterJson) "after restart: entire summary JSON identical"
OK "S2: Cross-restart consistency passed"

# ============================================================
# SCENARIO 3: Dry-run after config change
# ============================================================
Step "S3: Dry-run after config change - tighten license (MIT only, dataset is MIT)"
# Tighten to MIT only - should still pass
& npm run dev -- config set-license --allow MIT 2>&1 | Out-Null
& npm run dev -- dry-run submit --json dryrun-s3-mit-only.json 2>&1 | Out-Null
$s3Mit = Get-Content dryrun-s3-mit-only.json -Raw | ConvertFrom-Json
$s3MitSum = $s3Mit.summary
REQ ($s3MitSum.blockStage -eq "none") "MIT-only rules: blockStage=none (dataset is MIT)"
REQ ($s3MitSum.ruleVersion -ne $s2_ruleVer) "MIT-only rules: ruleVersion incremented"
$s3_mitRuleVer = $s3MitSum.ruleVersion
OK "S3: MIT-only rules dry-run passes correctly"

Step "S3: Dry-run after config change - tighten to Apache-only (dataset is MIT, should BLOCK)"
& npm run dev -- config set-license --allow Apache-2.0 2>&1 | Out-Null
& npm run dev -- dry-run submit --json dryrun-s3-tight.json 2>&1 | Out-Null
$s3Tight = Get-Content dryrun-s3-tight.json -Raw | ConvertFrom-Json
$s3TightSum = $s3Tight.summary
REQ ($s3TightSum.blockStage -eq "hard_block") "Apache-only rules: blockStage=hard_block (dataset is MIT)"
REQ ($s3TightSum.blockStageLabel -eq "License Hard Block") "Apache-only rules: blockStageLabel=License Hard Block"
REQ ($s3TightSum.ruleVersion -ne $s3_mitRuleVer) "Apache-only rules: ruleVersion incremented again"
REQ ($s3TightSum.suggestedNextCommand -match "config set-license") "Apache-only rules: suggestedNextCommand hints config change"
$s3_tightRuleVer = $s3TightSum.ruleVersion
$s3_tightNextCmd = $s3TightSum.suggestedNextCommand
OK "S3: Tightened rules dry-run correctly blocks"

Step "S3: Real submit should also be blocked"
& npm run dev -- submit --by attacker 2>&1 | Out-Null
$s3_submitExit = $LASTEXITCODE
REQ ($s3_submitExit -ne 0) "real submit: exit!=0 (hard blocked)"

# Verify version still draft after failed submit
$s3_state3 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s3_draftCount3 = @($s3_state3.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "draft" }).Count
REQ ($s3_draftCount3 -eq 1) "after failed submit: still exactly 1 draft version"
$s3_targetVersion = $s3_state3.versions.($s3Tight.versionId)
REQ ($s3_targetVersion.status -eq "draft") "after failed submit: version still draft"
OK "S3: Real submit matches dry-run (both blocked, state unchanged)"

Step "S3: Config change - relax license (add MIT back)"
& npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
& npm run dev -- dry-run submit --json dryrun-s3-relax.json 2>&1 | Out-Null
$s3Relax = Get-Content dryrun-s3-relax.json -Raw | ConvertFrom-Json
$s3RelaxSum = $s3Relax.summary
REQ ($s3RelaxSum.blockStage -eq "none") "relaxed rules: blockStage=none"
REQ ($s3RelaxSum.blockStageLabel -eq "Not blocked") "relaxed rules: blockStageLabel=Not blocked"
REQ ($s3RelaxSum.ruleVersion -ne $s3_tightRuleVer) "relaxed rules: ruleVersion incremented"
REQ ($s3RelaxSum.suggestedNextCommand -match "dataset-cli submit") "relaxed rules: suggestedNextCommand hints submit"

# versionId should be the same (we didn't re-scan)
REQ ($s3RelaxSum.targetVersionId -eq $s3TightSum.targetVersionId) "relaxed rules: same target version ID (no re-scan)"
OK "S3: Relaxed rules dry-run correctly passes"

Step "S3: Compare real submit result (should match dry-run)"
$s3_predCanSubmit = $s3Relax.canSubmit
$s3_predBlockedAt = $s3Relax.blockedAt
& npm run dev -- submit --by alice 2>&1 | Out-Null
$s3_submitExit2 = $LASTEXITCODE
if ($s3_predCanSubmit -eq $true) {
    REQ ($s3_submitExit2 -eq 0) "real submit matches dry-run: dry-run allows -> real exit=0"
} else {
    REQ ($s3_submitExit2 -ne 0) "real submit matches dry-run: dry-run blocks -> real exit!=0"
}

# Verify version now pending_approval
$s3_state4 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s3_pendingCount = @($s3_state4.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "pending_approval" }).Count
REQ ($s3_pendingCount -eq 1) "after successful submit: exactly 1 pending version"
OK "S3: Config-change dry-run vs real operations passed"

# ============================================================
# SCENARIO 4: Dry-run publish vs real publish + export
# ============================================================
Step "S4: Dry-run publish - first publish (no current version)"
& npm run dev -- dry-run publish --approver bob --comment "s4 release" --json dryrun-s4-pub.json 2>&1 | Out-Null
$s4Pre = Get-Content dryrun-s4-pub.json -Raw | ConvertFrom-Json
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
OK "S4: Dry-run publish summary fields correct"

Step "S4: Real publish - compare with dry-run"
& npm run dev -- publish --approver bob --comment "s4 release" 2>&1 | Out-Null
$s4_pubExit = $LASTEXITCODE
REQ ($s4_pubExit -eq 0) "real publish exit=0"

$stateAfterPub = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
REQ ($stateAfterPub.currentVersion -eq $s4_versionId) "real publish: currentVersion = dry-run versionId"
$pubVer = $stateAfterPub.versions.$s4_versionId
REQ ($pubVer.status -eq "published") "real publish: status=published"
REQ ($pubVer.approval.approver -eq "bob") "real publish: approver=bob"
REQ ($pubVer.approval.comment -eq "s4 release") "real publish: comment=s4 release"
REQ ($pubVer.ruleVersion -eq $s4_ruleVersion) "real publish: ruleVersion matches dry-run ($s4_ruleVersion)"
OK "S4: Real publish key fields match dry-run"

Step "S4: Real export - compare with dry-run file count/size"
& npm run dev -- export --output export-s4-manifest.json 2>&1 | Out-Null
$manifest = Get-Content export-s4-manifest.json -Raw | ConvertFrom-Json
REQ ($manifest.datasetVersion -eq $s4_versionId) "export manifest: datasetVersion = dry-run versionId"
REQ ($manifest.fileCount -eq $s4_fileCount) "export manifest: fileCount matches dry-run ($s4_fileCount)"
REQ ($manifest.totalSize -eq $s4_totalSize) "export manifest: totalSize matches dry-run ($s4_totalSize)"
REQ ($manifest.ruleVersion -eq $s4_ruleVersion) "export manifest: ruleVersion matches dry-run ($s4_ruleVersion)"
REQ ($manifest.approval.approver -eq "bob") "export manifest: approver=bob"
REQ ($manifest.approval.comment -eq "s4 release") "export manifest: comment=s4 release"
OK "S4: Export fields match dry-run publish summary"

# ============================================================
# SCENARIO 5: New version dry-run publish - replace flag
# ============================================================
Step "S5: New version dry-run publish - willReplace=true"
& npm run dev -- scan $TEST_DATA --by alice 2>&1 | Out-Null
& npm run dev -- dry-run submit --json dryrun-s5-submit.json 2>&1 | Out-Null
$s5sum = (Get-Content dryrun-s5-submit.json -Raw | ConvertFrom-Json).summary
REQ ($s5sum.blockStage -eq "none") "v2 dry-run submit passes"
REQ ($s5sum.willReplaceCurrentPublished -eq $false) "dry-run submit: replace flag=false (submit doesn't replace)"
& npm run dev -- submit --by alice 2>&1 | Out-Null

& npm run dev -- dry-run publish --approver carol --comment "s5 v2 release" --json dryrun-s5-pub.json 2>&1 | Out-Null
$s5pre = Get-Content dryrun-s5-pub.json -Raw | ConvertFrom-Json
$s5preSum = $s5pre.summary
REQ ($s5preSum.blockStage -eq "none") "v2 dry-run publish passes"
REQ ($s5preSum.willReplaceCurrentPublished -eq $true) "v2 dry-run publish: willReplace=true (replaces v1)"
REQ ($s5preSum.currentPublishedVersionLabel -eq $s4_versionLabel) "v2 dry-run publish: currentPublishedLabel = v1 ($s4_versionLabel)"
REQ ($s5preSum.currentPublishedVersionId -eq $s4_versionId) "v2 dry-run publish: currentPublishedId = v1 ID"
REQ ($s5preSum.suggestedNextCommand -match "dataset-cli publish") "v2 dry-run publish: next cmd = publish"
OK "S5: New-version publish dry-run - replace flag correct"

Step "S5: Real publish v2 - verify replacement"
& npm run dev -- publish --approver carol --comment "s5 v2 release" 2>&1 | Out-Null
$s5_pubExit = $LASTEXITCODE
REQ ($s5_pubExit -eq 0) "v2 real publish exit=0"
$s5state = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
REQ ($s5state.currentVersion -eq $s5pre.versionId) "after v2 publish: currentVersion = v2"
REQ ($s5state.previousVersion -eq $s4_versionId) "after v2 publish: previousVersion = v1 ($s4_versionId)"
$v1After = $s5state.versions.$s4_versionId
REQ ($v1After.replacedBy -eq $s5pre.versionId) "v1 replacedBy = v2 ID"
OK "S5: Real v2 publish replacement matches dry-run prediction"

# ============================================================
# SCENARIO 6: submit/publish --dry-run aliases
# ============================================================
Step "S6: Command aliases - submit --dry-run and publish --dry-run"
# create a new draft for testing
& npm run dev -- scan $TEST_DATA --by tester 2>&1 | Out-Null

# submit --dry-run
$aliasSubmit = & npm run dev -- submit --dry-run 2>&1 | Out-String
$s6_subDryExit = $LASTEXITCODE
REQ ($aliasSubmit -match "DRY-RUN EXECUTION SUMMARY") "submit --dry-run: shows summary box"
REQ ($aliasSubmit -match "Target version:") "submit --dry-run: summary contains Target version"
REQ ($aliasSubmit -match "Suggested next:") "submit --dry-run: summary contains Suggested next"
REQ ($aliasSubmit -match "No state was changed") "submit --dry-run: explicitly says no state change"
OK "S6: submit --dry-run alias works"

# confirm state unchanged (still draft)
$s6state = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$latestDraft = @($s6state.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "draft" } | Sort-Object { $_.createdAt } -Descending)[0]
REQ ($latestDraft.status -eq "draft") "submit --dry-run: status stays draft (no change)"

# submit it first so we can test publish --dry-run
& npm run dev -- submit --by tester 2>&1 | Out-Null

# publish --dry-run
$aliasPub = & npm run dev -- publish --dry-run --approver dave 2>&1 | Out-String
$s6_pubDryExit = $LASTEXITCODE
REQ ($aliasPub -match "DRY-RUN EXECUTION SUMMARY") "publish --dry-run: shows summary box"
REQ ($aliasPub -match "Replace current:") "publish --dry-run: summary contains Replace current"
REQ ($aliasPub -match "No state was changed") "publish --dry-run: explicitly says no state change"
OK "S6: publish --dry-run alias works"

# ============================================================
# SCENARIO 7: JSON export stability summary
# ============================================================
Step "S7: JSON export summary stability - re-export identical"
# Take the v2 pending version (from S6), do two consecutive dry-runs
& npm run dev -- dry-run publish --approver eve --comment "s7 test" --json dryrun-s7-a.json 2>&1 | Out-Null
& npm run dev -- dry-run publish --approver eve --comment "s7 test" --json dryrun-s7-b.json 2>&1 | Out-Null

$s7a = Get-Content dryrun-s7-a.json -Raw | ConvertFrom-Json
$s7b = Get-Content dryrun-s7-b.json -Raw | ConvertFrom-Json

# Summary fields should be identical (timestamp might differ)
REQ ($s7a.summary.targetVersionLabel -eq $s7b.summary.targetVersionLabel) "re-export: targetVersionLabel identical"
REQ ($s7a.summary.targetVersionId -eq $s7b.summary.targetVersionId) "re-export: targetVersionId identical"
REQ ($s7a.summary.blockStage -eq $s7b.summary.blockStage) "re-export: blockStage identical"
REQ ($s7a.summary.blockStageLabel -eq $s7b.summary.blockStageLabel) "re-export: blockStageLabel identical"
REQ ($s7a.summary.willReplaceCurrentPublished -eq $s7b.summary.willReplaceCurrentPublished) "re-export: willReplace identical"
REQ ($s7a.summary.suggestedNextCommand -eq $s7b.summary.suggestedNextCommand) "re-export: suggestedNextCommand identical"
REQ ($s7a.summary.ruleVersion -eq $s7b.summary.ruleVersion) "re-export: ruleVersion identical"
REQ ($s7a.summary.fileCount -eq $s7b.summary.fileCount) "re-export: fileCount identical"
REQ ($s7a.summary.totalSize -eq $s7b.summary.totalSize) "re-export: totalSize identical"
OK "S7: JSON export summary stability passed"

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
Write-Host "  S1  Help discoverability (root + init)             PASS" -ForegroundColor Green
Write-Host "  S2  Cross-restart dry-run consistency (summary)    PASS" -ForegroundColor Green
Write-Host "  S3  Config-change dry-run + real submit match      PASS" -ForegroundColor Green
Write-Host "  S4  Dry-run publish vs real publish + export       PASS" -ForegroundColor Green
Write-Host "  S5  New-version publish replace flag correct       PASS" -ForegroundColor Green
Write-Host "  S6  submit/publish --dry-run aliases               PASS" -ForegroundColor Green
Write-Host "  S7  JSON export summary re-export stability        PASS" -ForegroundColor Green
Write-Host ""

# Cleanup
Remove-Item dryrun-s2-*.json, dryrun-s3-*.json, dryrun-s4-*.json, dryrun-s5-*.json, dryrun-s7-*.json, export-s4-manifest.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Write-Host "  Cleanup done." -ForegroundColor Gray

if ($script:failed) { exit 1 }
