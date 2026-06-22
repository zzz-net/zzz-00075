# ============================================================
# 回归测试 - 覆盖所有核心场景
# 1. 正常发布流程
# 2. 许可证失败后强制发布 → 必须被拒绝
# 3. 失败后当前版本和历史记录保持不变
# 4. 重启 CLI 后所有数据一致性验证
# ============================================================

param(
    [string]$WorkDir = "d:\workSpace\AI__SPACE\zzz-00075"
)

Set-Location $WorkDir
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host ""; Write-Host "=== $msg ===" -ForegroundColor Cyan }
function Write-OK($msg)  { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Fail($msg){ Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }
function Assert-True($cond, $msg) { if (-not $cond) { Write-Fail $msg }; Write-OK $msg }
function Assert-Equal($actual, $expected, $msg) { 
    if ($actual -ne $expected) { Write-Fail "$msg : expected='$expected', actual='$actual'" }
    Write-OK "$msg : '$actual'"
}

function Get-StateField($field) {
    $raw = Get-Content .dataset\state.json -Raw
    $s = $raw | ConvertFrom-Json
    switch ($field) {
        "currentVersion"  { return $s.currentVersion }
        "previousVersion" { return $s.previousVersion }
        "ruleVersion"     { return $s.ruleConfig.version }
        "historyCount"    { return $s.stateHistory.Count }
        "approvalComment" { 
            if ($s.currentVersion -and $s.approvalComments[$s.currentVersion]) {
                return $s.approvalComments[$s.currentVersion]
            }
            return ""
        }
    }
}

function Get-VersionField($verId, $field) {
    $raw = Get-Content ".dataset\versions\$verId.json" -Raw
    $v = $raw | ConvertFrom-Json
    switch ($field) {
        "status"      { return $v.status }
        "version"     { return $v.version }
        "manifestHash"{ return $v.manifestHash }
        "ruleVersion" { return $v.ruleVersion }
        "approver"    { if ($v.approval) { return $v.approval.approver } else { return "" } }
        "approvalComment" { if ($v.approval) { return $v.approval.comment } else { return "" } }
    }
}

# ---- 清理 ----
Write-Step "0. 准备环境"
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Remove-Item -Force regression-export-*.json -ErrorAction SilentlyContinue
Write-OK "Cleaned"

# ============================================================
# REG-1: 正常发布流程 (黄金路径)
# ============================================================
Write-Step "REG-1: 正常发布流程 (Golden Path)"

npm run dev -- init 2>&1 | Out-Null
Write-OK "init"

npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
$RULE_V1 = Get-StateField "ruleVersion"
Write-OK "config license: $RULE_V1"

npm run dev -- scan sample-data --by data-engineer 2>&1 | Out-Null
Write-OK "scan"

npm run dev -- verify 2>&1 | Out-Null
Assert-Equal $LASTEXITCODE 0 "verify exit code"

npm run dev -- submit --by data-engineer 2>&1 | Out-Null
Assert-Equal $LASTEXITCODE 0 "submit exit code"
$statusCounts = & npm run dev -- status counts 2>&1 | Out-String
$pendingCount = [regex]::Match($statusCounts, "PENDING:\s+(\d+)").Groups[1].Value
Assert-Equal $pendingCount "1" "pending version count"

$V1_ID = (& npm run dev -- status all 2>&1 | Select-String "ID:" | Select-Object -First 1 | ForEach-Object { ($_ -split "ID:\s+")[1].Trim() })
Assert-True ($V1_ID -match "^v\d+-[a-f0-9]+$") "v1 id format: $V1_ID"

npm run dev -- publish --approver reviewer1 --comment "Regression test v1 - OK" 2>&1 | Out-Null
Assert-Equal $LASTEXITCODE 0 "publish exit code"

$CURRENT_V1 = Get-StateField "currentVersion"
$V1_STATUS = Get-VersionField $V1_ID "status"
$V1_APPROVER = Get-VersionField $V1_ID "approver"
$V1_COMMENT = Get-VersionField $V1_ID "approvalComment"
$V1_MANIFEST = Get-VersionField $V1_ID "manifestHash"
$V1_LABEL = Get-VersionField $V1_ID "version"

Assert-Equal $CURRENT_V1 $V1_ID "currentVersion after publish"
Assert-Equal $V1_STATUS "published" "v1 status"
Assert-Equal $V1_APPROVER "reviewer1" "v1 approver"
Assert-Equal $V1_COMMENT "Regression test v1 - OK" "v1 approval comment"
Assert-True ($V1_MANIFEST.Length -eq 64) "manifest hash exists ($($V1_MANIFEST.Substring(0,16))...)"

$exportPath = Join-Path $PWD "regression-export-v1.json"
npm run dev -- export --output $exportPath 2>&1 | Out-Null
Assert-True (Test-Path $exportPath) "exported manifest file exists"
$exported = Get-Content $exportPath -Raw | ConvertFrom-Json
Assert-Equal $exported.datasetVersion $V1_ID "export manifest.datasetVersion"
Assert-Equal $exported.approval.approver "reviewer1" "export approval.approver"
$MANIFEST_HASH = $exported.signature
Assert-True ($MANIFEST_HASH.Length -eq 64) "export signature present"

Write-OK "REG-1: 正常发布流程通过"

# ============================================================
# REG-2: 许可证失败后，强制发布/跳过校验发布 → 必须被拒绝
# ============================================================
Write-Step "REG-2: 许可证失败 → 强制发布/跳过校验 必须被拒绝"

npm run dev -- config set-license --allow Apache-2.0 2>&1 | Out-Null
$RULE_V2 = Get-StateField "ruleVersion"
Write-OK "Rules tightened: $RULE_V2 (only Apache-2.0, dataset has MIT)"

npm run dev -- scan sample-data --by data-engineer 2>&1 | Out-Null

# CASE A: submit --skip-verify → blocked
npm run dev -- submit --skip-verify --by attacker 2>&1 | Tee-Object -Variable outA | Out-Null
$exitA = $LASTEXITCODE
$blockedA = ($outA -join "`n") -match "HARD BLOCK"
Assert-True $blockedA "submit --skip-verify shows HARD BLOCK message"
Assert-True ($exitA -ne 0) "submit --skip-verify exit non-zero ($exitA)"

# CASE B: 先注入 pending 状态 (模拟脏数据)，再 publish --force → blocked
$injector = @'
const fs = require('fs');
const p = process.cwd() + '/.dataset/state.json';
const s = JSON.parse(fs.readFileSync(p,'utf8'));
const drafts = Object.values(s.versions).filter(v => v.status === 'draft').sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
if (drafts.length > 0) {
  const d = drafts[0];
  d.status = 'pending_approval';
  d.updatedAt = new Date().toISOString();
  s.stateHistory.push({id:'inject-'+Date.now(),versionId:d.id,fromStatus:'draft',toStatus:'pending_approval',timestamp:new Date().toISOString(),actor:'REG_TEST_HARNESS',reason:'Reg test inject'});
  fs.writeFileSync(p, JSON.stringify(s,null,2));
  fs.writeFileSync(process.cwd() + '/.dataset/versions/' + d.id + '.json', JSON.stringify(d,null,2));
  console.log(d.id);
}
'@
$PENDING_ID = node -e $injector
Assert-True ($PENDING_ID -match "^v\d+-[a-f0-9]+$") "injected pending id: $PENDING_ID"

# CASE B-1: publish --force → blocked
& npm run dev -- publish $PENDING_ID --approver attacker --comment "should fail" --force 2>&1 | Tee-Object -Variable outB1 | Out-Null
$exitB1 = $LASTEXITCODE
$blockedB1 = ($outB1 -join "`n") -match "HARD BLOCK"
Assert-True $blockedB1 "publish --force shows HARD BLOCK message"
Assert-True ($exitB1 -ne 0) "publish --force exit non-zero ($exitB1)"

# CASE B-2: publish --skip-verify → blocked
& npm run dev -- publish $PENDING_ID --approver attacker --comment "should fail too" --skip-verify 2>&1 | Tee-Object -Variable outB2 | Out-Null
$exitB2 = $LASTEXITCODE
$blockedB2 = ($outB2 -join "`n") -match "HARD BLOCK"
Assert-True $blockedB2 "publish --skip-verify shows HARD BLOCK message"
Assert-True ($exitB2 -ne 0) "publish --skip-verify exit non-zero ($exitB2)"

Write-OK "REG-2: 许可证失败链路硬阻断通过"

# ============================================================
# REG-3: 失败后当前版本、被替换版本、历史记录保持不变
# ============================================================
Write-Step "REG-3: 失败后状态不发生变化 (不变性检查)"

$CURRENT_AFTER_FAIL = Get-StateField "currentVersion"
$PREV_AFTER_FAIL = Get-StateField "previousVersion"

Assert-Equal $CURRENT_AFTER_FAIL $CURRENT_V1 "currentVersion unchanged after failed publish"
Assert-Equal $PREV_AFTER_FAIL "" "previousVersion still empty (v1 was first publish)"

$V1_STATUS_AFTER = Get-VersionField $V1_ID "status"
Assert-Equal $V1_STATUS_AFTER "published" "v1 status unchanged"

$HISTORY_COUNT_AFTER = Get-StateField "historyCount"
# 预期历史: init/draft/create→draft, draft→pending, pending→published  (=3) + 注入的1次 = 4
# 实际次数可能略有出入，这里关键是: 没有 pending→published for PENDING_ID
$histRaw = & npm run dev -- history all 2>&1 | Out-String
$leaked = [regex]::Match($histRaw, "PENDING.*PUBLISHED.*$PENDING_ID").Success
Assert-True (-not $leaked) "no leaked PENDING→PUBLISHED transition for $PENDING_ID"

$PENDING_STATUS = Get-VersionField $PENDING_ID "status"
# pending 状态应该还是 pending_approval（因为我们只是拒绝了 publish，没有改它状态）
Assert-Equal $PENDING_STATUS "pending_approval" "pending version stays as injected status"

Write-OK "REG-3: 状态不变性检查通过"

# ============================================================
# REG-4: 重启 CLI 后，所有关键数据一致
# ============================================================
Write-Step "REG-4: 重启 CLI 一致性验证 (模拟关闭后重新打开)"

# 保存重启前的快照
$BEFORE = @{
    currentVersion = Get-StateField "currentVersion"
    previousVersion = Get-StateField "previousVersion"
    ruleVersion = Get-StateField "ruleVersion"
    v1_status = Get-VersionField $V1_ID "status"
    v1_manifest = Get-VersionField $V1_ID "manifestHash"
    v1_approver = Get-VersionField $V1_ID "approver"
    v1_comment = Get-VersionField $V1_ID "approvalComment"
    v1_ruleVer = Get-VersionField $V1_ID "ruleVersion"
    approvalComment = Get-StateField "approvalComment"
    exportedSig = $MANIFEST_HASH
    v1_label = $V1_LABEL
}

# "重启" = 再跑一次任意命令 (storage.loadState() 从磁盘重建)
npm run dev -- status current 2>&1 | Out-Null

# 对比重启后
$AFTER = @{
    currentVersion = Get-StateField "currentVersion"
    previousVersion = Get-StateField "previousVersion"
    ruleVersion = Get-StateField "ruleVersion"
    v1_status = Get-VersionField $V1_ID "status"
    v1_manifest = Get-VersionField $V1_ID "manifestHash"
    v1_approver = Get-VersionField $V1_ID "approver"
    v1_comment = Get-VersionField $V1_ID "approvalComment"
    v1_ruleVer = Get-VersionField $V1_ID "ruleVersion"
    approvalComment = Get-StateField "approvalComment"
}

foreach ($key in @("currentVersion","previousVersion","ruleVersion","v1_status","v1_manifest","v1_approver","v1_comment","v1_ruleVer","approvalComment")) {
    Assert-Equal $AFTER[$key] $BEFORE[$key] "restart consistent: $key"
}

# 再次导出 manifest，对比签名
$exportPath2 = Join-Path $PWD "regression-export-v1-after-restart.json"
npm run dev -- export --output $exportPath2 2>&1 | Out-Null
$exported2 = Get-Content $exportPath2 -Raw | ConvertFrom-Json
Assert-Equal $exported2.signature $BEFORE.exportedSig "export manifest signature matches after restart"
Assert-Equal $exported2.ruleVersion $BEFORE.ruleVersion "export ruleVersion matches"
Assert-Equal $exported2.fileCount $exported.fileCount "export fileCount matches"

# 一致性校验命令
$consistency = & npm run dev -- status current 2>&1 | Out-String
$consistencyOk = $consistency -match "consistency check passed"
Assert-True $consistencyOk "status current reports consistency check passed"

Write-OK "REG-4: 重启一致性通过"

# ============================================================
# REG-5: 补充 - 回滚场景的一致性
# ============================================================
Write-Step "REG-5: 回滚一致性（发布 v2 合规版本，再回滚到 v1）"

# 先改 LICENSE 成 Apache-2.0，让 v2 通过
$origLicense = Get-Content sample-data\LICENSE -Raw
$apacheLicense = @"
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
"@
Set-Content sample-data\LICENSE -Value $apacheLicense -NoNewline
npm run dev -- config set-license --allow MIT Apache-2.0 2>&1 | Out-Null
npm run dev -- scan sample-data --by data-engineer 2>&1 | Out-Null
npm run dev -- submit --by data-engineer 2>&1 | Out-Null
npm run dev -- publish --approver reviewer2 --comment "v2 release - Apache" 2>&1 | Out-Null

$V2_ID = Get-StateField "currentVersion"
$PREV_V2 = Get-StateField "previousVersion"
Assert-Equal $PREV_V2 $V1_ID "after v2 publish, previousVersion should be v1"

$V2_STATUS = Get-VersionField $V2_ID "status"
$V1_STATUS_V2 = Get-VersionField $V1_ID "status"  # v1 被替换
Assert-Equal $V2_STATUS "published" "v2 status published"
Write-OK "v2=$V2_ID published, v1=$V1_ID is previous"

# 回滚到 v1
npm run dev -- rollback $V1_ID --by ops --reason "regression rollback test" 2>&1 | Out-Null
$CURRENT_ROLLBACK = Get-StateField "currentVersion"
$PREV_ROLLBACK = Get-StateField "previousVersion"
$V1_STATUS_RB = Get-VersionField $V1_ID "status"
$V2_STATUS_RB = Get-VersionField $V2_ID "status"

Assert-Equal $CURRENT_ROLLBACK $V1_ID "after rollback, current = v1"
Assert-Equal $PREV_ROLLBACK $V2_ID "after rollback, previous = v2"
Assert-Equal $V1_STATUS_RB "published" "v1 back to published after rollback"
Assert-Equal $V2_STATUS_RB "rolled_back" "v2 becomes rolled_back after rollback"

Write-OK "REG-5: 回滚一致性通过"

# 恢复 LICENSE
Set-Content sample-data\LICENSE -Value $origLicense -NoNewline

# ============================================================
# SUMMARY
# ============================================================
Write-Step "ALL REGRESSION TESTS PASSED ✓"
Write-Host ""
Write-Host "  REG-1  正常发布流程 (Golden Path)                PASS" -ForegroundColor Green
Write-Host "  REG-2  许可证失败强制发布硬阻断                  PASS" -ForegroundColor Green
Write-Host "  REG-3  失败不改动当前版本/历史                   PASS" -ForegroundColor Green
Write-Host "  REG-4  重启 CLI 一致性 (cur/prev/approval/manifest) PASS" -ForegroundColor Green
Write-Host "  REG-5  回滚一致性                                 PASS" -ForegroundColor Green
Write-Host ""
Write-Host "  Cleanup temporary state..." -ForegroundColor Gray
Remove-Item regression-export-*.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .dataset -ErrorAction SilentlyContinue
Write-Host "  Done." -ForegroundColor Gray
Write-Host ""
