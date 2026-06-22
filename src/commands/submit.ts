import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { DryRunEngine } from '../services/DryRunEngine';
import { DryRunResult } from '../types';

function printDryRunBlock(r: DryRunResult): void {
  if (r.blockedAt === 'hard_block') {
    console.error(chalk.red('HARD BLOCK: License rules violated - CANNOT be bypassed, even with --skip-verify'));
    r.hardBlock.reasons.forEach(re => console.error(chalk.red(`  -> ${re}`)));
    console.log(chalk.gray('Fix license issues before submitting.'));
  } else if (r.blockedAt === 'verification') {
    console.error(chalk.red('Verification failed. Cannot submit.'));
    r.verifyResult.errors.forEach(err => console.log(`  ${chalk.red('->')} ${err}`));
    console.log(chalk.gray('Fix errors or use --skip-verify to bypass hash/size checks (license rules CANNOT be bypassed)'));
  } else if (r.blockedAt === 'status_check') {
    console.error(chalk.red(`Cannot submit version with status: ${r.currentStatus}`));
    console.log(chalk.gray('Only draft versions can be submitted for approval'));
  }
}

export function registerSubmitCommand(program: Command, storage: FileStorage): void {
  program
    .command('submit [versionId]')
    .description('Submit a draft version for approval')
    .option('--by <user>', 'User submitting the version', 'system')
    .option('--skip-verify', 'Skip hash/size verification (license HARD BLOCK still enforced)')
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

        const engine = new DryRunEngine();
        const precheck = engine.evaluate('submit', state, targetVersion, {
          skipVerify: !!options.skipVerify
        });

        if (precheck.blockedAt !== 'none') {
          printDryRunBlock(precheck);
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
        console.log(chalk.yellow('Next step: Run `dataset-cli publish` to approve and publish'));

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
