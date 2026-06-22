# ============================================================
# Candidate Version Consistency Regression Tests
# 验证 dry-run 里的版本号/ID/状态与真实 submit/publish 完全一致
# ============================================================

param([string]$WorkDir = "d:\workSpace\AI__SPACE\zzz-00075")
Set-Location $WorkDir
$ErrorActionPreference = "Continue"

function Step($msg)   { Write-Host ""; Write-Host ("=== " + $msg + " ===") -ForegroundColor Cyan }
function OK($msg)     { Write-Host ("  [OK] " + $msg) -ForegroundColor Green }
function FAIL($msg)   { Write-Host ("  [FAIL] " + $msg) -ForegroundColor Red; $script:failed = $true }
function REQ($cond, $msg) { if (-not $cond) { FAIL $msg } else { OK $msg } }

$script:failed = $false

# ---- cleanup ----
Step "0. Cleanup"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Remove-Item -Force dryrun-*.json -ErrorAction SilentlyContinue
& npm run dev -- init *>&1 | Out-Null
& npm run dev -- config set-license --allow MIT Apache-2.0 *>&1 | Out-Null
OK "init done"

# ============================================================
# TEST 1: dry-run submit versionLabel/versionId == 真实 submit
# ============================================================
Step "TEST 1: dry-run submit vs real submit - versionId and versionLabel must match"

& npm run dev -- scan sample-data --by alice *>&1 | Out-Null

# dry-run
& npm run dev -- dry-run submit --json dryrun-t1.json *>&1 | Out-Null
$dr1 = Get-Content dryrun-t1.json -Raw | ConvertFrom-Json
REQ ($dr1.action -eq "submit") "dry-run action=submit"
REQ ($dr1.candidateVersion -eq $dr1.versionLabel) "candidateVersion == versionLabel ($($dr1.candidateVersion))"
REQ ($dr1.currentStatus -eq "draft") "currentStatus=draft"

$DR1_VID = $dr1.versionId
$DR1_VLABEL = $dr1.versionLabel
$DR1_CAND = $dr1.candidateVersion
OK "dry-run: id=$DR1_VID label=$DR1_VLABEL candidate=$DR1_CAND"

# real submit
& npm run dev -- submit --by alice *>&1 | Out-Null
$state = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$realVersion = $state.versions.$DR1_VID
REQ ($null -ne $realVersion) "real version exists for id=$DR1_VID"
REQ ($realVersion.version -eq $DR1_VLABEL) "real version label matches ($($realVersion.version) == $DR1_VLABEL)"
REQ ($realVersion.version -eq $DR1_CAND) "real version label == candidateVersion"
REQ ($realVersion.status -eq "pending_approval") "real status=pending_approval"
$T1_VER = $DR1_VLABEL
OK "TEST 1 PASSED: candidateVersion matches real submit"

# ============================================================
# TEST 2: dry-run publish versionLabel/versionId == 真实 publish
# ============================================================
Step "TEST 2: dry-run publish vs real publish - all key fields match"

# dry-run publish
& npm run dev -- dry-run publish --approver bob --comment "release v1" --json dryrun-t2.json *>&1 | Out-Null
$dr2 = Get-Content dryrun-t2.json -Raw | ConvertFrom-Json
REQ ($dr2.action -eq "publish") "dry-run action=publish"
REQ ($dr2.candidateVersion -eq $dr2.versionLabel) "candidateVersion == versionLabel ($($dr2.candidateVersion))"
REQ ($dr2.versionId -eq $DR1_VID) "same versionId as submit ($DR1_VID)"
REQ ($dr2.currentStatus -eq "pending_approval") "currentStatus=pending_approval"
REQ ($dr2.canPublish -eq $true) "canPublish=true"
REQ ($dr2.currentPublishedWouldBeReplaced -eq $false) "first publish: wouldBeReplaced=false"
REQ ($dr2.currentPublishedVersionId -eq $null) "first publish: no currentVersion yet"

$DR2_VID = $dr2.versionId
$DR2_VLABEL = $dr2.versionLabel
$DR2_RULE = $dr2.ruleVersion
$DR2_FILES = $dr2.fileCount
$DR2_SIZE = $dr2.totalSize
OK "dry-run: id=$DR2_VID label=$DR2_VLABEL rule=$DR2_RULE files=$DR2_FILES size=$DR2_SIZE"

# real publish
& npm run dev -- publish --approver bob --comment "release v1" *>&1 | Out-Null
$state2 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$realPub = $state2.versions.$DR2_VID
REQ ($null -ne $realPub) "real published version exists"
REQ ($realPub.version -eq $DR2_VLABEL) "real version label matches dry-run"
REQ ($realPub.status -eq "published") "real status=published"
REQ ($realPub.approval.approver -eq "bob") "approver=bob"
REQ ($realPub.approval.comment -eq "release v1") "comment matches"
REQ ($realPub.ruleVersion -eq $DR2_RULE) "ruleVersion matches"
REQ ($realPub.files.Count -eq $DR2_FILES) "fileCount matches"
$total = ($realPub.files | Measure-Object size -Sum).Sum
REQ ($total -eq $DR2_SIZE) "totalSize matches ($total == $DR2_SIZE)"
REQ ($state2.currentVersion -eq $DR2_VID) "currentVersion set to this version"

# export manifest, compare
& npm run dev -- export --output export-t2.json *>&1 | Out-Null
$manifest = Get-Content export-t2.json -Raw | ConvertFrom-Json
REQ ($manifest.datasetVersion -eq $DR2_VID) "manifest.datasetVersion == dry-run versionId"
REQ ($manifest.ruleVersion -eq $DR2_RULE) "manifest.ruleVersion == dry-run ruleVersion"
REQ ($manifest.fileCount -eq $DR2_FILES) "manifest.fileCount == dry-run fileCount"
REQ ($manifest.totalSize -eq $DR2_SIZE) "manifest.totalSize == dry-run totalSize"
REQ ($manifest.approval.approver -eq "bob") "manifest.approver=bob"
OK "TEST 2 PASSED: all key fields match between dry-run and real publish"

# ============================================================
# TEST 3: dry-run publish v2 shows v1 would be replaced
# ============================================================
Step "TEST 3: dry-run publish v2 - current published impact is correct"

& npm run dev -- scan sample-data --by alice *>&1 | Out-Null
& npm run dev -- submit --by alice *>&1 | Out-Null

& npm run dev -- dry-run publish --approver carol --comment "v2" --json dryrun-t3.json *>&1 | Out-Null
$dr3 = Get-Content dryrun-t3.json -Raw | ConvertFrom-Json
REQ ($dr3.currentPublishedVersionId -eq $DR2_VID) "currentPublishedVersionId == v1"
REQ ($dr3.currentPublishedVersionLabel -eq $T1_VER) "currentPublishedVersionLabel == $T1_VER"
REQ ($dr3.currentPublishedWouldBeReplaced -eq $true) "v1 would be replaced by v2"
REQ ($dr3.previousVersionId -eq $DR2_VID) "previousVersionId == v1 id"
OK "TEST 3 PASSED: current published impact displayed correctly"

# ============================================================
# TEST 4: dry-run submit 被许可证硬阻断，真实 submit 也被阻断
# ============================================================
Step "TEST 4: dry-run submit blocked by license -> real submit also blocked"

& npm run dev -- config set-license --allow Apache-2.0 *>&1 | Out-Null
& npm run dev -- scan sample-data --by alice *>&1 | Out-Null

& npm run dev -- dry-run submit --json dryrun-t4.json *>&1 | Out-Null
$dr4 = Get-Content dryrun-t4.json -Raw | ConvertFrom-Json
REQ ($dr4.canSubmit -eq $false) "dry-run canSubmit=false"
REQ ($dr4.blockedAt -eq "hard_block") "dry-run blockedAt=hard_block"
REQ ($dr4.hardBlock.blocked -eq $true) "hardBlock.blocked=true"

$DR4_VID = $dr4.versionId
OK "dry-run predicts submit will be blocked at hard_block"

# real submit
& npm run dev -- submit --by alice *>&1 | Out-Null
REQ ($LASTEXITCODE -ne 0) "real submit also fails (exit=$LASTEXITCODE)"
$state4 = Get-Content .dataset\state.json -Raw | ConvertFrom-Json
$ver4 = $state4.versions.$DR4_VID
REQ ($ver4.status -eq "draft") "real version stays draft (status not leaked)"
OK "TEST 4 PASSED: dry-run and real submit both blocked by license hard block"

# ============================================================
# TEST 5: dry-run --help 命令可用性（文档新增命令可用性验证）
# ============================================================
Step "TEST 5: Command availability (docs / --help)"

$helpOut = (& npm run dev -- --help *>&1 | Out-String)
REQ ($helpOut -match "dry-run") "top-level help mentions dry-run"

$drHelp = (& npm run dev -- dry-run --help *>&1 | Out-String)
REQ ($drHelp -match "submit") "dry-run help mentions submit"
REQ ($drHelp -match "publish") "dry-run help mentions publish"

$drSubHelp = (& npm run dev -- dry-run submit --help *>&1 | Out-String)
REQ ($drSubHelp -match "skip-verify") "dry-run submit --help shows --skip-verify"
REQ ($drSubHelp -match "\-\-json") "dry-run submit --help shows --json"

$drPubHelp = (& npm run dev -- dry-run publish --help *>&1 | Out-String)
REQ ($drPubHelp -match "approver") "dry-run publish --help shows --approver"
REQ ($drPubHelp -match "\-\-force") "dry-run publish --help shows --force"
REQ ($drPubHelp -match "\-\-json") "dry-run publish --help shows --json"
OK "TEST 5 PASSED: dry-run commands discoverable via --help"

# ============================================================
# TEST 6: 重启动后 dry-run 结果一致（状态来源一致）
# ============================================================
Step "TEST 6: Restart CLI -> dry-run results identical"

# 先恢复规则，扫一个版本
& npm run dev -- config set-license --allow MIT Apache-2.0 *>&1 | Out-Null
& npm run dev -- scan sample-data --by alice *>&1 | Out-Null

# 重启前 dry-run
& npm run dev -- dry-run submit --json dryrun-t6a.json *>&1 | Out-Null
$before = Get-Content dryrun-t6a.json -Raw | ConvertFrom-Json

# 模拟重启 - 跑一条会 loadState 的命令
& npm run dev -- status current *>&1 | Out-Null

# 重启后 dry-run
& npm run dev -- dry-run submit --json dryrun-t6b.json *>&1 | Out-Null
$after = Get-Content dryrun-t6b.json -Raw | ConvertFrom-Json

REQ ($before.versionId -eq $after.versionId) "versionId same after restart"
REQ ($before.versionLabel -eq $after.versionLabel) "versionLabel same after restart"
REQ ($before.candidateVersion -eq $after.candidateVersion) "candidateVersion same after restart"
REQ ($before.ruleVersion -eq $after.ruleVersion) "ruleVersion same after restart"
REQ ($before.canSubmit -eq $after.canSubmit) "canSubmit same after restart"
REQ ($before.blockedAt -eq $after.blockedAt) "blockedAt same after restart"
REQ ($before.fileCount -eq $after.fileCount) "fileCount same after restart"
REQ ($before.currentPublishedVersionId -eq $after.currentPublishedVersionId) "currentPublishedVersionId same after restart"
OK "TEST 6 PASSED: dry-run results identical after restart"

# ============================================================
# SUMMARY
# ============================================================
Step "ALL TESTS RESULT"
if ($script:failed) {
    Write-Host "  SOME TESTS FAILED!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "  ALL 6 TESTS PASSED" -ForegroundColor Green
}
Write-Host ""
Write-Host "  T1: dry-run submit version == real submit version" -ForegroundColor Green
Write-Host "  T2: dry-run publish all key fields == real publish" -ForegroundColor Green
Write-Host "  T3: current published impact displayed correctly" -ForegroundColor Green
Write-Host "  T4: dry-run hard block matches real submit hard block" -ForegroundColor Green
Write-Host "  T5: command discoverable via --help" -ForegroundColor Green
Write-Host "  T6: restart -> dry-run results identical" -ForegroundColor Green
Write-Host ""

# cleanup
Remove-Item dryrun-*.json, export-*.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
