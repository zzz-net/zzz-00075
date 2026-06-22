import chalk from 'chalk';
import { DryRunResult, DryRunBlockStage, DryRunAction } from '../types';

const stageLabels: Record<string, string> = {
  'none': 'Not blocked',
  'status_check': 'Status Check',
  'hard_block': 'License Hard Block',
  'verification': 'Verification'
};

export interface DryRunStableSummary {
  targetVersionLabel: string;
  targetVersionId: string;
  targetVersionStatus: string;
  blockStage: string;
  blockStageLabel: string;
  willReplaceCurrentPublished: boolean;
  currentPublishedVersionLabel: string | null;
  currentPublishedVersionId: string | null;
  suggestedNextCommand: string;
  ruleVersion: string;
  fileCount: number;
  totalSize: number;
}

export function buildStableSummary(r: DryRunResult): DryRunStableSummary {
  const stage = r.blockedAt || 'none';
  const willReplace = r.currentPublishedWouldBeReplaced;

  let suggested = '';
  if (stage === 'none') {
    if (r.action === 'submit' && r.canSubmit) {
      suggested = 'dataset-cli submit';
      if (r.skipVerifyUsed) suggested += ' --skip-verify';
    } else if (r.action === 'publish' && r.canPublish) {
      suggested = 'dataset-cli publish --approver <name>';
      if (r.forceUsed) suggested += ' --force';
      if (r.skipVerifyUsed) suggested += ' --skip-verify';
    }
  } else if (stage === 'status_check') {
    if (r.action === 'submit') {
      suggested = 'dataset-cli scan <directory>';
    } else {
      suggested = 'dataset-cli submit';
    }
  } else if (stage === 'hard_block') {
    suggested = 'dataset-cli config set-license --allow <licenses>';
  } else if (stage === 'verification') {
    if (r.action === 'submit') {
      suggested = 'dataset-cli submit --skip-verify';
    } else {
      suggested = 'dataset-cli publish --force --approver <name>';
    }
  }

  return {
    targetVersionLabel: r.versionLabel,
    targetVersionId: r.versionId,
    targetVersionStatus: r.currentStatus,
    blockStage: stage,
    blockStageLabel: stageLabels[stage] || stage,
    willReplaceCurrentPublished: willReplace,
    currentPublishedVersionLabel: r.currentPublishedVersionLabel,
    currentPublishedVersionId: r.currentPublishedVersionId,
    suggestedNextCommand: suggested,
    ruleVersion: r.ruleVersion,
    fileCount: r.fileCount,
    totalSize: r.totalSize
  };
}

export function formatSummaryBox(r: DryRunResult): string {
  const s = buildStableSummary(r);
  const lines: string[] = [];
  const bold = chalk.bold;
  const ok = chalk.green;
  const err = chalk.red;
  const warn = chalk.yellow;
  const info = chalk.cyan;
  const dim = chalk.gray;

  lines.push('');
  lines.push(bold('┌──────────────────────────────────────────────────┐'));
  lines.push(bold('│              DRY-RUN EXECUTION SUMMARY           │'));
  lines.push(bold('├──────────────────────────────────────────────────┤'));
  lines.push(`│ ${info('Target version:')}    ${s.targetVersionLabel}${' '.repeat(Math.max(0, 28 - s.targetVersionLabel.length))} │`);
  lines.push(`│ ${info('Version ID:')}      ${s.targetVersionId.substring(0, 24)}...${' '.repeat(Math.max(0, 22))} │`);
  lines.push(`│ ${info('Current status:')}  ${s.targetVersionStatus}${' '.repeat(Math.max(0, 30 - s.targetVersionStatus.length))} │`);
  lines.push(`│ ${info('Rule version:')}    ${s.ruleVersion}${' '.repeat(Math.max(0, 30 - s.ruleVersion.length))} │`);
  lines.push(`│ ${info('Files / Size:')}    ${s.fileCount} files, ${s.totalSize} B${' '.repeat(Math.max(0, 22 - String(s.fileCount).length - String(s.totalSize).length))} │`);
  lines.push(bold('├──────────────────────────────────────────────────┤'));

  if (s.blockStage === 'none') {
    lines.push(`│ ${ok('Block stage:')}       ${s.blockStageLabel}${' '.repeat(Math.max(0, 32 - s.blockStageLabel.length))} │`);
  } else {
    lines.push(`│ ${err('Block stage:')}       ${s.blockStageLabel}${' '.repeat(Math.max(0, 32 - s.blockStageLabel.length))} │`);
  }

  if (s.currentPublishedVersionId) {
    const cur = s.currentPublishedVersionLabel || 'v?';
    if (s.willReplaceCurrentPublished) {
      lines.push(`│ ${warn('Replace current:')}  YES - ${cur} will be archived${' '.repeat(Math.max(0, 14 - cur.length))} │`);
    } else {
      lines.push(`│ ${dim('Replace current:')}  NO - ${cur} remains active${' '.repeat(Math.max(0, 17 - cur.length))} │`);
    }
  } else {
    lines.push(`│ ${dim('Replace current:')}  FIRST PUBLICATION${' '.repeat(20)} │`);
  }

  lines.push(bold('├──────────────────────────────────────────────────┤'));
  const cmdPad = Math.max(0, 46 - s.suggestedNextCommand.length);
  if (s.blockStage === 'none') {
    lines.push(`│ ${ok('Suggested next:')}${' '.repeat(2)}${s.suggestedNextCommand}${' '.repeat(cmdPad)} │`);
  } else {
    lines.push(`│ ${warn('Suggested next:')}${' '.repeat(2)}${s.suggestedNextCommand}${' '.repeat(cmdPad)} │`);
  }
  lines.push(bold('└──────────────────────────────────────────────────┘'));
  lines.push('');

  return lines.join('\n');
}

export function printBlockReasons(r: DryRunResult): void {
  const err = chalk.red;
  const warn = chalk.yellow;
  const dim = chalk.gray;

  if (r.blockedAt === 'hard_block') {
    console.error(err('HARD BLOCK: License rules violated - CANNOT be bypassed, even with --skip-verify or --force'));
    r.hardBlock.reasons.forEach(re => console.error(err(`  -> ${re}`)));
    console.log('');
    console.log(dim('Fix license issues before proceeding:'));
    console.log(dim('  1. Add the detected license to the allowed list via `config set-license --allow`'));
    console.log(dim('  2. Or replace/remove the non-compliant files'));
    console.log(dim('  3. Then re-scan and try again'));
  } else if (r.blockedAt === 'verification') {
    console.error(err('Verification failed. Cannot proceed.'));
    console.log('');
    r.verifyResult.errors.forEach(errMsg => {
      console.log(`  ${err('->')} ${errMsg}`);
    });
    console.log('');
    if (r.action === 'submit') {
      console.log(dim('Options:'));
      console.log(dim('  1. Fix the hash/size verification errors and re-verify'));
      console.log(dim(`  2. Use ${warn('dataset-cli submit --skip-verify')} to bypass hash/size (license rules still enforced)`));
    } else {
      if (r.forceUsed) {
        console.log(dim('Even --force cannot override these errors (they are hard blocks).'));
      } else {
        console.log(dim('Options:'));
        console.log(dim('  1. Fix the verification errors'));
        console.log(dim(`  2. Use ${warn('dataset-cli publish --force')} to override hash/size (license rules still enforced)`));
      }
    }
  } else if (r.blockedAt === 'status_check') {
    console.error(err(`Cannot ${r.action} version with status: ${r.currentStatus}`));
    if (r.action === 'submit') {
      console.log(dim('Only "draft" versions can be submitted. Create a new version via `dataset-cli scan` first.'));
    } else {
      console.log(dim('Only "pending_approval" versions can be published. Submit it first via `dataset-cli submit`.'));
    }
  }
}

export function formatBlockedAtExitMessage(r: DryRunResult): string {
  return `Dry-run blocked at: ${stageLabels[r.blockedAt || 'none'] || r.blockedAt} (action=${r.action})`;
}
