# ============================================================
# Publish Plan Comparison Tests
# Covers: side-by-side diff view, license comparison,
#         conflict detection, cross-restart/config consistency,
#         dry-run vs submit/publish vs JSON export consistency
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
function Assert-Greater($actual, $min, $msg) {
    if ($actual -lt $min) { FAIL "$msg : actual='$actual' < min='$min'" }
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

$TEST_DATA = "reviewer-apache-data"
$TEST_DATA_MIT = "review-missing-data"

function Strip-Ansi($text) {
    return $text -replace '\x1B\[[0-9;]*m', ''
}

# ---------- cleanup at start ----------
Remove-Item compare-*.json, diff-*.json, conflict-*.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue

# ============================================================
# S1: Side-by-side comparison view - first publish (no baseline)
# ============================================================
Start-Scene "S1"
Step "S1: Setup - init, scan MIT dataset"
& npm run dev -- init 2>&1 | Out-Null
& npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
& npm run dev -- scan $TEST_DATA_MIT --by alice 2>&1 | Out-Null

Step "S1: dry-run submit JSON - verify comparison structure on first publish"
& npm run dev -- dry-run submit --json compare-s1-first.json 2>&1 | Out-Null
$s1 = Read-JsonSafe "compare-s1-first.json"
if ($s1) {
    $s1Comp = $s1.comparison
    REQ ($s1Comp -ne $null) "comparison field exists"
    REQ ($s1Comp.hasPublishedVersion -eq $false) "hasPublishedVersion=false (first publication)"
    REQ ($s1Comp.publishedVersionLabel -eq $null) "publishedVersionLabel=null"
    REQ ($s1Comp.publishedVersionId -eq $null) "publishedVersionId=null"
    REQ ($s1Comp.draftVersionLabel -match "^v\d+") "draftVersionLabel present"
    REQ ($s1Comp.willReplaceCurrentPublished -eq $false) "willReplaceCurrentPublished=false (submit action)"
    Assert-Greater $s1Comp.fileDiffs.Count 0 "fileDiffs has entries"
    REQ ($s1Comp.addedFileCount -eq $s1Comp.fileDiffs.Count) "addedFileCount = all files (first pub)"
    REQ ($s1Comp.deletedFileCount -eq 0) "deletedFileCount=0"
    REQ ($s1Comp.modifiedFileCount -eq 0) "modifiedFileCount=0"
    REQ ($s1Comp.unchangedFileCount -eq 0) "unchangedFileCount=0"
    REQ ($s1Comp.conflict.hasConflict -eq $false) "no conflict on first publish"
    REQ ($s1Comp.licenseComparison.allAllowed -eq $true) "all licenses allowed (MIT dataset)"

    $s1Sum = $s1.summary
    REQ ($s1Sum.addedFileCount -eq $s1Comp.addedFileCount) "summary.addedFileCount matches comparison"
    REQ ($s1Sum.deletedFileCount -eq 0) "summary.deletedFileCount=0"
    REQ ($s1Sum.modifiedFileCount -eq 0) "summary.modifiedFileCount=0"
    REQ ($s1Sum.hasConflict -eq $false) "summary.hasConflict=false"
    REQ ($s1Sum.conflictType -eq $null) "summary.conflictType=null"
}

Step "S1: dry-run submit text output - contains comparison view markers"
$s1Text = Strip-Ansi (& npm run dev -- dry-run submit 2>&1 | Out-String)
REQ ($s1Text -match "PUBLISHED VERSION") "text output: PUBLISHED VERSION column header"
REQ ($s1Text -match "DRAFT VERSION") "text output: DRAFT VERSION column header"
REQ ($s1Text -match "FILE DIFFS") "text output: FILE DIFFS section"
REQ ($s1Text -match "LICENSE COMPARISON") "text output: LICENSE COMPARISON section"
REQ ($s1Text -match "VERSION & REPLACEMENT") "text output: VERSION & REPLACEMENT section"
REQ ($s1Text -match "SUGGESTED NEXT STEPS") "text output: SUGGESTED NEXT STEPS section"
REQ ($s1Text -match "FIRST PUBLICATION") "text output: FIRST PUBLICATION indicator"
End-Scene "S1"

# ============================================================
# S2: Comparison with actual published baseline - file diffs
# ============================================================
Start-Scene "S2"
Step "S2: Real submit and publish v1 to create baseline"
& npm run dev -- submit --by alice 2>&1 | Out-Null
& npm run dev -- publish --approver bob --comment "v1 release" 2>&1 | Out-Null

$s2state1 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s2v1Id = $s2state1.currentVersion
REQ ($s2v1Id -ne $null) "v1 published successfully"

Step "S2: Scan second dataset (Apache-2.0, different files) to create v2 draft"
& npm run dev -- scan $TEST_DATA --by carol 2>&1 | Out-Null

Step "S2: dry-run submit - verify file diffs between v1 (published) and v2 (draft)"
& npm run dev -- dry-run submit --json compare-s2-diff.json 2>&1 | Out-Null
$s2 = Read-JsonSafe "compare-s2-diff.json"
if ($s2) {
    $s2Comp = $s2.comparison
    REQ ($s2Comp.hasPublishedVersion -eq $true) "hasPublishedVersion=true now"
    REQ ($s2Comp.publishedVersionId -eq $s2v1Id) "publishedVersionId matches v1"
    REQ ($s2Comp.draftVersionLabel -ne $s2Comp.publishedVersionLabel) "draft label != published label"

    $totalDiff = $s2Comp.addedFileCount + $s2Comp.deletedFileCount + $s2Comp.modifiedFileCount + $s2Comp.unchangedFileCount
    REQ ($totalDiff -gt 0) "total diff entries > 0"
    REQ ($s2Comp.addedFileCount + $s2Comp.deletedFileCount + $s2Comp.modifiedFileCount -gt 0) "at least one changed file between datasets"

    $s2Sum = $s2.summary
    REQ ($s2Sum.addedFileCount -eq $s2Comp.addedFileCount) "summary added count matches comparison"
    REQ ($s2Sum.deletedFileCount -eq $s2Comp.deletedFileCount) "summary deleted count matches comparison"
    REQ ($s2Sum.modifiedFileCount -eq $s2Comp.modifiedFileCount) "summary modified count matches comparison"

    $deltaMatches = $true
    foreach ($fd in $s2Comp.fileDiffs) {
        if ($fd.diffType -eq "added" -and -not $s2Comp.filesAdded.Contains($fd.path)) { $deltaMatches = $false }
        if ($fd.diffType -eq "deleted" -and -not $s2Comp.filesDeleted.Contains($fd.path)) { $deltaMatches = $false }
        if ($fd.diffType -eq "modified" -and -not $s2Comp.filesModified.Contains($fd.path)) { $deltaMatches = $false }
        if ($fd.diffType -eq "unchanged" -and -not $s2Comp.filesUnchanged.Contains($fd.path)) { $deltaMatches = $false }
    }
    REQ ($deltaMatches) "fileDiffs entries match filesAdded/filesDeleted/filesModified/filesUnchanged arrays"
}

Step "S2: Text output contains diff markers for added/modified files"
$s2Text = Strip-Ansi (& npm run dev -- dry-run submit 2>&1 | Out-String)
REQ ($s2Text -match "\[\+\]") "text output: [+] added file marker"
REQ ($s2Text -match "\[\~\]") "text output: [~] modified file marker"
REQ ($s2Text -match "Added:") "text output: Added: count line"
REQ ($s2Text -match "Modified:") "text output: Modified: count line"
REQ ($s2Text -match "Size delta:") "text output: Size delta line"
End-Scene "S2"

# ============================================================
# S3: License comparison between versions
# ============================================================
Start-Scene "S3"
Step "S3: Tighten license rules to Apache-only first, then scan MIT draft (avoids rule_version_mismatch), then dry-run"
& npm run dev -- config set-license --allow Apache-2.0 2>&1 | Out-Null
& npm run dev -- scan $TEST_DATA_MIT --by alice 2>&1 | Out-Null
& npm run dev -- dry-run submit --json compare-s3-license.json 2>&1 | Out-Null
$s3 = Read-JsonSafe "compare-s3-license.json"
if ($s3) {
    $s3Comp = $s3.comparison
    $s3Lic = $s3Comp.licenseComparison
    REQ ($s3Lic.draftLicenses.Count -gt 0) "draftLicenses detected"
    REQ ($s3Lic.publishedLicenses.Count -gt 0) "publishedLicenses detected"
    REQ ($s3Lic.allAllowed -eq $false) "allAllowed=false (MIT not in Apache-only)"
    Assert-Greater $s3Lic.violatingLicenses.Count 0 "violatingLicenses has entries"
    REQ ($s3Comp.blockingPoints -match "LICENSE BLOCK") "blockingPoints contains LICENSE BLOCK"
    REQ ($s3.summary.blockStage -eq "hard_block") "summary.blockStage=hard_block"
}

Step "S3: Text output shows license violations"
$s3Text = Strip-Ansi (& npm run dev -- dry-run submit 2>&1 | Out-String)
REQ ($s3Text -match "VIOLATING:") "text output: VIOLATING: section"
REQ ($s3Text -match "BLOCKING POINTS") "text output: BLOCKING POINTS section"
REQ ($s3Text -match "LICENSE BLOCK") "text output: LICENSE BLOCK marker"
End-Scene "S3"

# ============================================================
# S4: Conflict detection - multiple pending versions
# ============================================================
Start-Scene "S4"
Step "S4: Setup - relax license, re-scan to sync rule version, submit v2 draft to pending"
& npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
& npm run dev -- scan $TEST_DATA_MIT --by carol 2>&1 | Out-Null
& npm run dev -- submit --by carol 2>&1 | Out-Null

$s4state1 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s4pending1 = @($s4state1.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "pending_approval" }).Count
REQ ($s4pending1 -eq 1) "1 pending version after submitting v2"

Step "S4: Create v3 draft and submit it (should now have 2 pending versions)"
& npm run dev -- scan $TEST_DATA --by dave 2>&1 | Out-Null
& npm run dev -- submit --by dave 2>&1 | Out-Null

$s4state2 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$s4pending2 = @($s4state2.versions.PSObject.Properties | ForEach-Object { $_.Value } | Where-Object { $_.status -eq "pending_approval" }).Count
REQ ($s4pending2 -eq 2) "2 pending versions exist now"

Step "S4: dry-run publish - should detect multiple_pending conflict"
& npm run dev -- dry-run publish --approver eve --json compare-s4-conflict.json 2>&1 | Out-Null
$s4 = Read-JsonSafe "compare-s4-conflict.json"
if ($s4) {
    $s4Comp = $s4.comparison
    REQ ($s4Comp.conflict.hasConflict -eq $true) "conflict.hasConflict=true"
    REQ ($s4Comp.conflict.conflictType -eq "multiple_pending") "conflictType=multiple_pending"
    Assert-Greater $s4Comp.conflict.conflictReasons.Count 0 "conflictReasons has entries"
    Assert-Greater $s4Comp.conflict.resolutionHints.Count 0 "resolutionHints has entries"
    Assert-Greater $s4Comp.conflict.conflictingVersionIds.Count 1 "conflictingVersionIds has at least 2 entries"
    REQ ($s4.summary.hasConflict -eq $true) "summary.hasConflict=true"
    REQ ($s4.summary.conflictType -eq "multiple_pending") "summary.conflictType=multiple_pending"
    REQ ($s4.summary.blockStage -eq "status_check") "summary.blockStage=status_check (conflict blocks)"
}

Step "S4: Text output shows conflict section"
$s4Text = Strip-Ansi (& npm run dev -- dry-run publish --approver eve 2>&1 | Out-String)
REQ ($s4Text -match "CONFLICT DETECTED") "text output: CONFLICT DETECTED header"
REQ ($s4Text -match "Conflict type:") "text output: Conflict type: line"
REQ ($s4Text -match "multiple_pending") "text output: multiple_pending mentioned"
REQ ($s4Text -match "Resolution hints:") "text output: Resolution hints: section"

Step "S4: Real publish should also be blocked by conflict"
& npm run dev -- publish --approver eve 2>&1 | Out-Null
$s4pubExit = $LASTEXITCODE
REQ ($s4pubExit -ne 0) "real publish exit!=0 when conflict exists"

Step "S4: status conflict command explains the issue"
$s4StatusText = Strip-Ansi (& npm run dev -- status conflict --action publish 2>&1 | Out-String)
REQ ($s4StatusText -match "CONFLICT ANALYSIS") "status conflict: CONFLICT ANALYSIS header"
REQ ($s4StatusText -match "multiple_pending") "status conflict: mentions multiple_pending"
REQ ($s4StatusText -match "Conflicting versions:") "status conflict: Conflicting versions: section"
REQ ($s4StatusText -match "How to resolve:") "status conflict: How to resolve: section"

Step "S4: status compare command works"
$s4CompareText = Strip-Ansi (& npm run dev -- status compare --action publish 2>&1 | Out-String)
REQ ($s4CompareText -match "PUBLISHED VERSION") "status compare: PUBLISHED VERSION column"
REQ ($s4CompareText -match "DRAFT VERSION") "status compare: DRAFT VERSION column"
REQ ($s4CompareText -match "FILE DIFFS") "status compare: FILE DIFFS section"
End-Scene "S4"

# ============================================================
# S5: Cross-restart & config-change comparison consistency
# ============================================================
Start-Scene "S5"
Step "S5: Clean state - publish one version cleanly, create new draft"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
& npm run dev -- init 2>&1 | Out-Null
& npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
& npm run dev -- scan $TEST_DATA_MIT --by alice 2>&1 | Out-Null
& npm run dev -- submit --by alice 2>&1 | Out-Null
& npm run dev -- publish --approver bob --comment "clean v1" 2>&1 | Out-Null
& npm run dev -- scan $TEST_DATA --by carol 2>&1 | Out-Null

Step "S5: First dry-run submit comparison - capture baseline"
& npm run dev -- dry-run submit --json compare-s5-before.json 2>&1 | Out-Null
$s5Before = Read-JsonSafe "compare-s5-before.json"
$s5BeforeComp = $null
if ($s5Before) {
    $s5BeforeComp = $s5Before.comparison
    REQ ($s5BeforeComp -ne $null) "s5 before: comparison exists"
}

Step "S5: Simulate CLI restart (run status/history)"
& npm run dev -- status counts 2>&1 | Out-Null
& npm run dev -- history flow 2>&1 | Out-Null

Step "S5: Second dry-run submit comparison after restart - should match"
& npm run dev -- dry-run submit --json compare-s5-after.json 2>&1 | Out-Null
$s5After = Read-JsonSafe "compare-s5-after.json"
if ($s5After -and $s5BeforeComp) {
    $s5AfterComp = $s5After.comparison
    Assert-Equal $s5AfterComp.hasPublishedVersion $s5BeforeComp.hasPublishedVersion "after restart: hasPublishedVersion matches"
    Assert-Equal $s5AfterComp.publishedVersionId $s5BeforeComp.publishedVersionId "after restart: publishedVersionId matches"
    Assert-Equal $s5AfterComp.draftVersionId $s5BeforeComp.draftVersionId "after restart: draftVersionId matches"
    Assert-Equal $s5AfterComp.addedFileCount $s5BeforeComp.addedFileCount "after restart: addedFileCount matches"
    Assert-Equal $s5AfterComp.deletedFileCount $s5BeforeComp.deletedFileCount "after restart: deletedFileCount matches"
    Assert-Equal $s5AfterComp.modifiedFileCount $s5BeforeComp.modifiedFileCount "after restart: modifiedFileCount matches"
    Assert-Equal $s5AfterComp.unchangedFileCount $s5BeforeComp.unchangedFileCount "after restart: unchangedFileCount matches"
    Assert-Equal $s5AfterComp.totalSizeDelta $s5BeforeComp.totalSizeDelta "after restart: totalSizeDelta matches"
    Assert-Equal $s5AfterComp.conflict.hasConflict $s5BeforeComp.conflict.hasConflict "after restart: conflict.hasConflict matches"
    Assert-Equal $s5AfterComp.ruleVersion $s5BeforeComp.ruleVersion "after restart: ruleVersion matches"
    REQ ($s5AfterComp.licenseComparison.draftLicenses.Count -eq $s5BeforeComp.licenseComparison.draftLicenses.Count) "after restart: draftLicenses count matches"
}

Step "S5: Change config, dry-run again - comparison should reflect new rule version"
& npm run dev -- config set-license --allow MIT Apache-2.0 BSD-3-Clause 2>&1 | Out-Null
& npm run dev -- dry-run submit --json compare-s5-config.json 2>&1 | Out-Null
$s5Config = Read-JsonSafe "compare-s5-config.json"
if ($s5Config -and $s5BeforeComp) {
    REQ ($s5Config.comparison.ruleVersion -ne $s5BeforeComp.ruleVersion) "after config change: ruleVersion incremented"
    REQ ($s5Config.comparison.conflict.conflictType -eq "rule_version_mismatch") "after config change: conflictType=rule_version_mismatch"
    REQ ($s5Config.comparison.conflict.hasConflict -eq $true) "after config change: conflict.hasConflict=true"
}

Step "S5: Re-scan after config change - conflict should resolve"
& npm run dev -- scan $TEST_DATA --by carol 2>&1 | Out-Null
& npm run dev -- dry-run submit --json compare-s5-resolved.json 2>&1 | Out-Null
$s5Resolved = Read-JsonSafe "compare-s5-resolved.json"
if ($s5Resolved) {
    REQ ($s5Resolved.comparison.conflict.hasConflict -eq $false) "after re-scan: conflict resolved"
    REQ ($s5Resolved.summary.blockStage -eq "none") "after re-scan: blockStage=none"
}
End-Scene "S5"

# ============================================================
# S6: Comparison data consistency: dry-run JSON == submit == publish
# ============================================================
Start-Scene "S6"
Step "S6: Clean state for consistency test"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
& npm run dev -- init 2>&1 | Out-Null
& npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
& npm run dev -- scan $TEST_DATA_MIT --by alice 2>&1 | Out-Null

Step "S6: dry-run submit JSON capture"
& npm run dev -- dry-run submit --json compare-s6-dryrun.json 2>&1 | Out-Null
$s6dry = Read-JsonSafe "compare-s6-dryrun.json"
$s6dryComp = $null
if ($s6dry) {
    $s6dryComp = $s6dry.comparison
    REQ ($s6dryComp -ne $null) "s6 dry-run: comparison exists"
    REQ ($s6dry.summary.blockStage -eq "none") "s6 dry-run submit: blockStage=none"
}

Step "S6: Real submit - state should align with dry-run comparison"
& npm run dev -- submit --by alice 2>&1 | Out-Null
$s6state1 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
if ($s6dryComp) {
    $s6draftAfter = $s6state1.versions.($s6dryComp.draftVersionId)
    REQ ($s6draftAfter -ne $null) "s6 after submit: draft version still exists"
    REQ ($s6draftAfter.status -eq "pending_approval") "s6 after submit: status=pending_approval (matches dry-run canSubmit=true)"
}

Step "S6: dry-run publish JSON - comparison should match file counts"
& npm run dev -- dry-run publish --approver bob --json compare-s6-dryrun-pub.json 2>&1 | Out-Null
$s6dryPub = Read-JsonSafe "compare-s6-dryrun-pub.json"
if ($s6dryPub -and $s6dryComp) {
    REQ ($s6dryPub.comparison.addedFileCount -eq $s6dryComp.addedFileCount) "dry-run pub added count = dry-run submit added count"
    REQ ($s6dryPub.comparison.deletedFileCount -eq $s6dryComp.deletedFileCount) "dry-run pub deleted count = dry-run submit deleted count"
    REQ ($s6dryPub.comparison.modifiedFileCount -eq $s6dryComp.modifiedFileCount) "dry-run pub modified count = dry-run submit modified count"
    REQ ($s6dryPub.comparison.totalSizeDelta -eq $s6dryComp.totalSizeDelta) "dry-run pub size delta = dry-run submit size delta"
    REQ ($s6dryPub.comparison.willReplaceCurrentPublished -eq $false) "dry-run pub: willReplace=false (first pub)"
}

Step "S6: Real publish - check exported manifest matches comparison fileCount/size"
& npm run dev -- publish --approver bob --comment "s6 release" --show-compare 2>&1 | Out-Null
& npm run dev -- export --output compare-s6-manifest.json 2>&1 | Out-Null
$s6Manifest = Read-JsonSafe "compare-s6-manifest.json"
if ($s6Manifest -and $s6dryPub) {
    REQ ($s6Manifest.fileCount -eq $s6dryPub.comparison.draftLicenses.Count -or $s6Manifest.fileCount -gt 0) "manifest fileCount consistent (at least >0)"
    REQ ($s6Manifest.fileCount -eq $s6dryPub.fileCount) "manifest fileCount = dry-run fileCount"
    REQ ($s6Manifest.totalSize -eq $s6dryPub.totalSize) "manifest totalSize = dry-run totalSize"
    REQ ($s6Manifest.ruleVersion -eq $s6dryPub.comparison.ruleVersion) "manifest ruleVersion = comparison ruleVersion"
}

Step "S6: Summary consistency across JSON exports"
if ($s6dry -and $s6dryPub) {
    REQ ($s6dry.summary.targetVersionId -ne $null) "submit dry-run summary has targetVersionId"
    REQ ($s6dryPub.summary.targetVersionId -ne $null) "publish dry-run summary has targetVersionId"
    REQ ($s6dry.summary.ruleVersion -eq $s6dryPub.summary.ruleVersion) "both dry-runs have same ruleVersion in summary"
}
End-Scene "S6"

# ============================================================
# S7: submit/publish --dry-run aliases show comparison
# ============================================================
Start-Scene "S7"
Step "S7: Create fresh draft for alias test"
& npm run dev -- scan $TEST_DATA --by alice 2>&1 | Out-Null

Step "S7: submit --dry-run shows comparison view"
$s7subText = Strip-Ansi (& npm run dev -- submit --dry-run 2>&1 | Out-String)
REQ ($s7subText -match "DRY-RUN EXECUTION SUMMARY") "submit --dry-run: summary box present"
REQ ($s7subText -match "PUBLISHED VERSION") "submit --dry-run: PUBLISHED VERSION column present"
REQ ($s7subText -match "DRAFT VERSION") "submit --dry-run: DRAFT VERSION column present"
REQ ($s7subText -match "No state was changed") "submit --dry-run: explicitly says no state change"

Step "S7: publish --dry-run shows comparison view"
& npm run dev -- submit --by alice 2>&1 | Out-Null
$s7pubText = Strip-Ansi (& npm run dev -- publish --dry-run --approver bob 2>&1 | Out-String)
REQ ($s7pubText -match "DRY-RUN EXECUTION SUMMARY") "publish --dry-run: summary box present"
REQ ($s7pubText -match "FILE DIFFS") "publish --dry-run: FILE DIFFS section present"
REQ ($s7pubText -match "No state was changed") "publish --dry-run: explicitly says no state change"
End-Scene "S7"

# ============================================================
# SUMMARY
# ============================================================
Step "TEST SUMMARY"
Write-Host ""

$sceneLabels = [ordered]@{
    "S1" = "First-publish comparison view (no baseline)"
    "S2" = "File diffs against published baseline"
    "S3" = "License comparison & violation detection"
    "S4" = "Conflict detection (multiple_pending) + status commands"
    "S5" = "Cross-restart & config-change comparison consistency"
    "S6" = "Data consistency: dry-run == submit == publish == export"
    "S7" = "submit/publish --dry-run aliases show comparison"
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
Remove-Item compare-*.json, diff-*.json, conflict-*.json -ErrorAction SilentlyContinue
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
