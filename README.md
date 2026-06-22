# 离线数据集发布清单 CLI

一个离线数据集发布清单管理工具，支持多命令工作流：扫描、规则配置、校验、**预演**、送审、**预演**、发布、回滚和清单导出。每次发布都会保存成本地版本，适合在没有数据平台的机器上运行。

> ⚠️ **最佳实践：每次 submit 和 publish 前，务必先运行对应的 dry-run 预演命令**，提前发现配置、许可证、文件完整性等问题，避免真实操作后才发现失败。

## 功能特性

- ✅ **多命令工作流**: scan → **dry-run submit** → verify → submit → **dry-run publish** → publish → export
- ✅ **发布前预演**: dry-run 不改动任何状态，可反复运行，结果跨重启一致
- ✅ **稳定摘要**: 每次预演都输出统一的摘要框（目标版本 / 阻断阶段 / 替换标志 / 下一条命令）
- ✅ **版本管理**: 每次发布自动保存版本，支持回滚
- ✅ **规则引擎**: 哈希校验、大小限制、许可证规则
- ✅ **审批流程**: 草稿 → 待审 → 已发布
- ✅ **状态历史**: 完整的状态转换记录
- ✅ **数据一致性**: 重新打开 CLI 后所有数据（包括 dry-run 摘要关键字段）保持一致
- ✅ **失败安全**: 发布失败不影响当前版本
- ✅ **离线运行**: 无需网络连接，所有数据本地存储

## 样例目录结构

```
sample-data/
├── images/
│   ├── cat.jpg          # 图片文件
│   └── dog.jpg          # 图片文件
├── labels/
│   ├── train.csv        # 训练标签
│   └── val.csv          # 验证标签
├── LICENSE              # MIT 许可证文件
└── README.md            # 数据集说明
```

## 安装

```bash
npm install
npm run build
npm link  # 可选，全局安装 dataset-cli 命令
```

或者直接使用:

```bash
npm run dev -- <command>
```

## 快速开始

### 1. 初始化

```bash
# 初始化数据集清单系统
npm run dev -- init
```

初始化后会显示推荐工作流（含预演步骤）。

---

## 🔑 发布前预演 (Dry-Run) —— 这是你应该先看的部分

### 为什么需要预演？

发布操作不可逆（虽然可以回滚，但会留下历史痕迹）。预演命令 **100% 不改动任何状态**，可以：

- 反复运行验证配置调整效果
- 导出 JSON 给他人复核
- 重启 CLI 后结果保持一致
- 提前发现 license 硬阻断 / hash 不匹配等问题

### Dry-Run 命令总览

| 命令 | 作用 | 对应真实操作 |
|------|------|-------------|
| `dry-run submit [versionId]` | 预演提交：检查草稿能否进入待审 | `submit` |
| `dry-run publish [versionId] --approver <name>` | 预演发布：检查待审能否成为正式版本 | `publish` |
| `submit --dry-run` | 快捷别名：等同 `dry-run submit` | `submit` |
| `publish --dry-run --approver <name>` | 快捷别名：等同 `dry-run publish` | `publish` |
| `dry-run submit --json <path>` | 预演并导出 JSON（用于复核/归档） | — |
| `dry-run publish --json <path> --approver <name>` | 预演并导出 JSON | — |

### 每次预演都稳定展示的摘要字段

每次预演（无论文本输出还是 JSON 导出）都会在 `summary` 字段中稳定包含以下信息，**重启后再预演、修改配置后再预演、导出 JSON 给他人复核时完全一致**：

| 字段 | 含义 |
|------|------|
| `targetVersionLabel` | 目标版本号（如 `v1.0.0`） |
| `targetVersionId` | 目标版本唯一 ID |
| `targetVersionStatus` | 目标版本当前状态（draft / pending_approval 等） |
| `blockStage` | 阻断阶段内部标识（none / status_check / hard_block / verification） |
| `blockStageLabel` | 阻断阶段可读标签（Not blocked / Status Check / License Hard Block / Verification） |
| `willReplaceCurrentPublished` | 是否会替换当前已发布版本（布尔） |
| `currentPublishedVersionLabel` | 当前已发布版本号（若存在） |
| `currentPublishedVersionId` | 当前已发布版本 ID（若存在） |
| `suggestedNextCommand` | 建议执行的下一条命令（可复制粘贴） |
| `ruleVersion` | 所应用的规则版本号 |
| `fileCount` | 文件数量 |
| `totalSize` | 总字节数 |

文本输出中，摘要会以带边框的汇总框展示在最顶部。

---

### Dry-Run Submit 常见用法

#### 基础：预演提交最新草稿
```bash
npm run dev -- dry-run submit
```

#### 预演指定版本
```bash
npm run dev -- dry-run submit v1-abcdef123456
```

#### 预演并跳过哈希/大小（license 仍校验）
```bash
npm run dev -- dry-run submit --skip-verify
```

#### 导出 JSON 给审核人复核
```bash
npm run dev -- dry-run submit --json ./review/dryrun-submit-v1.json
```

#### 使用快捷别名
```bash
npm run dev -- submit --dry-run
```

**预演成功后下一步**：执行 `dataset-cli submit`（与预演一致的参数）

---

### Dry-Run Publish 常见用法

#### 基础：预演发布最新待审版本
```bash
npm run dev -- dry-run publish --approver reviewer-name
```

#### 预演指定版本
```bash
npm run dev -- dry-run publish v2-xyz789 --approver reviewer-name
```

#### 带审批备注的预演
```bash
npm run dev -- dry-run publish --approver bob --comment "数据集完整，合规"
```

#### 强制发布预演（仅覆盖哈希/大小，license 硬阻断仍生效）
```bash
npm run dev -- dry-run publish --approver bob --force
```

#### 跳过哈希/大小的预演
```bash
npm run dev -- dry-run publish --approver bob --skip-verify
```

#### 导出 JSON 给复核人
```bash
npm run dev -- dry-run publish --approver bob --json ./review/dryrun-publish-v2.json
```

#### 使用快捷别名
```bash
npm run dev -- publish --dry-run --approver bob
```

**预演成功后下一步**：执行 `dataset-cli publish --approver <name>`（与预演一致的参数）

### 预演被阻断时的处理策略

| 阻断阶段 | 含义 | 下一步操作 |
|---------|------|-----------|
| `Status Check` | 版本状态不对（如用已发布版本 submit） | 用 `scan` 创建新草稿，或用 `submit` 先把草稿提为待审 |
| `License Hard Block` | 许可证规则违规（不可绕过） | ① 改 `config set-license --allow` 放行对应 license，或 ② 替换非合规文件 → 重新 `scan` |
| `Verification` | 哈希/大小校验失败 | ① 修复文件 → 重 `scan`，或 ② 用 `--skip-verify` / `--force`（仅 submit/publish，dry-run 仅预演效果） |

---

## 完整工作流（含预演步骤）

```bash
# 1. 初始化
npm run dev -- init

# 2. 扫描数据集
npm run dev -- scan sample-data --by data-engineer

# 3. 查看状态
npm run dev -- status counts

# 4. 🔑 预演提交（不改动状态）
npm run dev -- dry-run submit
# 若被阻断 → 修复问题后重复此步，直到通过

# 5. 真实提交（通过预演后执行）
npm run dev -- submit --by data-engineer

# 6. 🔑 预演发布（不改动状态）
npm run dev -- dry-run publish --approver reviewer
# 若被阻断 → 修复问题后重复此步，直到通过

# 7. 真实发布（通过预演后执行）
npm run dev -- publish --approver reviewer --comment "数据完整，许可证合规"

# 8. 查看当前发布版本
npm run dev -- status current

# 9. 导出清单
npm run dev -- export --output ./dataset-manifest.json

# 10. 查看版本历史
npm run dev -- history flow
```

---

## 其他命令参考

### 扫描目录

```bash
# 扫描样例数据目录，创建草稿版本
npm run dev -- scan sample-data

# 带过滤选项的扫描
npm run dev -- scan sample-data --include "**/*.jpg" "**/*.csv"
npm run dev -- scan sample-data --exclude "**/tmp/**"
npm run dev -- scan sample-data --no-hash  # 跳过哈希计算（更快）
```

### 查看状态

```bash
# 查看所有版本状态
npm run dev -- status all

# 查看当前发布版本
npm run dev -- status current

# 按状态统计
npm run dev -- status counts

# 按状态过滤
npm run dev -- status all --filter draft
npm run dev -- status all --filter published
```

### 规则配置

```bash
# 查看当前配置
npm run dev -- config show

# 配置大小规则
npm run dev -- config set-size --min 0 --max 104857600  # 最大 100MB
npm run dev -- config set-size --disable  # 禁用大小校验

# 配置许可证规则
npm run dev -- config set-license --allow MIT Apache-2.0 BSD-3-Clause
npm run dev -- config set-license --require-license-file
npm run dev -- config set-license --no-require-license-file
npm run dev -- config set-license --disable  # 禁用许可证校验

# 配置哈希规则
npm run dev -- config set-hash --algorithm sha256
npm run dev -- config set-hash --disable  # 禁用哈希校验

# 重置为默认配置
npm run dev -- config reset
```

> 💡 **提示**：每次修改配置后，规则版本号会递增。重新运行 dry-run 可以验证新规则下的预演结果。

### 校验文件

```bash
# 校验最新草稿/待审版本
npm run dev -- verify

# 校验指定版本
npm run dev -- verify <versionId>

# 快速校验（仅检查文件存在，不重新计算哈希）
npm run dev -- verify --quick
```

### 提交审批

```bash
# 提交最新草稿版本
npm run dev -- submit

# 提交指定版本
npm run dev -- submit <versionId>

# 指定提交人
npm run dev -- submit --by alice

# 跳过校验提交（不推荐，哈希/大小可跳，许可证仍强制执行）
npm run dev -- submit --skip-verify

# 快捷预演：不改动状态
npm run dev -- submit --dry-run
```

### 发布版本

```bash
# 发布待审版本（必需审批人）
npm run dev -- publish --approver bob

# 发布指定版本
npm run dev -- publish <versionId> --approver bob

# 带审批备注
npm run dev -- publish --approver bob --comment "数据校验通过，符合发布标准"

# 强制发布（仅覆盖哈希/大小，许可证仍强制执行）
npm run dev -- publish --approver bob --force

# 快捷预演：不改动状态
npm run dev -- publish --dry-run --approver bob
```

### 导出清单

```bash
# 导出当前发布版本的清单
npm run dev -- export

# 导出到指定位置
npm run dev -- export --output ./my-dataset-manifest.json

# 导出指定版本
npm run dev -- export <versionId> --output ./manifest-v1.json
```

### 回滚版本

```bash
# 回滚到指定版本
npm run dev -- rollback <targetVersionId> --by alice

# 带回滚原因
npm run dev -- rollback <targetVersionId> --by alice --reason "新版本数据有问题"
```

### 查看历史

```bash
# 查看所有状态转换历史
npm run dev -- history all

# 查看指定版本的历史
npm run dev -- history version <versionId>

# 查看版本生命周期流程
npm run dev -- history flow
```

---

## 失败场景示例

### 失败场景 1: 预演 submit 发现 license 硬阻断

```bash
# 1. 配置严格规则（仅 Apache-2.0，但数据集是 MIT）
npm run dev -- config set-license --allow Apache-2.0
npm run dev -- scan sample-data

# 2. 预演 submit → 硬阻断
npm run dev -- dry-run submit
# 输出: BLOCKED at stage: License Hard Block
# 摘要框中 blockStageLabel = "License Hard Block"
# suggestedNextCommand = "dataset-cli config set-license --allow <licenses>"

# 3. 修复规则，重新预演
npm run dev -- config set-license --allow MIT Apache-2.0
npm run dev -- dry-run submit  # 现在通过

# 4. 真实提交
npm run dev -- submit --by alice
```

### 失败场景 2: 发布后回滚

```bash
# 1. 发布 v1
npm run dev -- scan sample-data
npm run dev -- dry-run submit && npm run dev -- submit
npm run dev -- dry-run publish --approver alice && npm run dev -- publish --approver alice

# 记录 v1 的 versionId（dry-run 摘要框和 JSON 中都有 targetVersionId）

# 2. 修改数据后发布 v2
echo "new data" > sample-data/images/new_file.jpg
npm run dev -- scan sample-data
npm run dev -- dry-run submit && npm run dev -- submit
npm run dev -- dry-run publish --approver alice && npm run dev -- publish --approver alice

# 3. 发现 v2 有问题，回滚到 v1
npm run dev -- rollback <v1-versionId> --by alice --reason "v2 contains corrupted data"

# 4. 验证回滚成功
npm run dev -- status current
# 应该显示 v1 为当前版本，v2 为 rolled_back 状态
```

### 失败场景 3: 跨重启预演一致性

```bash
# 1. 配置 + 扫描 + 预演 submit，导出 JSON
npm run dev -- init
npm run dev -- config set-license --allow MIT Apache-2.0
npm run dev -- scan sample-data
npm run dev -- dry-run submit --json ./before-restart.json

# 2. "重启" CLI（执行任意其他命令）
npm run dev -- status counts

# 3. 再预演一次，导出 JSON
npm run dev -- dry-run submit --json ./after-restart.json

# 4. 对比关键字段（summary 中所有字段应完全一致）
# targetVersionLabel / targetVersionId / blockStage / 
# willReplaceCurrentPublished / suggestedNextCommand / ruleVersion
```

---

## 存储结构

所有数据存储在工作目录下的 `.dataset/` 目录：

```
.dataset/
├── state.json              # 全局状态（当前版本、所有版本元数据、历史记录）
├── versions/               # 每个版本的详细数据
│   ├── v<timestamp>-<hash>.json
│   └── ...
├── manifests/              # 已发布的清单文件
│   ├── manifest-<versionId>.json
│   └── ...
└── exports/                # 导出的清单（可选）
```

## 状态说明

| 状态 | 说明 |
|------|------|
| `draft` | 草稿，刚扫描创建的版本。可 `dry-run submit` / `submit` |
| `pending_approval` | 待审，已提交等待审批。可 `dry-run publish` / `publish` |
| `published` | 已发布，当前生效版本 |
| `rolled_back` | 已回滚，曾经发布过但被回滚 |
| `rejected` | 已拒绝，审批未通过 |

## 数据一致性保证

重新打开 CLI 后，以下数据保持一致：

- ✅ 当前发布版本 (`currentVersion`)
- ✅ 被替换版本 (`previousVersion`)
- ✅ 审批备注 (`approvalComments`)
- ✅ 规则版本 (`ruleConfig.version`)
- ✅ 导出的清单 (`manifests/` 目录)
- ✅ 所有版本的状态历史
- ✅ **dry-run 摘要关键字段**（同一状态下再次预演，summary 字段一致）

可运行以下命令验证一致性：

```bash
npm run dev -- status current
```

## 命令总览

```
dataset-cli init                          # 初始化系统
dataset-cli scan <dir>                    # 扫描目录

dataset-cli dry-run submit [versionId]    # ★ 预演提交（推荐先运行）
dataset-cli dry-run publish [versionId]   # ★ 预演发布（推荐先运行）
dataset-cli submit --dry-run              # ★ 快捷预演：提交
dataset-cli publish --dry-run --approver  # ★ 快捷预演：发布

dataset-cli config show                   # 显示配置
dataset-cli config set-size               # 设置大小规则
dataset-cli config set-license            # 设置许可证规则
dataset-cli config set-hash               # 设置哈希规则
dataset-cli config reset                  # 重置配置

dataset-cli verify [versionId]            # 校验版本
dataset-cli submit [versionId]            # 提交审批
dataset-cli publish [versionId]           # 发布版本
dataset-cli rollback <versionId>          # 回滚版本
dataset-cli export [versionId]            # 导出清单

dataset-cli status all                    # 查看所有版本
dataset-cli status current                # 查看当前版本
dataset-cli status counts                 # 查看状态统计

dataset-cli history all                   # 查看所有历史
dataset-cli history version <id>          # 查看版本历史
dataset-cli history flow                  # 查看生命周期流程
```

## 许可证

MIT
