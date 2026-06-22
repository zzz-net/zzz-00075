import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { DryRunEngine } from '../services/DryRunEngine';
import { DryRunResult } from '../types';

function printDryRunBlock(r: DryRunResult): void {
  if (r.blockedAt === 'hard_block') {
    console.error(chalk.red('HARD BLOCK: License rules violated - CANNOT be bypassed, even with --force'));
    r.hardBlock.reasons.forEach(re => console.error(chalk.red(`  -> ${re}`)));
    console.log('');
    console.log(chalk.gray('Fix license issues before publishing. --force is NOT permitted for license violations.'));
  } else if (r.blockedAt === 'verification') {
    console.error(chalk.red('Verification failed. Cannot publish.'));
    console.log('');
    r.verifyResult.errors.forEach(err => {
      console.log(`  ${chalk.red('->')} ${err}`);
    });
    console.log('');
    if (r.forceUsed) {
      console.log(chalk.gray('Even --force cannot override these errors (they may be hard blocks).'));
    } else {
      console.log(chalk.gray('Fix errors and retry, or use --force to override hash/size (license rules CANNOT be overridden)'));
    }
  } else if (r.blockedAt === 'status_check') {
    console.error(chalk.red(`Cannot publish version with status: ${r.currentStatus}`));
    console.log(chalk.gray('Only pending_approval versions can be published'));
  }
}

export function registerPublishCommand(program: Command, storage: FileStorage): void {
  program
    .command('publish [versionId]')
    .description('Approve and publish a pending version')
    .requiredOption('--approver <name>', 'Approver name')
    .option('--comment <text>', 'Approval comment', 'Approved for publication')
    .option('--skip-verify', 'Skip hash/size verification (license HARD BLOCK still enforced)')
    .option('--force', 'Force publish overriding hash/size (license HARD BLOCK still enforced)')
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

        console.log(chalk.blue(`Publishing version: ${targetVersion.version}`));
        console.log(chalk.gray(`Approver: ${options.approver}`));
        console.log(chalk.gray(`Comment: ${options.comment}`));
        console.log('');

        const engine = new DryRunEngine();
        const precheck = engine.evaluate('publish', state, targetVersion, {
          skipVerify: !!options.skipVerify,
          force: !!options.force
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
        console.log(chalk.gray('You can run `dataset-cli export` to export the manifest to a custom location'));
        console.log(chalk.gray('Run `dataset-cli status` to see all versions'));

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
