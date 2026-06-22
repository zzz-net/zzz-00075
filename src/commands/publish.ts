import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { DryRunEngine } from '../services/DryRunEngine';
import { DryRunResult } from '../types';
import { printBlockReasons, formatSummaryBox } from '../services/DryRunSummary';

export function registerPublishCommand(program: Command, storage: FileStorage): void {
  program
    .command('publish [versionId]')
    .description('Approve and publish a pending version (try `dry-run publish` first to pre-check)')
    .requiredOption('--approver <name>', 'Approver name')
    .option('--comment <text>', 'Approval comment', 'Approved for publication')
    .option('--skip-verify', 'Skip hash/size verification (license HARD BLOCK still enforced)')
    .option('--force', 'Force publish overriding hash/size (license HARD BLOCK still enforced)')
    .option('--dry-run', 'Preview what publish would do without changing state (alias for dry-run publish)')
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
          const pending = storage.getVersionsByStatus(state, 'pending_approval');
          if (pending.length === 0) {
            console.error(chalk.red('No pending versions found to publish'));
            console.log(chalk.gray('Use `dataset-cli submit` first to submit a draft for approval.'));
            console.log(chalk.gray('Tip: Run `dataset-cli dry-run publish --approver <name>` to pre-check before publishing.'));
            process.exit(1);
          }
          targetVersion = pending[0];
          console.log(chalk.gray(`Using latest pending: ${targetVersion.version} (${targetVersion.id})`));
        }

        console.log(chalk.blue(`Publishing version: ${targetVersion.version}`));
        console.log(chalk.gray(`Approver: ${options.approver}`));
        console.log(chalk.gray(`Comment: ${options.comment}`));
        console.log('');

        const engine = new DryRunEngine();
        const precheck = engine.evaluate('publish', state, targetVersion, {
          skipVerify: !!options.skipVerify,
          force: !!options.force
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
          console.log(chalk.yellow('Tip: Run `dataset-cli dry-run publish --approver <name>` for a detailed pre-flight report before publishing.'));
          process.exit(1);
        }

        if (!options.skipVerify) {
          console.log(chalk.green('Verification passed'));
        } else {
          console.log(chalk.green('License hard block check passed (--skip-verify bypassed hash/size only)'));
        }
        if (options.force) {
          console.log(chalk.yellow('--force was specified: hash/size issues would be overridden'));
        }
        console.log('');

        const previousVersionId = state.currentVersion;
        const previousVersion = previousVersionId ? state.versions[previousVersionId] : null;

        const result = storage.publishVersion(
          state,
          targetVersion.id,
          options.approver,
          options.comment
        );
        state = result.state;
        storage.saveState(state);

        const publishedVersion = state.versions[targetVersion.id];
        const manifest = result.manifest;

        console.log(chalk.green('Version published successfully!'));
        console.log('');
        console.log(chalk.bold('Publication Details:'));
        console.log(`  ${chalk.cyan('Version:')} ${publishedVersion.version}`);
        console.log(`  ${chalk.cyan('Version ID:')} ${publishedVersion.id}`);
        console.log(`  ${chalk.cyan('Status:')} ${publishedVersion.status}`);
        console.log(`  ${chalk.cyan('Files:')} ${publishedVersion.files.length}`);
        console.log(`  ${chalk.cyan('Total size:')} ${manifest.totalSize} bytes`);
        console.log(`  ${chalk.cyan('Rule version:')} ${manifest.ruleVersion}`);
        console.log(`  ${chalk.cyan('Manifest hash:')} ${manifest.signature}`);
        console.log(`  ${chalk.cyan('Manifest path:')} ${publishedVersion.exportPath}`);
        console.log('');
        
        if (previousVersion) {
          console.log(chalk.yellow(`Previous published version: ${previousVersion.version} (now replaced)`));
          console.log(chalk.gray(`  Previous ID: ${previousVersion.id}`));
        }
        
        console.log('');
        console.log(chalk.yellow('Recommended next steps:'));
        console.log(`  1. ${chalk.cyan('dataset-cli status current')} - Verify the new published version`);
        console.log(`  2. ${chalk.cyan('dataset-cli export --output <path>')} - Export the manifest for distribution`);

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
