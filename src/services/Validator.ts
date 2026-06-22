import * as fs from 'fs';
import * as path from 'path';
import { FileEntry, RuleConfig, VerifyResult } from '../types';
import { computeFileSha256 } from '../utils/hash';
import { verifyFilesExist } from '../utils/fileScanner';

export class Validator {
  private ruleConfig: RuleConfig;

  constructor(ruleConfig: RuleConfig) {
    this.ruleConfig = ruleConfig;
  }

  updateRuleConfig(ruleConfig: RuleConfig): void {
    this.ruleConfig = ruleConfig;
  }

  verify(
    scanDir: string,
    files: FileEntry[],
    checkFileIntegrity: boolean = true
  ): VerifyResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const fileResults: VerifyResult['fileResults'] = [];

    const existenceCheck = verifyFilesExist(scanDir, files);
    if (!existenceCheck.valid) {
      errors.push(`Missing files detected: ${existenceCheck.missingFiles.join(', ')}`);
      for (const missingFile of existenceCheck.missingFiles) {
        fileResults.push({
          filePath: missingFile,
          hashOk: false,
          sizeOk: false,
          licenseOk: false,
          errors: ['File not found']
        });
      }
    }

    const hashRule = this.ruleConfig.rules.find(r => r.type === 'hash' && r.enabled);
    const sizeRule = this.ruleConfig.rules.find(r => r.type === 'size' && r.enabled);
    const licenseRule = this.ruleConfig.rules.find(r => r.type === 'license' && r.enabled);

    if (licenseRule?.config.requiredLicenseFile) {
      const hasLicenseFile = files.some(f => 
        f.path.toLowerCase().includes('license') || 
        f.path.toLowerCase().includes('licence')
      );
      if (!hasLicenseFile) {
        errors.push('License file is required but not found');
      }
    }

    const absoluteDir = path.resolve(scanDir);

    for (const file of files) {
      if (existenceCheck.missingFiles.includes(file.path)) {
        continue;
      }

      const fullPath = path.join(absoluteDir, file.path);
      const fileErrors: string[] = [];
      let hashOk = true;
      let sizeOk = true;
      let licenseOk = true;

      if (sizeRule) {
        const stats = fs.statSync(fullPath);
        if (sizeRule.config.minSize !== undefined && stats.size < sizeRule.config.minSize) {
          sizeOk = false;
          fileErrors.push(`File size (${stats.size}) below minimum (${sizeRule.config.minSize})`);
        }
        if (sizeRule.config.maxSize !== undefined && stats.size > sizeRule.config.maxSize) {
          sizeOk = false;
          fileErrors.push(`File size (${stats.size}) exceeds maximum (${sizeRule.config.maxSize})`);
        }
      }

      if (hashRule && checkFileIntegrity) {
        try {
          const currentHash = computeFileSha256(fullPath);
          if (currentHash !== file.sha256) {
            hashOk = false;
            fileErrors.push(`Hash mismatch: expected ${file.sha256}, got ${currentHash}`);
          }
        } catch (e) {
          hashOk = false;
          fileErrors.push(`Failed to compute hash: ${e}`);
        }
      }

      if (licenseRule && licenseRule.config.allowedLicenses && file.license) {
        if (!licenseRule.config.allowedLicenses.includes(file.license)) {
          licenseOk = false;
          fileErrors.push(`License "${file.license}" is not in allowed list: ${licenseRule.config.allowedLicenses.join(', ')}`);
        }
      }

      if (!hashOk) errors.push(`Hash check failed for ${file.path}`);
      if (!sizeOk) errors.push(`Size check failed for ${file.path}`);
      if (!licenseOk) errors.push(`License check failed for ${file.path}`);

      fileResults.push({
        filePath: file.path,
        hashOk,
        sizeOk,
        licenseOk,
        errors: fileErrors
      });
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      fileResults
    };
  }

  hasHardBlockErrors(verifyResult: VerifyResult): { blocked: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const licenseRule = this.ruleConfig.rules.find(r => r.type === 'license' && r.enabled);
    if (licenseRule) {
      const licenseErrors = verifyResult.fileResults.filter(r => !r.licenseOk);
      if (licenseErrors.length > 0) {
        licenseErrors.forEach(r => {
          reasons.push(`[HARD BLOCK] License check failed for ${r.filePath}: ${r.errors.join('; ')}`);
        });
      }
      if (licenseRule.config.requiredLicenseFile) {
        const hasLicenseFile = verifyResult.fileResults.some(r => 
          r.filePath.toLowerCase().includes('license') || 
          r.filePath.toLowerCase().includes('licence')
        );
        const noLicenseErr = verifyResult.errors.find(e => e.includes('License file is required'));
        if (!hasLicenseFile || noLicenseErr) {
          reasons.push('[HARD BLOCK] Required license file is missing');
        }
      }
    }
    return { blocked: reasons.length > 0, reasons };
  }

  canPublish(verifyResult: VerifyResult): boolean {
    const hardBlock = this.hasHardBlockErrors(verifyResult);
    if (hardBlock.blocked) return false;

    const hashRule = this.ruleConfig.rules.find(r => r.type === 'hash' && r.enabled);
    if (hashRule) {
      const hashErrors = verifyResult.fileResults.filter(r => !r.hashOk);
      if (hashErrors.length > 0) return false;
    }

    const sizeRule = this.ruleConfig.rules.find(r => r.type === 'size' && r.enabled);
    if (sizeRule) {
      const sizeErrors = verifyResult.fileResults.filter(r => !r.sizeOk);
      if (sizeErrors.length > 0) return false;
    }

    return verifyResult.passed;
  }
}
