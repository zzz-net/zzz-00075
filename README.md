# 离线数据集发布清单 CLI

一个离线数据集发布清单管理工具，支持多命令工作流：扫描、规则配置、校验、送审、发布、回滚和清单导出。每次发布都会保存成本地版本，适合在没有数据平台的机器上运行。

## 功能特性

- ✅ **多命令工作流**: scan → verify → submit → publish → export
- ✅ **版本管理**: 每次发布自动保存版本，支持回滚
- ✅ **规则引擎**: 哈希校验、大小限制、许可证规则
- ✅ **审批流程**: 草稿 → 待审 → 已发布
- ✅ **状态历史**: 完整的状态转换记录
- ✅ **数据一致性**: 重新打开 CLI 后所有数据保持一致
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

### 2. 扫描目录

```bash
# 扫描样例数据目录，创建草稿版本
npm run dev -- scan sample-data

# 带过滤选项的扫描
npm run dev -- scan sample-data --include "**/*.jpg" "**/*.csv"
npm run dev -- scan sample-data --exclude "**/tmp/**"
npm run dev -- scan sample-data --no-hash  # 跳过哈希计算（更快）
```

### 3. 查看状态

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

### 4. 规则配置

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

### 5. 发布前预演 (Dry Run)

```bash
# 校验最新草稿版本
npm run dev -- verify

# 校验指定版本
npm run dev -- verify <versionId>

# 快速校验（仅检查文件存在，不重新计算哈希）
npm run dev -- verify --quick
```

### 7. 提交审批

```bash
# 提交最新草稿版本
npm run dev -- submit

# 提交指定版本
npm run dev -- submit <versionId>

# 指定提交人
npm run dev -- submit --by alice

# 跳过校验提交（不推荐，哈希/大小可跳，许可证仍强制执行）
npm run dev -- submit --skip-verify
```

### 8. 发布版本

```bash
# 发布待审版本（必需审批人）
npm run dev -- publish --approver bob

# 发布指定版本
npm run dev -- publish <versionId> --approver bob

# 带审批备注
npm run dev -- publish --approver bob --comment "数据校验通过，符合发布标准"

# 强制发布（仅覆盖哈希/大小，许可证仍强制执行）
npm run dev -- publish --approver bob --force
```

### 9. 导出清单

```bash
# 导出当前发布版本的清单
npm run dev -- export

# 导出到指定位置
npm run dev -- export --output ./my-dataset-manifest.json

# 导出指定版本
npm run dev -- export <versionId> --output ./manifest-v1.json
```

### 10. 回滚版本

```bash
# 回滚到指定版本
npm run dev -- rollback <targetVersionId> --by alice

# 带回滚原因
npm run dev -- rollback <targetVersionId> --by alice --reason "新版本数据有问题"
```

### 11. 查看历史

```bash
# 查看所有状态转换历史
npm run dev -- history all

# 查看指定版本的历史
npm run dev -- history version <versionId>

# 查看版本生命周期流程
npm run dev -- history flow
```

## 完整工作流示例

### 正常发布流程

```bash
# 1. 初始化
npm run dev -- init

# 2. 扫描数据集
npm run dev -- scan sample-data --by data-engineer

# 3. 查看草稿状态
npm run dev -- status counts

# 4. 校验文件
npm run dev -- verify

# 5. 提交审批
npm run dev -- submit --by data-engineer

# 6. 审批并发布
npm run dev -- publish --approver reviewer --comment "数据完整，许可证合规"

# 7. 查看当前发布版本
npm run dev -- status current

# 8. 导出清单
npm run dev -- export --output ./dataset-manifest.json

# 9. 查看版本历史
npm run dev -- history flow
```

### 失败场景 1: 扫描后文件被删除

```bash
# 1. 扫描
npm run dev -- scan sample-data

# 2. 删除扫描过的文件
rm sample-data/images/cat.jpg

# 3. 校验时会检测到文件缺失
npm run dev -- verify
# 输出: Missing files detected: images/cat.jpg

# 4. 无法提交或发布，必须修复文件后重新扫描
```

### 失败场景 2: 许可证规则未通过仍尝试发布

```bash
# 1. 配置严格的许可证规则
npm run dev -- config set-license --allow Apache-2.0

# 2. 扫描并提交（MIT 许可证不在允许列表中）
npm run dev -- scan sample-data
npm run dev -- submit

# 3. 发布时许可证校验失败
npm run dev -- publish --approver bob
# 输出: License "MIT" is not in allowed list: Apache-2.0

# 4. 必须修改许可证或放宽规则后才能发布
npm run dev -- config set-license --allow MIT Apache-2.0
npm run dev -- publish --approver bob
```

### 失败场景 3: 从新版回滚到旧版

```bash
# 1. 发布 v1
npm run dev -- scan sample-data
npm run dev -- submit
npm run dev -- publish --approver alice --comment "Initial release"

# 记录 v1 的 versionId

# 2. 修改数据后发布 v2
echo "new data" > sample-data/images/new_file.jpg
npm run dev -- scan sample-data
npm run dev -- submit
npm run dev -- publish --approver alice --comment "Added new files"

# 3. 发现 v2 有问题，回滚到 v1
npm run dev -- rollback <v1-versionId> --by alice --reason "v2 contains corrupted data"

# 4. 验证回滚成功
npm run dev -- status current
# 应该显示 v1 为当前版本，v2 为 rolled_back 状态
```

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
| `draft` | 草稿，刚扫描创建的版本 |
| `pending_approval` | 待审，已提交等待审批 |
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

可运行以下命令验证一致性：

```bash
npm run dev -- status current
```

## 命令总览

```
dataset-cli init                          # 初始化系统
dataset-cli scan <dir>                    # 扫描目录
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
