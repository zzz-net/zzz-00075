import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { Validator } from '../services/Validator';

export function registerVerifyCommand(program: Command, storage: FileStorage): void {
  program
    .command('verify [versionId]')
    .description('Verify a version against validation rules')
    .option('--quick', 'Skip file integrity check (only check existence)')
    .action(async (versionId: string | undefined, options: any) => {
      try {
        const state = storage.loadState();
        
        let targetVersion;
        if (versionId) {
          targetVersion = state.versions[versionId];
          if (!targetVersion) {
            console.error(chalk.red(`Version not found: ${versionId}`));
            process.exit(1);
          }
        } else {
          const drafts = storage.getVersionsByStatus(state, 'draft');
          const pending = storage.getVersionsByStatus(state, 'pending_approval');
          const allDrafts = [...drafts, ...pending];
          
          if (allDrafts.length === 0) {
            console.error(chalk.red('No draft or pending versions found to verify'));
            process.exit(1);
          }
          targetVersion = allDrafts[0];
          console.log(chalk.gray(`Using latest version: ${targetVersion.version} (${targetVersion.id})`));
        }

        console.log(chalk.blue(`Verifying version: ${targetVersion.version}`));
        console.log(chalk.gray(`Scan directory: ${targetVersion.scanDir}`));
        console.log(chalk.gray(`Rule version: ${targetVersion.ruleVersion}`));
        console.log('');

        const validator = new Validator(state.ruleConfig);
        const checkIntegrity = !options.quick;
        const result = validator.verify(targetVersion.scanDir, targetVersion.files, checkIntegrity);

        const canPublish = validator.canPublish(result);

        if (result.passed) {
          console.log(chalk.green('✓ All checks passed!'));
        } else {
          console.log(chalk.red('✗ Verification failed'));
          console.log('');
          console.log(chalk.bold('Errors:'));
          result.errors.forEach((error, i) => {
            console.log(`  ${chalk.red(`${i + 1}.`)} ${error}`);
          });
        }

        if (result.warnings.length > 0) {
          console.log('');
          console.log(chalk.yellow('Warnings:'));
          result.warnings.forEach((warning, i) => {
            console.log(`  ${chalk.yellow(`${i + 1}.`)} ${warning}`);
          });
        }

        console.log('');
        console.log(chalk.bold('File results:'));
        result.fileResults.forEach(fr => {
          const statuses = [];
          if (fr.hashOk) statuses.push(chalk.green('H'));
          else statuses.push(chalk.red('H'));
          if (fr.sizeOk) statuses.push(chalk.green('S'));
          else statuses.push(chalk.red('S'));
          if (fr.licenseOk) statuses.push(chalk.green('L'));
          else statuses.push(chalk.red('L'));
          
          console.log(`  [${statuses.join('')}] ${fr.filePath}`);
          fr.errors.forEach(err => {
            console.log(`      ${chalk.red('→')} ${err}`);
          });
        });

        console.log('');
        if (canPublish) {
          console.log(chalk.green('✓ This version can be published'));
        } else {
          console.log(chalk.red('✗ This version cannot be published - fix errors first'));
        }
        console.log(chalk.gray(`  H=Hash, S=Size, L=License`));

        process.exit(result.passed ? 0 : 1);

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
