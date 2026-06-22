import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { VersionStatus } from '../types';

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
}
