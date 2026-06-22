import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { FileStorage } from '../storage/FileStorage';

export function registerExportCommand(program: Command, storage: FileStorage): void {
  program
    .command('export [versionId]')
    .description('Export the manifest for a published version')
    .option('--output <path>', 'Output path for the manifest', './manifest.json')
    .option('--pretty', 'Pretty-print the JSON output', true)
    .action(async (versionId: string | undefined, options: any) => {
      try {
        const state = storage.loadState();
        
        let targetVersionId = versionId;
        if (!targetVersionId) {
          if (state.currentVersion) {
            targetVersionId = state.currentVersion;
            console.log(chalk.gray(`Using current published version`));
          } else {
            console.error(chalk.red('No version specified and no current published version found'));
            console.log(chalk.gray('Specify a versionId or publish a version first'));
            process.exit(1);
          }
        }

        const targetVersion = state.versions[targetVersionId];
        if (!targetVersion) {
          console.error(chalk.red(`Version not found: ${targetVersionId}`));
          process.exit(1);
        }

        const manifest = storage.loadManifest(targetVersionId);
        if (!manifest) {
          console.error(chalk.red(`No manifest found for version ${targetVersionId}`));
          console.log(chalk.gray('Only published versions have manifests. Publish the version first.'));
          process.exit(1);
        }

        const outputPath = path.resolve(options.output);
        const exportedPath = storage.exportManifest(manifest, outputPath);

        console.log(chalk.green('✓ Manifest exported successfully!'));
        console.log('');
        console.log(chalk.bold('Export Details:'));
        console.log(`  ${chalk.cyan('Version:')} ${targetVersion.version}`);
        console.log(`  ${chalk.cyan('Version ID:')} ${targetVersion.id}`);
        console.log(`  ${chalk.cyan('Rule version:')} ${manifest.ruleVersion}`);
        console.log(`  ${chalk.cyan('Generated at:')} ${manifest.generatedAt}`);
        console.log(`  ${chalk.cyan('File count:')} ${manifest.fileCount}`);
        console.log(`  ${chalk.cyan('Total size:')} ${manifest.totalSize} bytes`);
        console.log(`  ${chalk.cyan('Approver:')} ${manifest.approval.approver}`);
        console.log(`  ${chalk.cyan('Signature:')} ${manifest.signature}`);
        console.log(`  ${chalk.cyan('Exported to:')} ${exportedPath}`);
        console.log('');
        console.log(chalk.gray('The exported manifest contains the complete file inventory with hashes'));
        console.log(chalk.gray('It can be used for data validation and integrity verification'));

      } catch (error) {
        console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
        process.exit(1);
      }
    });
}
