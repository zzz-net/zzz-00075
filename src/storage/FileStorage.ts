import * as fs from 'fs';
import * as path from 'path';
import { 
  CLIState, 
  DatasetVersion, 
  StateTransition, 
  RuleConfig,
  VersionStatus,
  Manifest
} from '../types';
import { generateId, generateVersionId, computeObjectSha256 } from '../utils/hash';

export class FileStorage {
  private readonly baseDir: string;
  private readonly stateFile: string;
  private readonly versionsDir: string;
  private readonly manifestsDir: string;
  private readonly exportsDir: string;

  constructor(workDir: string = process.cwd()) {
    this.baseDir = path.join(workDir, '.dataset');
    this.stateFile = path.join(this.baseDir, 'state.json');
    this.versionsDir = path.join(this.baseDir, 'versions');
    this.manifestsDir = path.join(this.baseDir, 'manifests');
    this.exportsDir = path.join(this.baseDir, 'exports');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.baseDir, this.versionsDir, this.manifestsDir, this.exportsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  private getDefaultRuleConfig(): RuleConfig {
    const now = new Date().toISOString();
    return {
      version: 'v1',
      createdAt: now,
      updatedAt: now,
      rules: [
        {
          id: 'rule-hash-1',
          type: 'hash',
          enabled: true,
          config: { hashAlgorithm: 'sha256' }
        },
        {
          id: 'rule-size-1',
          type: 'size',
          enabled: true,
          config: { minSize: 0, maxSize: 1024 * 1024 * 1024 }
        },
        {
          id: 'rule-license-1',
          type: 'license',
          enabled: true,
          config: {
            allowedLicenses: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'CC0-1.0', 'CC-BY-4.0'],
            requiredLicenseFile: true
          }
        }
      ]
    };
  }

  private getDefaultState(): CLIState {
    return {
      currentVersion: null,
      previousVersion: null,
      versions: {},
      stateHistory: [],
      ruleConfig: this.getDefaultRuleConfig(),
      approvalComments: {}
    };
  }

  loadState(): CLIState {
    if (!fs.existsSync(this.stateFile)) {
      const defaultState = this.getDefaultState();
      this.saveState(defaultState);
      return defaultState;
    }

    try {
      const content = fs.readFileSync(this.stateFile, 'utf8');
      const state = JSON.parse(content) as CLIState;
      return state;
    } catch (error) {
      console.warn('Failed to load state, using default:', error);
      const defaultState = this.getDefaultState();
      this.saveState(defaultState);
      return defaultState;
    }
  }

  saveState(state: CLIState): void {
    const tempFile = `${this.stateFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempFile, this.stateFile);
  }

  saveVersion(version: DatasetVersion): void {
    const versionFile = path.join(this.versionsDir, `${version.id}.json`);
    fs.writeFileSync(versionFile, JSON.stringify(version, null, 2), 'utf8');
  }

  loadVersion(versionId: string): DatasetVersion | null {
    const versionFile = path.join(this.versionsDir, `${versionId}.json`);
    if (!fs.existsSync(versionFile)) {
      return null;
    }
    try {
      const content = fs.readFileSync(versionFile, 'utf8');
      return JSON.parse(content) as DatasetVersion;
    } catch {
      return null;
    }
  }

  saveManifest(manifest: Manifest): string {
    const manifestPath = path.join(this.manifestsDir, `manifest-${manifest.datasetVersion}.json`);
    const content = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(manifestPath, content, 'utf8');
    return manifestPath;
  }

  loadManifest(versionId: string): Manifest | null {
    const manifestPath = path.join(this.manifestsDir, `manifest-${versionId}.json`);
    if (!fs.existsSync(manifestPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(manifestPath, 'utf8');
      return JSON.parse(content) as Manifest;
    } catch {
      return null;
    }
  }

  exportManifest(manifest: Manifest, exportPath: string): string {
    const absolutePath = path.resolve(exportPath);
    const content = JSON.stringify(manifest, null, 2);
    fs.writeFileSync(absolutePath, content, 'utf8');
    return absolutePath;
  }

  addStateTransition(
    state: CLIState,
    versionId: string,
    fromStatus: VersionStatus,
    toStatus: VersionStatus,
    actor: string,
    reason: string
  ): CLIState {
    const transition: StateTransition = {
      id: generateId(),
      versionId,
      fromStatus,
      toStatus,
      timestamp: new Date().toISOString(),
      actor,
      reason
    };
    return {
      ...state,
      stateHistory: [...state.stateHistory, transition]
    };
  }

  updateVersionStatus(
    state: CLIState,
    versionId: string,
    newStatus: VersionStatus,
    actor: string,
    reason: string
  ): CLIState {
    const version = state.versions[versionId];
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    const oldStatus = version.status;
    const updatedVersion: DatasetVersion = {
      ...version,
      status: newStatus,
      updatedAt: new Date().toISOString()
    };

    let newState = {
      ...state,
      versions: {
        ...state.versions,
        [versionId]: updatedVersion
      }
    };

    newState = this.addStateTransition(newState, versionId, oldStatus, newStatus, actor, reason);
    
    this.saveVersion(updatedVersion);
    return newState;
  }

  createVersion(
    state: CLIState,
    scanDir: string,
    files: any[],
    createdBy: string = 'system'
  ): { state: CLIState; version: DatasetVersion } {
    const versionNumber = Object.keys(state.versions).length + 1;
    const versionId = generateVersionId();
    const now = new Date().toISOString();

    const newVersion: DatasetVersion = {
      id: versionId,
      version: `v${versionNumber}.0.0`,
      status: 'draft',
      scanDir: path.resolve(scanDir),
      files,
      createdAt: now,
      updatedAt: now,
      createdBy,
      ruleVersion: state.ruleConfig.version,
      previousVersion: state.currentVersion || undefined
    };

    let newState = {
      ...state,
      versions: {
        ...state.versions,
        [versionId]: newVersion
      }
    };

    newState = this.addStateTransition(newState, versionId, 'draft' as VersionStatus, 'draft' as VersionStatus, createdBy, 'Version created from scan');
    
    this.saveVersion(newVersion);
    return { state: newState, version: newVersion };
  }

  publishVersion(
    state: CLIState,
    versionId: string,
    approver: string,
    approvalComment: string
  ): { state: CLIState; manifest: Manifest } {
    const version = state.versions[versionId];
    if (!version) {
      throw new Error(`Version not found: ${versionId}`);
    }

    const now = new Date().toISOString();
    const previousPublished = state.currentVersion;

    const approval = {
      approver,
      comment: approvalComment,
      approvedAt: now,
      ruleVersion: state.ruleConfig.version
    };

    const manifest: Manifest = {
      version: '1.0',
      datasetVersion: version.id,
      generatedAt: now,
      ruleVersion: state.ruleConfig.version,
      files: version.files,
      totalSize: version.files.reduce((sum, f) => sum + f.size, 0),
      fileCount: version.files.length,
      approval
    };

    const manifestHash = computeObjectSha256(manifest);
    manifest.signature = manifestHash;

    const manifestPath = this.saveManifest(manifest);

    let updatedVersion: DatasetVersion = {
      ...version,
      status: 'published',
      updatedAt: now,
      approval,
      manifestHash,
      exportPath: manifestPath
    };

    if (previousPublished && state.versions[previousPublished]) {
      updatedVersion.previousVersion = previousPublished;
      
      const prevVersion = state.versions[previousPublished];
      state.versions[previousPublished] = {
        ...prevVersion,
        replacedBy: versionId,
        updatedAt: now
      };
      this.saveVersion(state.versions[previousPublished]);
    }

    let newState: CLIState = {
      ...state,
      versions: {
        ...state.versions,
        [versionId]: updatedVersion
      },
      currentVersion: versionId,
      previousVersion: previousPublished,
      approvalComments: {
        ...state.approvalComments,
        [versionId]: approvalComment
      }
    };

    newState = this.addStateTransition(
      newState,
      versionId,
      version.status,
      'published',
      approver,
      `Published with comment: ${approvalComment}`
    );

    this.saveVersion(updatedVersion);
    return { state: newState, manifest };
  }

  rollbackToVersion(
    state: CLIState,
    targetVersionId: string,
    actor: string,
    reason: string
  ): CLIState {
    const targetVersion = state.versions[targetVersionId];
    if (!targetVersion) {
      throw new Error(`Version not found: ${targetVersionId}`);
    }

    const currentPublished = state.currentVersion;
    const now = new Date().toISOString();

    if (currentPublished && state.versions[currentPublished]) {
      const currentVersion = state.versions[currentPublished];
      state.versions[currentPublished] = {
        ...currentVersion,
        status: 'rolled_back',
        updatedAt: now
      };
      this.saveVersion(state.versions[currentPublished]);
    }

    const updatedTarget: DatasetVersion = {
      ...targetVersion,
      status: 'published',
      updatedAt: now
    };

    let newState: CLIState = {
      ...state,
      versions: {
        ...state.versions,
        [targetVersionId]: updatedTarget
      },
      previousVersion: currentPublished,
      currentVersion: targetVersionId
    };

    if (currentPublished) {
      newState = this.addStateTransition(
        newState,
        currentPublished,
        'published',
        'rolled_back',
        actor,
        `Rolled back to ${targetVersion.version}: ${reason}`
      );
    }

    newState = this.addStateTransition(
      newState,
      targetVersionId,
      targetVersion.status,
      'published',
      actor,
      `Rolled back from ${currentPublished || 'none'}: ${reason}`
    );

    this.saveVersion(updatedTarget);
    return newState;
  }

  updateRuleConfig(state: CLIState, newRules: any[]): CLIState {
    const newVersion = `v${parseInt(state.ruleConfig.version.slice(1)) + 1}`;
    const now = new Date().toISOString();

    const newRuleConfig = {
      ...state.ruleConfig,
      version: newVersion,
      updatedAt: now,
      rules: newRules
    };

    return {
      ...state,
      ruleConfig: newRuleConfig
    };
  }

  getAllVersions(state: CLIState): DatasetVersion[] {
    return Object.values(state.versions).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getVersionsByStatus(state: CLIState, status: VersionStatus): DatasetVersion[] {
    return this.getAllVersions(state).filter(v => v.status === status);
  }

  getStateHistoryForVersion(state: CLIState, versionId: string): StateTransition[] {
    return state.stateHistory
      .filter(h => h.versionId === versionId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  verifyConsistency(state: CLIState): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (state.currentVersion) {
      const current = state.versions[state.currentVersion];
      if (!current) {
        issues.push(`Current version ${state.currentVersion} not found in versions`);
      } else if (current.status !== 'published') {
        issues.push(`Current version ${state.currentVersion} is not published (status: ${current.status})`);
      }
    }

    if (state.previousVersion) {
      const prev = state.versions[state.previousVersion];
      if (!prev) {
        issues.push(`Previous version ${state.previousVersion} not found in versions`);
      }
    }

    for (const [versionId, version] of Object.entries(state.versions)) {
      const onDisk = this.loadVersion(versionId);
      if (!onDisk) {
        issues.push(`Version ${versionId} in state but not on disk`);
      } else if (onDisk.updatedAt !== version.updatedAt) {
        issues.push(`Version ${versionId} state mismatch with disk`);
      }

      if (version.status === 'published' && !version.manifestHash) {
        issues.push(`Published version ${versionId} missing manifest hash`);
      }

      if (version.status === 'published' && !version.approval) {
        issues.push(`Published version ${versionId} missing approval info`);
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
