import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { VersionStatus, DryRunAction } from '../types';
import { PublishPlanComparator } from '../services/PublishPlanComparator';
import { formatPublishPlanComparison } from '../services/DryRunSummary';

const statusColors: Record<VersionStatus, (str: string) => string> = {
  draft: chalk.gray,
  pending_approval: chalk.yellow,
  published: chalk.green,
  rejected: chalk.red,
  rolled_back: chalk.magenta
};

const statusLabels: Record<VersionStatus, string> = {
  draft: 'DRAFT',
  pending_approval: 'PENDING',
  published: 'PUBLISHED',
  rejected: 'REJECTED',
  rolled_back: 'ROLLED_BACK'
};

function formatStatus(status: VersionStatus): string {
  const color = statusColors[status] || chalk.white;
  const label = statusLabels[status] || status.toUpperCase();
  return color(label);
}

export function registerStatusCommand(program: Command, storage: FileStorage): void {
  const status = program
    .command('status')
    .description('Show version status overview');

  status
    .command('all')
    .description('Show all versions with their status')
    .option('--filter <status>', 'Filter by status (draft, pending_approval, published, rolled_back)')
    .action(async (options: any) => {
      const state = storage.loadState();
      const allVersions = storage.getAllVersions(state);

      if (allVersions.length === 0) {
        console.log(chalk.yellow('No versions found.'));
        console.log(chalk.gray('Run `dataset-cli scan <directory>` to create your first version'));
        return;
      }

      let versions = allVersions;
      if (options.filter) {
        versions = versions.filter(v => v.status === options.filter);
        if (versions.length === 0) {
          console.log(chalk.yellow(`No versions found with status: ${options.filter}`));
          return;
        }
      }

      console.log(chalk.blue('Dataset Versions'));
      console.log(chalk.gray(`Total: ${versions.length} version(s)`));
      console.log('');

      versions.forEach((v, index) => {
        const isCurrent = v.id === state.currentVersion;
        const isPrevious = v.id === state.previousVersion;
        
        const prefix = isCurrent ? chalk.green('★ ') : isPrevious ? chalk.magenta('◀ ') : '  ';
        
        console.log(`${prefix}${chalk.bold(v.version)} ${formatStatus(v.status)}`);
        console.log(`    ${chalk.cyan('ID:')} ${v.id}`);
        console.log(`    ${chalk.cyan('Created:')} ${v.createdAt}`);
        console.log(`    ${chalk.cyan('Files:')} ${v.files.length}`);
        console.log(`    ${chalk.cyan('Scan dir:')} ${v.scanDir}`);
        console.log(`    ${chalk.cyan('Rule version:')} ${v.ruleVersion}`);
        
        if (v.approval) {
          console.log(`    ${chalk.cyan('Approver:')} ${v.approval.approver}`);
          console.log(`    ${chalk.cyan('Approval:')} ${v.approval.comment}`);
        }
        
        if (v.manifestHash) {
          console.log(`    ${chalk.cyan('Manifest:')} ${v.manifestHash.substring(0, 16)}...`);
        }
        
        if (v.previousVersion) {
          const prev = state.versions[v.previousVersion];
          console.log(`    ${chalk.cyan('Replaces:')} ${prev ? prev.version : v.previousVersion}`);
        }
        
        if (v.replacedBy) {
          const next = state.versions[v.replacedBy];
          console.log(`    ${chalk.cyan('Replaced by:')} ${next ? next.version : v.replacedBy}`);
        }
        
        if (isCurrent) {
          console.log(`    ${chalk.green('→ CURRENT PUBLISHED VERSION')}`);
        }
        if (isPrevious) {
          console.log(`    ${chalk.magenta('→ PREVIOUS PUBLISHED VERSION')}`);
        }
        
        if (index < versions.length - 1) {
          console.log('');
        }
      });
    });

  status
    .command('current')
    .description('Show current published version details')
    .action(async () => {
      const state = storage.loadState();
      
      console.log(chalk.blue('Current Status'));
      console.log('');

      if (state.currentVersion) {
        const current = state.versions[state.currentVersion];
        console.log(`${chalk.green('★ CURRENT PUBLISHED VERSION')}`);
        console.log(`  ${chalk.cyan('Version:')} ${current.version}`);
        console.log(`  ${chalk.cyan('ID:')} ${current.id}`);
        console.log(`  ${chalk.cyan('Created:')} ${current.createdAt}`);
        console.log(`  ${chalk.cyan('Updated:')} ${current.updatedAt}`);
        console.log(`  ${chalk.cyan('Files:')} ${current.files.length}`);
        console.log(`  ${chalk.cyan('Scan dir:')} ${current.scanDir}`);
        console.log(`  ${chalk.cyan('Rule version:')} ${current.ruleVersion}`);
        if (current.approval) {
          console.log(`  ${chalk.cyan('Approver:')} ${current.approval.approver}`);
          console.log(`  ${chalk.cyan('Approval comment:')} ${current.approval.comment}`);
          console.log(`  ${chalk.cyan('Approved at:')} ${current.approval.approvedAt}`);
        }
        if (current.manifestHash) {
          console.log(`  ${chalk.cyan('Manifest hash:')} ${current.manifestHash}`);
        }
        if (current.exportPath) {
          console.log(`  ${chalk.cyan('Manifest path:')} ${current.exportPath}`);
        }
      } else {
        console.log(chalk.yellow('  No published version yet'));
        console.log(chalk.gray('  Publish a version to see it here'));
      }
      
      console.log('');
      
      if (state.previousVersion) {
        const previous = state.versions[state.previousVersion];
        console.log(`${chalk.magenta('◀ PREVIOUS PUBLISHED VERSION')}`);
        console.log(`  ${chalk.cyan('Version:')} ${previous.version}`);
        console.log(`  ${chalk.cyan('ID:')} ${previous.id}`);
        console.log(`  ${chalk.cyan('Status:')} ${formatStatus(previous.status)}`);
      }
      
      console.log('');
      console.log(chalk.cyan('Rule Configuration'));
      console.log(`  ${chalk.cyan('Version:')} ${state.ruleConfig.version}`);
      console.log(`  ${chalk.cyan('Updated:')} ${state.ruleConfig.updatedAt}`);
      
      const consistency = storage.verifyConsistency(state);
      console.log('');
      if (consistency.valid) {
        console.log(chalk.green('✓ State consistency check passed'));
      } else {
        console.log(chalk.yellow('⚠ State consistency issues found:'));
        consistency.issues.forEach(issue => {
          console.log(`  ${chalk.yellow('→')} ${issue}`);
        });
      }
    });

  status
    .command('counts')
    .description('Show count of versions by status')
    .action(async () => {
      const state = storage.loadState();
      
      const drafts = storage.getVersionsByStatus(state, 'draft').length;
      const pending = storage.getVersionsByStatus(state, 'pending_approval').length;
      const published = storage.getVersionsByStatus(state, 'published').length;
      const rejected = storage.getVersionsByStatus(state, 'rejected').length;
      const rolledBack = storage.getVersionsByStatus(state, 'rolled_back').length;
      
      console.log(chalk.blue('Version Counts by Status'));
      console.log('');
      console.log(`  ${chalk.gray('DRAFT:')}     ${drafts}`);
      console.log(`  ${chalk.yellow('PENDING:')}   ${pending}`);
      console.log(`  ${chalk.green('PUBLISHED:')} ${published}`);
      console.log(`  ${chalk.red('REJECTED:')}  ${rejected}`);
      console.log(`  ${chalk.magenta('ROLLED_BACK:')} ${rolledBack}`);
      console.log('');
      console.log(`  ${chalk.bold('TOTAL:')}     ${drafts + pending + published + rejected + rolledBack}`);
      
      if (state.currentVersion) {
        const current = state.versions[state.currentVersion];
        console.log('');
        console.log(chalk.green(`Current published: ${current.version}`));
      }
    });

  status
    .command('conflict [versionId]')
    .description('Explain why a version cannot be submitted/published directly, showing conflicts and resolution hints')
    .option('--action <action>', 'Action to check: submit or publish', 'submit')
    .action(async (versionId: string | undefined, options: any) => {
      const state = storage.loadState();
      const err = chalk.red;
      const ok = chalk.green;
      const warn = chalk.yellow;
      const info = chalk.cyan;
      const dim = chalk.gray;
      const bold = chalk.bold;

      let targetVersion;
      if (versionId) {
        targetVersion = state.versions[versionId];
        if (!targetVersion) {
          console.error(err(`Version not found: ${versionId}`));
          console.log(dim('Tip: Use `dataset-cli status all` to list all versions.'));
          process.exit(1);
        }
      } else {
        const drafts = storage.getVersionsByStatus(state, 'draft');
        const pending = storage.getVersionsByStatus(state, 'pending_approval');
        
        if (options.action === 'publish' && pending.length > 0) {
          targetVersion = pending[0];
        } else if (drafts.length > 0) {
          targetVersion = drafts[0];
        } else if (pending.length > 0) {
          targetVersion = pending[0];
        } else {
          console.error(err('No draft or pending versions found.'));
          console.log(dim('Run `dataset-cli scan <directory>` first to create a draft version.'));
          process.exit(1);
        }
        console.log(dim(`Using latest applicable version: ${targetVersion.version} (${targetVersion.id})`));
      }

      const action: DryRunAction = (options.action === 'publish') ? 'publish' : 'submit';
      const comparator = new PublishPlanComparator();
      const comparison = comparator.compare(action, state, targetVersion, state.ruleConfig);

      console.log(bold('========================================'));
      console.log(bold(`  CONFLICT ANALYSIS: ${action.toUpperCase()}`));
      console.log(bold('========================================'));
      console.log('');

      console.log(formatPublishPlanComparison(comparison));

      if (!comparison.conflict.hasConflict) {
        console.log(ok('✓ No conflicts detected for this version.'));
        if (action === 'submit') {
          console.log(dim('This version can be submitted via `dataset-cli submit`'));
        } else {
          console.log(dim('This version can be published via `dataset-cli publish --approver <name>`'));
        }
      } else {
        console.log(bold('========================================'));
        console.log(bold('  CONFLICT SUMMARY'));
        console.log(bold('========================================'));
        console.log('');
        console.log(`${err('Conflict type:')} ${comparison.conflict.conflictType}`);
        console.log('');
        console.log(`${bold('Reasons:')}`);
        comparison.conflict.conflictReasons.forEach((r, i) => {
          console.log(`  ${i + 1}. ${err(r)}`);
        });
        console.log('');
        if (comparison.conflict.conflictingVersionIds.length > 0) {
          console.log(`${info('Conflicting versions:')}`);
          comparison.conflict.conflictingVersionIds.forEach(id => {
            const v = state.versions[id];
            if (v) {
              console.log(`  - ${v.version} (${v.status}) [${id.substring(0, 16)}...]`);
            } else {
              console.log(`  - ${id.substring(0, 16)}...`);
            }
          });
          console.log('');
        }
        console.log(`${bold('How to resolve:')}`);
        comparison.conflict.resolutionHints.forEach((h, i) => {
          console.log(`  ${i + 1}. ${warn(h)}`);
        });
        console.log('');
        console.log(dim(`Tip: Run \`dataset-cli dry-run ${action}\` for a full pre-flight report.`));
      }
    });

  status
    .command('compare [versionId]')
    .description('Show side-by-side comparison of a draft/pending version vs the current published version')
    .option('--action <action>', 'Context of comparison: submit or publish', 'submit')
    .action(async (versionId: string | undefined, options: any) => {
      const state = storage.loadState();
      const dim = chalk.gray;

      let targetVersion;
      if (versionId) {
        targetVersion = state.versions[versionId];
        if (!targetVersion) {
          console.error(chalk.red(`Version not found: ${versionId}`));
          console.log(dim('Tip: Use `dataset-cli status all` to list all versions.'));
          process.exit(1);
        }
      } else {
        const drafts = storage.getVersionsByStatus(state, 'draft');
        const pending = storage.getVersionsByStatus(state, 'pending_approval');
        if (drafts.length > 0) {
          targetVersion = drafts[0];
        } else if (pending.length > 0) {
          targetVersion = pending[0];
        } else {
          console.error(chalk.red('No draft or pending versions found to compare.'));
          console.log(dim('Run `dataset-cli scan <directory>` first to create a draft version.'));
          process.exit(1);
        }
        console.log(dim(`Comparing latest version: ${targetVersion.version} (${targetVersion.id})`));
      }

      const action: DryRunAction = (options.action === 'publish') ? 'publish' : 'submit';
      const comparator = new PublishPlanComparator();
      const comparison = comparator.compare(action, state, targetVersion, state.ruleConfig);

      console.log(formatPublishPlanComparison(comparison));
    });
}
