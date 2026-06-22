import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { Validator } from '../services/Validator';

export function registerSubmitCommand(program: Command, storage: FileStorage): void {
  program
    .command('submit [versionId]')
    .description('Submit a draft version for approval')
    .option('--by <user>', 'User submitting the version', 'system')
    .option('--skip-verify', 'Skip verification before submitting (not recommended)')
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
          const drafts = storage.getVersionsByStatus(state, 'draft');
          if (drafts.length === 0) {
            console.error(chalk.red('No draft versions found to submit'));
            process.exit(1);
          }
          targetVersion = drafts[0];
          console.log(chalk.gray(`Using latest draft: ${targetVersion.version} (${targetVersion.id})`));
        }

        if (targetVersion.status !== 'draft') {
          console.error(chalk.red(`Cannot submit version with status: ${targetVersion.status}`));
          console.log(chalk.gray('Only draft versions can be submitted for approval'));
          process.exit(1);
        }

        const validator = new Validator(state.ruleConfig);
        
        if (!options.skipVerify) {
          console.log(chalk.blue('Running verification before submit...'));
          const result = validator.verify(targetVersion.scanDir, targetVersion.files, true);
          
          if (!result.passed) {
            console.error(chalk.red('✗ Verification failed. Cannot submit.'));
            console.log(chalk.gray('Fix verification errors or use --skip-verify to bypass hash/size checks (license rules CANNOT be bypassed)'));
            process.exit(1);
          }
          console.log(chalk.green('✓ Verification passed'));
          console.log('');
        } else {
          console.log(chalk.yellow('⚠ --skip-verify used, but license HARD BLOCK check still enforced'));
          console.log(chalk.gray('  Checking license compliance is always enforced regardless of --skip-verify'));
          const licenseCheck = validator.verify(targetVersion.scanDir, targetVersion.files, false);
          const hardBlock = validator.hasHardBlockErrors(licenseCheck);
          if (hardBlock.blocked) {
            console.error(chalk.red('✗ HARD BLOCK: License rules violated — CANNOT be bypassed, even with --skip-verify'));
            hardBlock.reasons.forEach(r => console.error(chalk.red(`  → ${r}`)));
            console.log(chalk.gray('Fix license issues before submitting.'));
            process.exit(1);
          }
          console.log(chalk.green('✓ License hard block check passed'));
          console.log('');
        }

        state = storage.updateVersionStatus(
          state,
          targetVersion.id,
          'pending_approval',
          options.by,
          'Submitted for approval'
        );
        storage.saveState(state);

        const updatedVersion = state.versions[targetVersion.id];

        console.log(chalk.green(`✓ Version submitted for approval: ${updatedVersion.version}`));
        console.log(chalk.gray(`  Version ID: ${updatedVersion.id}`));
        console.log(chalk.gray(`  Status: ${updatedVersion.status}`));
        console.log(chalk.gray(`  Submitted by: ${options.by}`));
        console.log(chalk.gray(`  Files: ${updatedVersion.files.length}`));
        console.log('');
        console.log(chalk.yellow('Next step: Run `dataset-cli publish` to approve and publish'));

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
