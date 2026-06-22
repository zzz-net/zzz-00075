import chalk from 'chalk';
import { DryRunResult, DryRunBlockStage, DryRunAction, PublishPlanComparison, FileDiff } from '../types';

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
  addedFileCount: number;
  deletedFileCount: number;
  modifiedFileCount: number;
  hasConflict: boolean;
  conflictType: string | null;
}

export function buildStableSummary(r: DryRunResult): DryRunStableSummary {
  const stage = r.blockedAt || 'none';
  const willReplace = r.currentPublishedWouldBeReplaced;
  const comp = r.comparison;

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
    if (comp?.conflict?.hasConflict) {
      suggested = comp.conflict.resolutionHints[0] || 'Resolve conflicts first';
    } else if (r.action === 'submit') {
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
    totalSize: r.totalSize,
    addedFileCount: comp?.addedFileCount || 0,
    deletedFileCount: comp?.deletedFileCount || 0,
    modifiedFileCount: comp?.modifiedFileCount || 0,
    hasConflict: comp?.conflict?.hasConflict || false,
    conflictType: comp?.conflict?.conflictType || null
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
  if (s.addedFileCount > 0 || s.deletedFileCount > 0 || s.modifiedFileCount > 0) {
    const diffLine = `+${s.addedFileCount} -${s.deletedFileCount} ~${s.modifiedFileCount}`;
    lines.push(`│ ${warn('Changes:')}         ${diffLine}${' '.repeat(Math.max(0, 33 - diffLine.length))} │`);
  }
  if (s.hasConflict) {
    const conflictTxt = `CONFLICT: ${s.conflictType || 'unknown'}`;
    lines.push(`│ ${err('Conflict:')}        ${conflictTxt}${' '.repeat(Math.max(0, 31 - conflictTxt.length))} │`);
  }
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

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.substring(0, len);
  return str + ' '.repeat(len - str.length);
}

export function formatPublishPlanComparison(comp: PublishPlanComparison): string {
  const lines: string[] = [];
  const bold = chalk.bold;
  const ok = chalk.green;
  const err = chalk.red;
  const warn = chalk.yellow;
  const info = chalk.cyan;
  const dim = chalk.gray;

  const pubLabel = comp.hasPublishedVersion ? comp.publishedVersionLabel! : '(none)';
  const draftLabel = comp.draftVersionLabel;
  const colW = 34;

  lines.push('');
  lines.push(bold('┌' + '─'.repeat(colW) + '┬' + '─'.repeat(colW) + '┐'));
  lines.push(bold('│' + padRight('  PUBLISHED VERSION', colW) + '│' + padRight('  DRAFT VERSION', colW) + '│'));
  lines.push(bold('├' + '─'.repeat(colW) + '┼' + '─'.repeat(colW) + '┤'));
  lines.push('│' + padRight(`  Label: ${pubLabel}`, colW) + '│' + padRight(`  Label: ${draftLabel}`, colW) + '│');
  lines.push('│' + padRight(`  Status: ${comp.publishedStatus || '-'}`, colW) + '│' + padRight(`  Status: ${comp.draftStatus}`, colW) + '│');
  if (comp.hasPublishedVersion) {
    lines.push('│' + padRight(`  ID: ${(comp.publishedVersionId || '').substring(0, 16)}...`, colW) + '│' + padRight(`  ID: ${comp.draftVersionId.substring(0, 16)}...`, colW) + '│');
  } else {
    lines.push('│' + padRight(`  ID: -`, colW) + '│' + padRight(`  ID: ${comp.draftVersionId.substring(0, 16)}...`, colW) + '│');
  }
  lines.push('│' + padRight(`  Rule: ${comp.hasPublishedVersion ? comp.ruleVersion : '-'}`, colW) + '│' + padRight(`  Rule: ${comp.ruleVersion}`, colW) + '│');
  lines.push(bold('└' + '─'.repeat(colW) + '┴' + '─'.repeat(colW) + '┘'));
  lines.push('');

  lines.push(bold('=== FILE DIFFS ==='));
  lines.push(`${info('Added:')}   ${comp.addedFileCount} file(s)`);
  lines.push(`${warn('Modified:')} ${comp.modifiedFileCount} file(s)`);
  lines.push(`${err('Deleted:')}  ${comp.deletedFileCount} file(s)`);
  lines.push(`${dim('Unchanged:')} ${comp.unchangedFileCount} file(s)`);
  const sizeSign = comp.totalSizeDelta >= 0 ? '+' : '';
  lines.push(`${info('Size delta:')} ${sizeSign}${comp.totalSizeDelta} bytes`);
  lines.push('');

  if (comp.fileDiffs.length > 0) {
    comp.fileDiffs.forEach(diff => {
      lines.push(formatFileDiffLine(diff));
    });
    lines.push('');
  }

  lines.push(bold('=== LICENSE COMPARISON ==='));
  const lc = comp.licenseComparison;
  if (lc.publishedLicenses.length > 0) {
    lines.push(`${dim('Published:')} ${lc.publishedLicenses.join(', ') || '(none)'}`);
  }
  lines.push(`${info('Draft:')}     ${lc.draftLicenses.join(', ') || '(none)'}`);
  if (lc.addedLicenses.length > 0) {
    lines.push(`${ok('+ Added:')}   ${lc.addedLicenses.join(', ')}`);
  }
  if (lc.removedLicenses.length > 0) {
    lines.push(`${err('- Removed:')} ${lc.removedLicenses.join(', ')}`);
  }
  if (lc.keptLicenses.length > 0) {
    lines.push(`${dim('= Kept:')}    ${lc.keptLicenses.join(', ')}`);
  }
  lines.push(`${dim('License file:')} published=${lc.licenseFilePresentInPublished ? 'yes' : 'no'}, draft=${lc.licenseFilePresentInDraft ? 'yes' : 'no'}`);
  if (!lc.allAllowed) {
    lines.push(`${err('VIOLATING:')} ${lc.violatingLicenses.join(', ')}`);
  } else {
    lines.push(`${ok('All licenses allowed.')}`);
  }
  lines.push('');

  lines.push(bold('=== VERSION & REPLACEMENT ==='));
  lines.push(`${info('Candidate version:')}    ${comp.candidateVersionLabel}`);
  lines.push(`${info('Next available:')}       ${comp.nextAvailableVersionLabel}`);
  if (comp.willReplaceCurrentPublished) {
    lines.push(`${warn('Will replace current:')} YES - ${comp.publishedVersionLabel} → archived`);
  } else if (comp.hasPublishedVersion) {
    lines.push(`${dim('Will replace current:')} NO (this is a submit, not publish)`);
  } else {
    lines.push(`${dim('Will replace current:')} FIRST PUBLICATION`);
  }
  lines.push('');

  if (comp.conflict.hasConflict) {
    lines.push(bold('=== CONFLICT DETECTED ==='));
    lines.push(`${err('Conflict type:')} ${comp.conflict.conflictType}`);
    lines.push('');
    comp.conflict.conflictReasons.forEach(r => lines.push(`  ${err('→')} ${r}`));
    lines.push('');
    if (comp.conflict.conflictingVersionIds.length > 0) {
      lines.push(`${dim('Conflicting version IDs:')} ${comp.conflict.conflictingVersionIds.join(', ')}`);
    }
    lines.push('');
    lines.push(`${bold('Resolution hints:')}`);
    comp.conflict.resolutionHints.forEach((h, i) => lines.push(`  ${i + 1}. ${h}`));
    lines.push('');
  }

  if (comp.blockingPoints.length > 0) {
    lines.push(bold('=== BLOCKING POINTS ==='));
    comp.blockingPoints.forEach(bp => {
      if (bp.startsWith('[LICENSE BLOCK]')) {
        lines.push(`  ${err(bp)}`);
      } else if (bp.startsWith('[CONFLICT]')) {
        lines.push(`  ${err(bp)}`);
      } else {
        lines.push(`  ${warn(bp)}`);
      }
    });
    lines.push('');
  }

  if (comp.suggestedNextSteps.length > 0) {
    lines.push(bold('=== SUGGESTED NEXT STEPS ==='));
    comp.suggestedNextSteps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    lines.push('');
  }

  lines.push(`${dim('Comparison generated at: ' + comp.comparisonGeneratedAt)}`);
  lines.push('');

  return lines.join('\n');
}

function formatFileDiffLine(diff: FileDiff): string {
  const ok = chalk.green;
  const err = chalk.red;
  const warn = chalk.yellow;
  const dim = chalk.gray;

  let prefix = '';
  let color: (s: string) => string = dim;

  switch (diff.diffType) {
    case 'added':
      prefix = '[+]';
      color = ok;
      break;
    case 'deleted':
      prefix = '[-]';
      color = err;
      break;
    case 'modified':
      prefix = '[~]';
      color = warn;
      break;
    case 'unchanged':
      prefix = '[=]';
      color = dim;
      break;
  }

  let sizeInfo = '';
  if (diff.diffType === 'added') {
    sizeInfo = `(+${diff.newSize} B)`;
  } else if (diff.diffType === 'deleted') {
    sizeInfo = `(-${diff.oldSize} B)`;
  } else if (diff.diffType === 'modified') {
    const sign = diff.sizeDelta >= 0 ? '+' : '';
    sizeInfo = `(${sign}${diff.sizeDelta} B)`;
  }

  let licInfo = '';
  if (diff.licenseChanged) {
    licInfo = `  license: ${diff.oldLicense || '(none)'} → ${diff.newLicense || '(none)'}`;
  } else if (diff.newLicense) {
    licInfo = `  [${diff.newLicense}]`;
  }

  return color(`  ${prefix} ${diff.path} ${sizeInfo}${licInfo}`);
}

export function printBlockReasons(r: DryRunResult): void {
  const err = chalk.red;
  const warn = chalk.yellow;
  const dim = chalk.gray;

  if (r.comparison?.conflict?.hasConflict) {
    console.error(err('CONFLICT DETECTED - Cannot proceed until resolved:'));
    r.comparison.conflict.conflictReasons.forEach(re => console.error(err(`  -> ${re}`)));
    console.log('');
    console.log(dim('Resolution hints:'));
    r.comparison.conflict.resolutionHints.forEach((h, i) => console.log(dim(`  ${i + 1}. ${h}`)));
    console.log('');
    console.log(dim(`Tip: Use \`dataset-cli status conflict\` for a detailed explanation.`));
    return;
  }

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
  if (r.comparison?.conflict?.hasConflict) {
    return `Dry-run blocked by conflict: ${r.comparison.conflict.conflictType} (action=${r.action})`;
  }
  return `Dry-run blocked at: ${stageLabels[r.blockedAt || 'none'] || r.blockedAt} (action=${r.action})`;
}
