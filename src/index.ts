#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from './storage/FileStorage';
import { registerScanCommand } from './commands/scan';
import { registerConfigCommand } from './commands/config';
import { registerVerifyCommand } from './commands/verify';
import { registerSubmitCommand } from './commands/submit';
import { registerPublishCommand } from './commands/publish';
import { registerRollbackCommand } from './commands/rollback';
import { registerExportCommand } from './commands/export';
import { registerStatusCommand } from './commands/status';
import { registerHistoryCommand } from './commands/history';
import { registerDryRunCommand } from './commands/dryrun';

const program = new Command();
const storage = new FileStorage(process.cwd());

program
  .name('dataset-cli')
  .description('Offline dataset manifest publishing CLI with version control and approval workflow')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize the dataset manifest system in the current directory')
  .action(async () => {
    const state = storage.loadState();
    console.log(chalk.green('✓ Dataset manifest system initialized'));
    console.log('');
    console.log(chalk.bold('Storage location:'));
    console.log(`  ${chalk.cyan(process.cwd() + '/.dataset')}`);
    console.log('');
    console.log(chalk.bold('Default rules:'));
    state.ruleConfig.rules.forEach(rule => {
      const status = rule.enabled ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${status} ${rule.type}`);
    });
    console.log('');
    console.log(chalk.gray('Next steps:'));
    console.log(`  1. ${chalk.cyan('dataset-cli scan <directory>')} - Scan your dataset directory`);
    console.log(`  2. ${chalk.cyan('dataset-cli verify')} - Verify against rules`);
    console.log(`  3. ${chalk.cyan('dataset-cli submit')} - Submit for approval`);
    console.log(`  4. ${chalk.cyan('dataset-cli publish --approver <name>')} - Approve and publish`);
  });

registerScanCommand(program, storage);
registerConfigCommand(program, storage);
registerVerifyCommand(program, storage);
registerSubmitCommand(program, storage);
registerPublishCommand(program, storage);
registerRollbackCommand(program, storage);
registerExportCommand(program, storage);
registerStatusCommand(program, storage);
registerHistoryCommand(program, storage);
registerDryRunCommand(program, storage);

program.parseAsync(process.argv).catch((error) => {
  console.error(chalk.red(`Fatal error: ${error instanceof Error ? error.message : error}`));
  process.exit(1);
});
