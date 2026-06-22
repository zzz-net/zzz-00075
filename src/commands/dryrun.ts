import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { FileStorage } from '../storage/FileStorage';
import { DryRunEngine } from '../services/DryRunEngine';
import { DryRunResult } from '../types';
import { formatSummaryBox, printBlockReasons } from '../services/DryRunSummary';

function formatDryRunReport(r: DryRunResult): string {
  const lines: string[] = [];
  const ok = chalk.green;
  const err = chalk.red;
  const warn = chalk.yellow;
  const info = chalk.cyan;
  const dim = chalk.gray;
  const bold = chalk.bold;

  lines.push(formatSummaryBox(r));

  lines.push(bold('========================================'));
  lines.push(bold(`  DETAILED DRY RUN: ${r.action.toUpperCase()}`));
  lines.push(bold('========================================'));
  lines.push('');

  lines.push(bold('Target Version Details'));
  lines.push(`  ${info('Version:')}        ${r.versionLabel}`);
  lines.push(`  ${info('Version ID:')}    ${r.versionId}`);
  lines.push(`  ${info('Would become:')}  ${r.candidateVersion} ${dim('(same version label, status will change)')}`);
  lines.push(`  ${info('Next scan would get:')} ${r.nextAvailableVersion}`);
  lines.push(`  ${info('Current status:')} ${r.currentStatus}`);
  lines.push(`  ${info('Timestamp:')}     ${r.timestamp}`);
  lines.push('');

  lines.push(bold('Applied Rules (Snapshot)'));
  lines.push(`  ${info('Rule version:')}  ${r.ruleVersion}`);
  r.rulesSnapshot.forEach(rule => {
    const st = rule.enabled ? ok('ON') : err('OFF');
    lines.push(`  ${st} ${rule.type} (${rule.id})`);
    if (rule.config.allowedLicenses) {
      lines.push(`     Allowed: ${rule.config.allowedLicenses.join(', ')}`);
    }
    if (rule.config.requiredLicenseFile !== undefined) {
      lines.push(`     Require license file: ${rule.config.requiredLicenseFile}`);
    }
    if (rule.config.minSize !== undefined) {
      lines.push(`     Min size: ${rule.config.minSize}`);
    }
    if (rule.config.maxSize !== undefined) {
      lines.push(`     Max size: ${rule.config.maxSize}`);
    }
    if (rule.config.hashAlgorithm) {
      lines.push(`     Algorithm: ${rule.config.hashAlgorithm}`);
    }
  });
  lines.push('');

  lines.push(bold('Files in This Version'));
  lines.push(`  ${info('File count:')}    ${r.fileCount}`);
  lines.push(`  ${info('Total size:')}   ${r.totalSize} bytes`);
  r.files.forEach(f => {
    const lic = f.license ? dim(` [${f.license}]`) : '';
    lines.push(`    ${f.path} (${f.size}B)${lic}`);
  });
  lines.push('');

  lines.push(bold('Published Version Impact'));
  if (r.currentPublishedVersionId) {
    lines.push(`  ${info('Current version:')}  ${r.currentPublishedVersionLabel} (${r.currentPublishedVersionId})`);
    if (r.currentPublishedWouldBeReplaced) {
      lines.push(`  ${warn('Will be replaced:')} YES - this version will become the "previous" version`);
    } else {
      lines.push(`  ${ok('Will be replaced:')} NO`);
    }
  } else {
    lines.push(`  ${dim('No current published version - this would be the first publication')}`);
  }
  lines.push('');

  lines.push(bold('Verification Results'));
  if (r.skipVerifyUsed) {
    lines.push(`  ${warn('--skip-verify used:')} hash/size checks skipped, license HARD BLOCK still enforced`);
  }
  if (r.forceUsed) {
    lines.push(`  ${warn('--force used:')} hash/size failures would be overridden, license HARD BLOCK still enforced`);
  }

  const vr = r.verifyResult;
  if (vr.passed) {
    lines.push(`  ${ok('Overall:')} PASSED`);
  } else {
    lines.push(`  ${err('Overall:')} FAILED`);
  }
  lines.push(`  ${info('Errors:')}   ${vr.errors.length}`);
  if (vr.errors.length > 0) {
    vr.errors.forEach((e, i) => lines.push(`    ${err(`${i + 1}.`)} ${e}`));
  }

  vr.fileResults.forEach(fr => {
    const h = fr.hashOk ? ok('H') : err('H');
    const s = fr.sizeOk ? ok('S') : err('S');
    const l = fr.licenseOk ? ok('L') : err('L');
    lines.push(`    [${h}${s}${l}] ${fr.filePath}`);
    fr.errors.forEach(e => lines.push(`         ${err('->')} ${e}`));
  });
  lines.push('');

  lines.push(bold('Hard Block Check (License)'));
  if (r.hardBlock.blocked) {
    lines.push(`  ${err('BLOCKED')}`);
    r.hardBlock.reasons.forEach(re => lines.push(`    ${err('->')} ${re}`));
  } else {
    lines.push(`  ${ok('PASSED')} - No license hard blocks`);
  }
  lines.push('');

  lines.push(bold('Verdict'));
  if (r.blockedAt === 'none') {
    if (r.action === 'submit') {
      lines.push(`  ${ok('CAN SUBMIT')} - This version would be moved to pending_approval`);
    } else {
      lines.push(`  ${ok('CAN PUBLISH')} - This version would become the current published version`);
    }
  } else {
    const stageLabels: Record<string, string> = {
      'status_check': 'Status Check',
      'hard_block': 'License Hard Block',
      'verification': 'Verification'
    };
    lines.push(`  ${err('BLOCKED')} at stage: ${stageLabels[r.blockedAt || 'unknown'] || r.blockedAt}`);
    r.blockReasons.forEach(br => lines.push(`    ${err('->')} ${br}`));
  }
  lines.push('');

  lines.push(bold('Next Steps'));
  r.nextSteps.forEach((ns, i) => lines.push(`  ${i + 1}. ${ns}`));
  lines.push('');

  lines.push(bold('Stable Summary (for reference)'));
  lines.push(`  ${info('Target:')}    ${r.summary.targetVersionLabel} (${r.summary.targetVersionId.substring(0, 16)}...)`);
  lines.push(`  ${info('Blocked at:')} ${r.summary.blockStageLabel}`);
  lines.push(`  ${info('Replace:')}   ${r.summary.willReplaceCurrentPublished ? 'YES' : 'NO'}`);
  if (r.summary.currentPublishedVersionLabel) {
    lines.push(`  ${info('Current:')}   ${r.summary.currentPublishedVersionLabel} (${r.summary.currentPublishedVersionId?.substring(0, 16)}...)`);
  }
  lines.push(`  ${info('Next cmd:')}  ${r.summary.suggestedNextCommand || '(none)'}`);
  lines.push('');

  return lines.join('\n');
}

export function registerDryRunCommand(program: Command, storage: FileStorage): void {
  const dryRun = program
    .command('dry-run')
    .description('Pre-flight check: preview what submit/publish would do WITHOUT changing any state. Run BEFORE submit or publish.');

  dryRun
    .command('submit [versionId]')
    .description('Preview a submit operation. Shows if the version can be moved to pending_approval')
    .option('--by <user>', 'User submitting the version (for reference only, no state change)', 'system')
    .option('--skip-verify', 'Skip hash/size verification (license HARD BLOCK still enforced)')
    .option('--json <path>', 'Export dry-run result as JSON for audit/review by others')
    .action(async (versionId: string | undefined, options: any) => {
      try {
        const state = storage.loadState();

        let targetVersion;
        if (versionId) {
          targetVersion = state.versions[versionId];
          if (!targetVersion) {
            console.error(chalk.red(`Version not found: ${versionId}`));
            process.exit(1);
          }
        } else {
          const drafts = storage.getVersionsByStatus(state, 'draft');
          if (drafts.length === 0) {
            console.error(chalk.red('No draft versions found. Run `dataset-cli scan <directory>` first.'));
            console.log(chalk.gray('Tip: Use `dataset-cli status all` to list all versions.'));
            process.exit(1);
          }
          targetVersion = drafts[0];
          console.log(chalk.gray(`Using latest draft: ${targetVersion.version} (${targetVersion.id})`));
        }

        const engine = new DryRunEngine();
        const result = engine.evaluate('submit', state, targetVersion, {
          skipVerify: !!options.skipVerify
        });

        if (options.json) {
          const jsonPath = path.resolve(options.json);
          fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
          console.log(chalk.green(`Dry-run result exported to: ${jsonPath}`));
          console.log(chalk.gray('The exported JSON contains the stable summary field that is consistent across restarts.'));
        } else {
          console.log(formatDryRunReport(result));
        }

        if (result.blockedAt !== 'none') {
          console.log(chalk.yellow('---'));
          printBlockReasons(result);
          process.exit(1);
        }

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });

  dryRun
    .command('publish [versionId]')
    .description('Preview a publish operation. Shows if the version can become the current published version')
    .requiredOption('--approver <name>', 'Approver name (for reference only, no state change)')
    .option('--comment <text>', 'Approval comment (for reference only)', 'Approved for publication')
    .option('--skip-verify', 'Skip hash/size verification (license HARD BLOCK still enforced)')
    .option('--force', 'Force publish overriding hash/size (license HARD BLOCK still enforced)')
    .option('--json <path>', 'Export dry-run result as JSON for audit/review by others')
    .action(async (versionId: string | undefined, options: any) => {
      try {
        const state = storage.loadState();

        let targetVersion;
        if (versionId) {
          targetVersion = state.versions[versionId];
          if (!targetVersion) {
            console.error(chalk.red(`Version not found: ${versionId}`));
            process.exit(1);
          }
        } else {
          const pending = storage.getVersionsByStatus(state, 'pending_approval');
          if (pending.length === 0) {
            console.error(chalk.red('No pending versions found. Run `dataset-cli submit` first.'));
            console.log(chalk.gray('Tip: Use `dataset-cli status all` to list all versions.'));
            process.exit(1);
          }
          targetVersion = pending[0];
          console.log(chalk.gray(`Using latest pending: ${targetVersion.version} (${targetVersion.id})`));
        }

        const engine = new DryRunEngine();
        const result = engine.evaluate('publish', state, targetVersion, {
          skipVerify: !!options.skipVerify,
          force: !!options.force
        });

        if (options.json) {
          const jsonPath = path.resolve(options.json);
          fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
          console.log(chalk.green(`Dry-run result exported to: ${jsonPath}`));
          console.log(chalk.gray('The exported JSON contains the stable summary field that is consistent across restarts.'));
        } else {
          console.log(formatDryRunReport(result));
        }

        if (result.blockedAt !== 'none') {
          console.log(chalk.yellow('---'));
          printBlockReasons(result);
          process.exit(1);
        }

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
