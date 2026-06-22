import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';

export function registerRollbackCommand(program: Command, storage: FileStorage): void {
  program
    .command('rollback <targetVersionId>')
    .description('Rollback to a previous published version')
    .requiredOption('--by <user>', 'User performing the rollback')
    .option('--reason <text>', 'Reason for rollback', 'Rollback to previous version')
    .action(async (targetVersionId: string, options: any) => {
      try {
        let state = storage.loadState();
        
        const targetVersion = state.versions[targetVersionId];
        if (!targetVersion) {
          console.error(chalk.red(`Version not found: ${targetVersionId}`));
          process.exit(1);
        }

        const currentVersion = state.currentVersion ? state.versions[state.currentVersion] : null;

        console.log(chalk.yellow('⚠ ROLLBACK OPERATION'));
        console.log('');
        console.log(chalk.bold('Current published version:'));
        if (currentVersion) {
          console.log(`  ${chalk.cyan('Version:')} ${currentVersion.version}`);
          console.log(`  ${chalk.cyan('ID:')} ${currentVersion.id}`);
          console.log(`  ${chalk.cyan('Created:')} ${currentVersion.createdAt}`);
          if (currentVersion.approval) {
            console.log(`  ${chalk.cyan('Approver:')} ${currentVersion.approval.approver}`);
          }
        } else {
          console.log(`  ${chalk.gray('No current published version')}`);
        }
        console.log('');
        console.log(chalk.bold('Target rollback version:'));
        console.log(`  ${chalk.cyan('Version:')} ${targetVersion.version}`);
        console.log(`  ${chalk.cyan('ID:')} ${targetVersion.id}`);
        console.log(`  ${chalk.cyan('Status:')} ${targetVersion.status}`);
        console.log(`  ${chalk.cyan('Created:')} ${targetVersion.createdAt}`);
        console.log(`  ${chalk.cyan('Files:')} ${targetVersion.files.length}`);
        if (targetVersion.approval) {
          console.log(`  ${chalk.cyan('Approver:')} ${targetVersion.approval.approver}`);
          console.log(`  ${chalk.cyan('Approval comment:')} ${targetVersion.approval.comment}`);
        }
        console.log('');
        console.log(chalk.gray(`Performed by: ${options.by}`));
        console.log(chalk.gray(`Reason: ${options.reason}`));
        console.log('');

        if (currentVersion && currentVersion.id === targetVersionId) {
          console.error(chalk.red('✗ Cannot rollback - target version is already the current published version'));
          process.exit(1);
        }

        const targetManifest = storage.loadManifest(targetVersionId);
        if (!targetManifest) {
          console.error(chalk.red(`✗ No manifest found for version ${targetVersionId}`));
          console.log(chalk.gray('Only versions that were previously published can be rolled back to'));
          process.exit(1);
        }

        console.log(chalk.blue('Verifying target version files...'));
        const targetVersionOnDisk = storage.loadVersion(targetVersionId);
        if (!targetVersionOnDisk) {
          console.error(chalk.red('✗ Target version data not found on disk'));
          process.exit(1);
        }

        if (targetVersionOnDisk.updatedAt !== targetVersion.updatedAt) {
          console.error(chalk.red('✗ Version data inconsistency detected between state and disk'));
          console.log(chalk.gray('The version on disk does not match the state. This may indicate corruption.'));
          process.exit(1);
        }

        const consistencyCheck = storage.verifyConsistency(state);
        if (!consistencyCheck.valid) {
          console.log(chalk.yellow('⚠ Consistency issues detected:'));
          consistencyCheck.issues.forEach(issue => {
            console.log(`  ${chalk.yellow('→')} ${issue}`);
          });
          console.log('');
        }

        state = storage.rollbackToVersion(state, targetVersionId, options.by, options.reason);
        storage.saveState(state);

        const newCurrent = state.versions[targetVersionId];
        const oldCurrent = state.previousVersion ? state.versions[state.previousVersion] : null;

        console.log(chalk.green('✓ Rollback completed successfully!'));
        console.log('');
        console.log(chalk.bold('Rollback Summary:'));
        console.log(`  ${chalk.cyan('New current version:')} ${newCurrent.version} (${newCurrent.id})`);
        if (oldCurrent) {
          console.log(`  ${chalk.cyan('Previous version (now rolled_back):')} ${oldCurrent.version} (${oldCurrent.id})`);
        }
        console.log(`  ${chalk.cyan('Performed by:')} ${options.by}`);
        console.log(`  ${chalk.cyan('Reason:')} ${options.reason}`);
        console.log(`  ${chalk.cyan('Rule version:')} ${newCurrent.ruleVersion}`);
        if (newCurrent.manifestHash) {
          console.log(`  ${chalk.cyan('Manifest hash:')} ${newCurrent.manifestHash}`);
        }
        console.log('');
        console.log(chalk.gray('Run `dataset-cli status` to verify the current state'));
        console.log(chalk.gray('Run `dataset-cli history` to see the state transition history'));

        const postCheck = storage.verifyConsistency(state);
        if (!postCheck.valid) {
          console.log('');
          console.log(chalk.yellow('⚠ Post-rollback consistency issues:'));
          postCheck.issues.forEach(issue => {
            console.log(`  ${chalk.yellow('→')} ${issue}`);
          });
        }

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
