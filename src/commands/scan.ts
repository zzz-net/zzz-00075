import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { scanDirectory } from '../utils/fileScanner';
import { ScanOptions } from '../types';

export function registerScanCommand(program: Command, storage: FileStorage): void {
  program
    .command('scan <directory>')
    .description('Scan a directory and create a draft version')
    .option('--include <patterns...>', 'Include patterns (glob)', ['**/*'])
    .option('--exclude <patterns...>', 'Exclude patterns (glob)', [])
    .option('--no-hash', 'Skip hash computation')
    .option('--by <user>', 'User creating the version', 'system')
    .action(async (directory: string, options: any) => {
      try {
        const scanOptions: ScanOptions = {
          includePatterns: options.include,
          excludePatterns: options.exclude,
          computeHash: options.hash !== false
        };

        console.log(chalk.blue(`Scanning directory: ${directory}`));
        console.log(chalk.gray('Include patterns:'), scanOptions.includePatterns);
        if (scanOptions.excludePatterns && scanOptions.excludePatterns.length > 0) {
          console.log(chalk.gray('Exclude patterns:'), scanOptions.excludePatterns);
        }

        const files = scanDirectory(directory, scanOptions);
        
        console.log(chalk.green(`Found ${files.length} files:`));
        files.forEach(f => {
          console.log(`  ${chalk.cyan(f.path)} ${chalk.gray(`(${f.size} bytes)`)}`);
          if (f.license) {
            console.log(`    ${chalk.yellow('License:')} ${f.license}`);
          }
        });

        let state = storage.loadState();
        const result = storage.createVersion(state, directory, files, options.by);
        state = result.state;
        storage.saveState(state);

        console.log('');
        console.log(chalk.green(`✓ Draft version created: ${result.version.version}`));
        console.log(chalk.gray(`  Version ID: ${result.version.id}`));
        console.log(chalk.gray(`  Status: ${result.version.status}`));
        console.log(chalk.gray(`  Files: ${result.version.files.length}`));
        console.log(chalk.gray(`  Rule version: ${result.version.ruleVersion}`));

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
