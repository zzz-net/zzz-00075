import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { Validator } from '../services/Validator';

export function registerPublishCommand(program: Command, storage: FileStorage): void {
  program
    .command('publish [versionId]')
    .description('Approve and publish a pending version')
    .requiredOption('--approver <name>', 'Approver name')
    .option('--comment <text>', 'Approval comment', 'Approved for publication')
    .option('--skip-verify', 'Skip verification before publishing (NOT recommended)')
    .option('--force', 'Force publish even if verification fails (DANGEROUS)')
    .action(async (versionId: string | undefined, options: any) => {
      try {
        let state = storage.loadState();
        
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
            console.error(chalk.red('No pending versions found to publish'));
            console.log(chalk.gray('Use `dataset-cli submit` first to submit a draft for approval'));
            process.exit(1);
          }
          targetVersion = pending[0];
          console.log(chalk.gray(`Using latest pending: ${targetVersion.version} (${targetVersion.id})`));
        }

        if (targetVersion.status !== 'pending_approval') {
          console.error(chalk.red(`Cannot publish version with status: ${targetVersion.status}`));
          console.log(chalk.gray('Only pending_approval versions can be published'));
          process.exit(1);
        }

        console.log(chalk.blue(`Publishing version: ${targetVersion.version}`));
        console.log(chalk.gray(`Approver: ${options.approver}`));
        console.log(chalk.gray(`Comment: ${options.comment}`));
        console.log('');

        const validator = new Validator(state.ruleConfig);
        let canPublish = true;
        let hardBlockReasons: string[] = [];
        
        if (!options.skipVerify) {
          console.log(chalk.blue('Running verification...'));
          const result = validator.verify(targetVersion.scanDir, targetVersion.files, true);
          const hardBlock = validator.hasHardBlockErrors(result);
          hardBlockReasons = hardBlock.reasons;
          canPublish = validator.canPublish(result);
          
          if (hardBlock.blocked) {
            console.error(chalk.red('✗ HARD BLOCK: License rules violated — CANNOT be bypassed, even with --force'));
            hardBlock.reasons.forEach(r => console.error(chalk.red(`  → ${r}`)));
            console.log('');
            console.log(chalk.gray('Fix license issues before publishing. --force is NOT permitted for license violations.'));
            process.exit(1);
          }
          
          if (!result.passed) {
            if (options.force) {
              console.log(chalk.yellow('⚠ Hash/size verification failed, but --force was specified. Publishing anyway...'));
              console.log(chalk.yellow('  Note: License HARD BLOCK rules still passed; only hash/size issues were overridden.'));
              canPublish = true;
            } else {
              console.error(chalk.red('✗ Verification failed. Cannot publish.'));
              console.log('');
              result.errors.forEach(err => {
                console.log(`  ${chalk.red('→')} ${err}`);
              });
              console.log('');
              console.log(chalk.gray('Fix errors and retry, or use --force to override hash/size (license rules CANNOT be overridden)'));
              process.exit(1);
            }
          } else {
            console.log(chalk.green('✓ Verification passed'));
          }
          console.log('');
        } else {
          console.log(chalk.yellow('⚠ --skip-verify used, but license HARD BLOCK check still enforced'));
          console.log(chalk.gray('  Checking license compliance is always enforced regardless of --skip-verify'));
          const licenseCheck = validator.verify(targetVersion.scanDir, targetVersion.files, false);
          const hardBlock = validator.hasHardBlockErrors(licenseCheck);
          hardBlockReasons = hardBlock.reasons;
          if (hardBlock.blocked) {
            console.error(chalk.red('✗ HARD BLOCK: License rules violated — CANNOT be bypassed, even with --skip-verify'));
            hardBlock.reasons.forEach(r => console.error(chalk.red(`  → ${r}`)));
            process.exit(1);
          }
          console.log(chalk.green('✓ License hard block check passed'));
          console.log('');
        }

        if (!canPublish && !options.force) {
          console.error(chalk.red('✗ Cannot publish - validation rules not satisfied'));
          if (hardBlockReasons.length > 0) {
            console.error(chalk.red('  Hard block reasons:'));
            hardBlockReasons.forEach(r => console.error(chalk.red(`    → ${r}`)));
          }
          process.exit(1);
        }

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

        console.log(chalk.green('✓ Version published successfully!'));
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
        console.log(chalk.gray('You can run `dataset-cli export` to export the manifest to a custom location'));
        console.log(chalk.gray('Run `dataset-cli status` to see all versions'));

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
