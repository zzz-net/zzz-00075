import { CLIState, DatasetVersion, DryRunResult, DryRunAction, DryRunBlockStage, ValidationRule } from '../types';
import { Validator } from './Validator';

export class DryRunEngine {
  evaluate(
    action: DryRunAction,
    state: CLIState,
    targetVersion: DatasetVersion,
    options: { skipVerify?: boolean; force?: boolean } = {}
  ): DryRunResult {
    const validator = new Validator(state.ruleConfig);
    const skipVerify = !!options.skipVerify;
    const force = !!options.force;
    const now = new Date().toISOString();

    const currentPubId = state.currentVersion;
    const currentPub = currentPubId ? state.versions[currentPubId] : null;

    const candidateVersion = targetVersion.version;
    const nextAvailableVersion = `v${Object.keys(state.versions).length + 1}.0.0`;

    const blockReasons: string[] = [];
    let blockedAt: DryRunBlockStage = 'none';

    if (action === 'submit' && targetVersion.status !== 'draft') {
      blockedAt = 'status_check';
      blockReasons.push(
        `Cannot submit version with status "${targetVersion.status}". Only "draft" versions can be submitted for approval.`
      );
    }

    if (action === 'publish' && targetVersion.status !== 'pending_approval') {
      blockedAt = 'status_check';
      blockReasons.push(
        `Cannot publish version with status "${targetVersion.status}". Only "pending_approval" versions can be published.`
      );
    }

    const verifyResult = validator.verify(
      targetVersion.scanDir,
      targetVersion.files,
      !skipVerify
    );

    const hardBlock = validator.hasHardBlockErrors(verifyResult);
    const canPublishStrict = validator.canPublish(verifyResult);

    if (blockedAt === 'none' && hardBlock.blocked) {
      blockedAt = 'hard_block';
      hardBlock.reasons.forEach(r => blockReasons.push(r));
    }

    let canSubmit = false;
    let canPublish = false;

    if (action === 'submit') {
      if (blockedAt === 'none') {
        if (!skipVerify && !verifyResult.passed) {
          blockedAt = 'verification';
          verifyResult.errors.forEach(e => blockReasons.push(e));
        } else if (skipVerify && hardBlock.blocked) {
          blockedAt = 'hard_block';
        } else {
          canSubmit = true;
        }
      }
    }

    if (action === 'publish') {
      if (blockedAt === 'none') {
        if (!skipVerify && hardBlock.blocked) {
          blockedAt = 'hard_block';
        } else if (!skipVerify && !verifyResult.passed) {
          if (force && !hardBlock.blocked) {
            canPublish = true;
          } else {
            blockedAt = 'verification';
            verifyResult.errors.forEach(e => blockReasons.push(e));
          }
        } else if (skipVerify && hardBlock.blocked) {
          blockedAt = 'hard_block';
        } else {
          canPublish = true;
        }
      }
    }

    const nextSteps = this.buildNextSteps(action, blockedAt, canSubmit, canPublish, hardBlock, verifyResult, force, skipVerify);

    const rulesSnapshot: ValidationRule[] = state.ruleConfig.rules.map(r => ({ ...r, config: { ...r.config } }));

    return {
      action,
      timestamp: now,
      versionId: targetVersion.id,
      versionLabel: targetVersion.version,
      candidateVersion,
      nextAvailableVersion,
      currentStatus: targetVersion.status,
      ruleVersion: state.ruleConfig.version,
      rulesSnapshot,
      files: targetVersion.files,
      fileCount: targetVersion.files.length,
      totalSize: targetVersion.files.reduce((s, f) => s + f.size, 0),
      currentPublishedVersionId: currentPubId,
      currentPublishedVersionLabel: currentPub ? currentPub.version : null,
      currentPublishedWouldBeReplaced: action === 'publish' && canPublish && !!currentPubId,
      previousVersionId: currentPubId,
      verifyResult,
      hardBlock,
      canSubmit,
      canPublish,
      blockedAt,
      blockReasons,
      nextSteps,
      skipVerifyUsed: skipVerify,
      forceUsed: force
    };
  }

  private buildNextSteps(
    action: DryRunAction,
    blockedAt: DryRunBlockStage,
    canSubmit: boolean,
    canPublish: boolean,
    hardBlock: { blocked: boolean; reasons: string[] },
    verifyResult: { passed: boolean; errors: string[] },
    force: boolean,
    skipVerify: boolean
  ): string[] {
    const steps: string[] = [];

    if (blockedAt === 'status_check') {
      if (action === 'submit') {
        steps.push('This version is not in "draft" status. Create a new version via `dataset-cli scan` first.');
      } else {
        steps.push('This version is not in "pending_approval" status. Submit it first via `dataset-cli submit`.');
      }
      return steps;
    }

    if (blockedAt === 'hard_block') {
      steps.push('License HARD BLOCK cannot be bypassed by any flag (--skip-verify, --force).');
      steps.push('Fix the license issues: either add the detected license to the allowed list, or replace/remove the non-compliant files.');
      steps.push('After fixing, re-run `dataset-cli config set-license --allow <license>` or update the data, then re-scan.');
      return steps;
    }

    if (blockedAt === 'verification') {
      if (action === 'submit') {
        steps.push('Fix the verification errors listed above (hash/size mismatches).');
        steps.push('Or use `dataset-cli submit --skip-verify` to bypass hash/size checks (license rules are always enforced).');
      } else {
        steps.push('Fix the verification errors listed above (hash/size mismatches).');
        if (!force) {
          steps.push('Or use `dataset-cli publish --force` to override hash/size issues (license rules are always enforced).');
        }
      }
      return steps;
    }

    if (action === 'submit' && canSubmit) {
      steps.push('This version can be submitted. Run `dataset-cli submit` to proceed.');
      if (skipVerify) {
        steps.push('Note: --skip-verify was used, so hash/size checks were skipped. Full verification will run at publish time.');
      }
    }

    if (action === 'publish' && canPublish) {
      steps.push('This version can be published. Run `dataset-cli publish --approver <name>` to proceed.');
      if (force) {
        steps.push('Note: --force was used. Hash/size issues will be overridden, but the published manifest may contain invalid file references.');
      }
      steps.push('After publishing, run `dataset-cli export` to export the manifest.');
    }

    return steps;
  }
}
