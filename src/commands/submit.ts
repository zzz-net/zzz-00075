import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { DryRunEngine } from '../services/DryRunEngine';
import { DryRunResult } from '../types';
import { printBlockReasons, formatSummaryBox } from '../services/DryRunSummary';

export function registerSubmitCommand(program: Command, storage: FileStorage): void {
  program
    .command('submit [versionId]')
    .description('Submit a draft version for approval (try `dry-run submit` first to pre-check)')
    .option('--by <user>', 'User submitting the version', 'system')
    .option('--skip-verify', 'Skip hash/size verification (license HARD BLOCK still enforced)')
    .option('--dry-run', 'Preview what submit would do without changing state (alias for dry-run submit)')
    .action(async (versionId: string | undefined, options: any) => {
      try {
        let state = storage.loadState();
        
        let targetVersion;
        if (versionId) {
          targetVersion = state.versions[versionId];
          if (!targetVersion) {
            console.error(chalk.red(`Version not found: ${versionId}`));
            console.log(chalk.gray('Tip: Use `dataset-cli status all` to list all versions.'));
            process.exit(1);
          }
        } else {
          const drafts = storage.getVersionsByStatus(state, 'draft');
          if (drafts.length === 0) {
            console.error(chalk.red('No draft versions found to submit'));
            console.log(chalk.gray('Run `dataset-cli scan <directory>` first to create a draft version.'));
            console.log(chalk.gray('Tip: Run `dataset-cli dry-run submit` to pre-check before submitting.'));
            process.exit(1);
          }
          targetVersion = drafts[0];
          console.log(chalk.gray(`Using latest draft: ${targetVersion.version} (${targetVersion.id})`));
        }

        const engine = new DryRunEngine();
        const precheck = engine.evaluate('submit', state, targetVersion, {
          skipVerify: !!options.skipVerify
        });

        if (options.dryRun) {
          console.log(formatSummaryBox(precheck));
          console.log(chalk.gray('(This was a --dry-run preview. No state was changed.)'));
          if (precheck.blockedAt !== 'none') {
            process.exit(1);
          }
          return;
        }

        if (precheck.blockedAt !== 'none') {
          printBlockReasons(precheck);
          console.log('');
          console.log(chalk.yellow('Tip: Run `dataset-cli dry-run submit` for a detailed pre-flight report before submitting.'));
          process.exit(1);
        }

        if (!options.skipVerify) {
          console.log(chalk.green('Verification passed'));
        } else {
          console.log(chalk.green('License hard block check passed (--skip-verify bypassed hash/size only)'));
        }
        console.log('');

        state = storage.updateVersionStatus(
          state,
          targetVersion.id,
          'pending_approval',
          options.by,
          'Submitted for approval'
        );
        storage.saveState(state);

        const updatedVersion = state.versions[targetVersion.id];

        console.log(chalk.green(`Version submitted for approval: ${updatedVersion.version}`));
        console.log(chalk.gray(`  Version ID: ${updatedVersion.id}`));
        console.log(chalk.gray(`  Status: ${updatedVersion.status}`));
        console.log(chalk.gray(`  Submitted by: ${options.by}`));
        console.log(chalk.gray(`  Files: ${updatedVersion.files.length}`));
        console.log('');
        console.log(chalk.yellow('Recommended next steps:'));
        console.log(`  1. ${chalk.cyan('dataset-cli dry-run publish --approver <name>')} - Pre-check publish readiness`);
        console.log(`  2. ${chalk.cyan('dataset-cli publish --approver <name>')} - Approve and publish`);

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
