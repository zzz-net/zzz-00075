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

export function registerHistoryCommand(program: Command, storage: FileStorage): void {
  const history = program
    .command('history')
    .description('Show state transition history');

  history
    .command('all')
    .description('Show complete history of all state transitions')
    .option('--limit <n>', 'Limit to last N entries', '100')
    .action(async (options: any) => {
      const state = storage.loadState();
      const limit = parseInt(options.limit);
      
      const transitions = [...state.stateHistory]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);

      if (transitions.length === 0) {
        console.log(chalk.yellow('No history found.'));
        return;
      }

      console.log(chalk.blue('State Transition History'));
      console.log(chalk.gray(`Showing ${transitions.length} of ${state.stateHistory.length} transitions`));
      console.log('');

      transitions.forEach((t, index) => {
        const version = state.versions[t.versionId];
        const versionLabel = version ? `${version.version} (${t.versionId.substring(0, 12)}...)` : t.versionId;
        
        console.log(`${chalk.gray(`#${transitions.length - index}`)} ${chalk.cyan(t.timestamp)}`);
        console.log(`  Version: ${versionLabel}`);
        console.log(`  Transition: ${formatStatus(t.fromStatus)} ${chalk.white('→')} ${formatStatus(t.toStatus)}`);
        console.log(`  Actor: ${t.actor}`);
        console.log(`  Reason: ${t.reason}`);
        if (index < transitions.length - 1) {
          console.log('');
        }
      });
    });

  history
    .command('version <versionId>')
    .description('Show history for a specific version')
    .action(async (versionId: string) => {
      const state = storage.loadState();
      
      const version = state.versions[versionId];
      if (!version) {
        console.error(chalk.red(`Version not found: ${versionId}`));
        process.exit(1);
      }

      const transitions = storage.getStateHistoryForVersion(state, versionId);

      console.log(chalk.blue(`History for version: ${version.version}`));
      console.log(chalk.gray(`ID: ${version.id}`));
      console.log(chalk.gray(`Current status: ${formatStatus(version.status)}`));
      console.log('');

      if (transitions.length === 0) {
        console.log(chalk.yellow('No transitions found for this version.'));
        return;
      }

      transitions.forEach((t, index) => {
        console.log(`${chalk.gray(`#${index + 1}`)} ${chalk.cyan(t.timestamp)}`);
        console.log(`  ${formatStatus(t.fromStatus)} ${chalk.white('→')} ${formatStatus(t.toStatus)}`);
        console.log(`  Actor: ${t.actor}`);
        console.log(`  Reason: ${t.reason}`);
        if (index < transitions.length - 1) {
          console.log('');
        }
      });
    });

  history
    .command('flow')
    .description('Show the complete lifecycle flow of all versions')
    .action(async () => {
      const state = storage.loadState();
      const versions = storage.getAllVersions(state);

      if (versions.length === 0) {
        console.log(chalk.yellow('No versions found.'));
        return;
      }

      console.log(chalk.blue('Version Lifecycle Flow'));
      console.log('');

      versions.forEach((v, vIndex) => {
        const transitions = storage.getStateHistoryForVersion(state, v.id);
        
        const isCurrent = v.id === state.currentVersion;
        const isPrevious = v.id === state.previousVersion;
        
        const prefix = isCurrent ? chalk.green('★ ') : isPrevious ? chalk.magenta('◀ ') : '  ';
        
        console.log(`${prefix}${chalk.bold(v.version)} ${formatStatus(v.status)}`);
        console.log(`  Created: ${v.createdAt} by ${v.createdBy}`);
        
        if (transitions.length > 0) {
          const flow = transitions.map(t => 
            `${formatStatus(t.fromStatus)}→${formatStatus(t.toStatus)}`
          ).join(' → ');
          console.log(`  Flow: ${flow}`);
        }
        
        if (v.previousVersion) {
          const prev = state.versions[v.previousVersion];
          console.log(`  Replaced: ${prev ? prev.version : v.previousVersion}`);
        }
        if (v.replacedBy) {
          const next = state.versions[v.replacedBy];
          console.log(`  Replaced by: ${next ? next.version : v.replacedBy}`);
        }
        
        if (isCurrent) {
          console.log(`  ${chalk.green('→ CURRENT')}`);
        }
        if (isPrevious) {
          console.log(`  ${chalk.magenta('→ PREVIOUS')}`);
        }
        
        if (vIndex < versions.length - 1) {
          console.log('');
        }
      });

      console.log('');
      console.log(chalk.gray('Legend: ★ Current, ◀ Previous'));
      console.log(chalk.gray(`Statuses: ${formatStatus('draft')} ${formatStatus('pending_approval')} ${formatStatus('published')} ${formatStatus('rejected')} ${formatStatus('rolled_back')}`));
    });
}
