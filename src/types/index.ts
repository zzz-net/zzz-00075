export type VersionStatus = 'draft' | 'pending_approval' | 'published' | 'rejected' | 'rolled_back';

export interface FileEntry {
  path: string;
  size: number;
  sha256: string;
  license?: string;
}

export interface ValidationRule {
  id: string;
  type: 'hash' | 'size' | 'license';
  enabled: boolean;
  config: {
    minSize?: number;
    maxSize?: number;
    allowedLicenses?: string[];
    requiredLicenseFile?: boolean;
    hashAlgorithm?: 'sha256';
  };
}

export interface RuleConfig {
  version: string;
  createdAt: string;
  updatedAt: string;
  rules: ValidationRule[];
}

export interface ApprovalInfo {
  approver: string;
  comment: string;
  approvedAt: string;
  ruleVersion: string;
}

export interface DatasetVersion {
  id: string;
  version: string;
  status: VersionStatus;
  scanDir: string;
  files: FileEntry[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  ruleVersion: string;
  approval?: ApprovalInfo;
  previousVersion?: string;
  replacedBy?: string;
  exportPath?: string;
  manifestHash?: string;
}

export interface StateTransition {
  id: string;
  versionId: string;
  fromStatus: VersionStatus;
  toStatus: VersionStatus;
  timestamp: string;
  actor: string;
  reason: string;
}

export interface CLIState {
  currentVersion: string | null;
  previousVersion: string | null;
  versions: Record<string, DatasetVersion>;
  stateHistory: StateTransition[];
  ruleConfig: RuleConfig;
  approvalComments: Record<string, string>;
}

export interface ScanOptions {
  includePatterns?: string[];
  excludePatterns?: string[];
  computeHash?: boolean;
}

export interface VerifyResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  fileResults: {
    filePath: string;
    hashOk: boolean;
    sizeOk: boolean;
    licenseOk: boolean;
    errors: string[];
  }[];
}

export interface Manifest {
  version: string;
  datasetVersion: string;
  generatedAt: string;
  ruleVersion: string;
  files: FileEntry[];
  totalSize: number;
  fileCount: number;
  approval: ApprovalInfo;
  signature?: string;
}

export type DryRunAction = 'submit' | 'publish';
export type DryRunBlockStage = 'none' | 'status_check' | 'hard_block' | 'verification' | null;

export interface DryRunResult {
  action: DryRunAction;
  timestamp: string;
  versionId: string;
  versionLabel: string;
  candidateVersion: string;
  currentStatus: VersionStatus;
  ruleVersion: string;
  rulesSnapshot: ValidationRule[];
  files: FileEntry[];
  fileCount: number;
  totalSize: number;
  currentPublishedVersionId: string | null;
  currentPublishedVersionLabel: string | null;
  currentPublishedWouldBeReplaced: boolean;
  previousVersionId: string | null;
  verifyResult: VerifyResult;
  hardBlock: { blocked: boolean; reasons: string[] };
  canSubmit: boolean;
  canPublish: boolean;
  blockedAt: DryRunBlockStage;
  blockReasons: string[];
  nextSteps: string[];
  skipVerifyUsed: boolean;
  forceUsed: boolean;
}
