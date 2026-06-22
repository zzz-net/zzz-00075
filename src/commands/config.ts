import { Command } from 'commander';
import chalk from 'chalk';
import { FileStorage } from '../storage/FileStorage';
import { ValidationRule } from '../types';

export function registerConfigCommand(program: Command, storage: FileStorage): void {
  const config = program
    .command('config')
    .description('Manage validation rules configuration');

  config
    .command('show')
    .description('Show current configuration')
    .action(async () => {
      const state = storage.loadState();
      const ruleConfig = state.ruleConfig;

      console.log(chalk.blue('Rule Configuration'));
      console.log(chalk.gray(`Version: ${ruleConfig.version}`));
      console.log(chalk.gray(`Created: ${ruleConfig.createdAt}`));
      console.log(chalk.gray(`Updated: ${ruleConfig.updatedAt}`));
      console.log('');

      ruleConfig.rules.forEach(rule => {
        const status = rule.enabled ? chalk.green('✓') : chalk.red('✗');
        console.log(`${status} ${chalk.bold(rule.type)} (${rule.id})`);
        console.log(`  Enabled: ${rule.enabled}`);
        if (rule.config.minSize !== undefined) {
          console.log(`  Min size: ${rule.config.minSize} bytes`);
        }
        if (rule.config.maxSize !== undefined) {
          console.log(`  Max size: ${rule.config.maxSize} bytes`);
        }
        if (rule.config.allowedLicenses) {
          console.log(`  Allowed licenses: ${rule.config.allowedLicenses.join(', ')}`);
        }
        if (rule.config.requiredLicenseFile !== undefined) {
          console.log(`  Require license file: ${rule.config.requiredLicenseFile}`);
        }
        if (rule.config.hashAlgorithm) {
          console.log(`  Hash algorithm: ${rule.config.hashAlgorithm}`);
        }
        console.log('');
      });
    });

  config
    .command('set-size')
    .description('Set size validation rules')
    .option('--min <bytes>', 'Minimum file size in bytes', '0')
    .option('--max <bytes>', 'Maximum file size in bytes', `${1024 * 1024 * 1024}`)
    .option('--disable', 'Disable size validation')
    .action(async (options: any) => {
      let state = storage.loadState();
      const rules = [...state.ruleConfig.rules];
      
      let sizeRule = rules.find(r => r.type === 'size');
      if (!sizeRule) {
        sizeRule = {
          id: 'rule-size-1',
          type: 'size',
          enabled: true,
          config: {}
        };
        rules.push(sizeRule);
      }

      sizeRule.enabled = !options.disable;
      sizeRule.config = {
        ...sizeRule.config,
        minSize: parseInt(options.min),
        maxSize: parseInt(options.max)
      };

      state = storage.updateRuleConfig(state, rules);
      storage.saveState(state);

      console.log(chalk.green(`✓ Size rules updated. New rule version: ${state.ruleConfig.version}`));
      console.log(chalk.gray(`  Min: ${sizeRule.config.minSize} bytes`));
      console.log(chalk.gray(`  Max: ${sizeRule.config.maxSize} bytes`));
      console.log(chalk.gray(`  Enabled: ${sizeRule.enabled}`));
    });

  config
    .command('set-license')
    .description('Set license validation rules')
    .option('--allow <licenses...>', 'Allowed licenses', ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'CC0-1.0', 'CC-BY-4.0'])
    .option('--require-license-file', 'Require a license file')
    .option('--no-require-license-file', 'Do not require a license file')
    .option('--disable', 'Disable license validation')
    .action(async (options: any) => {
      let state = storage.loadState();
      const rules = [...state.ruleConfig.rules];
      
      let licenseRule = rules.find(r => r.type === 'license');
      if (!licenseRule) {
        licenseRule = {
          id: 'rule-license-1',
          type: 'license',
          enabled: true,
          config: {}
        };
        rules.push(licenseRule);
      }

      licenseRule.enabled = !options.disable;
      licenseRule.config = {
        ...licenseRule.config,
        allowedLicenses: options.allow,
        requiredLicenseFile: options.requireLicenseFile !== false
      };

      state = storage.updateRuleConfig(state, rules);
      storage.saveState(state);

      console.log(chalk.green(`✓ License rules updated. New rule version: ${state.ruleConfig.version}`));
      console.log(chalk.gray(`  Allowed: ${licenseRule.config.allowedLicenses?.join(', ')}`));
      console.log(chalk.gray(`  Require license file: ${licenseRule.config.requiredLicenseFile}`));
      console.log(chalk.gray(`  Enabled: ${licenseRule.enabled}`));
    });

  config
    .command('set-hash')
    .description('Set hash validation rules')
    .option('--algorithm <algo>', 'Hash algorithm (sha256 only)', 'sha256')
    .option('--disable', 'Disable hash validation')
    .action(async (options: any) => {
      let state = storage.loadState();
      const rules = [...state.ruleConfig.rules];
      
      let hashRule = rules.find(r => r.type === 'hash');
      if (!hashRule) {
        hashRule = {
          id: 'rule-hash-1',
          type: 'hash',
          enabled: true,
          config: {}
        };
        rules.push(hashRule);
      }

      hashRule.enabled = !options.disable;
      hashRule.config = {
        ...hashRule.config,
        hashAlgorithm: options.algorithm as 'sha256'
      };

      state = storage.updateRuleConfig(state, rules);
      storage.saveState(state);

      console.log(chalk.green(`✓ Hash rules updated. New rule version: ${state.ruleConfig.version}`));
      console.log(chalk.gray(`  Algorithm: ${hashRule.config.hashAlgorithm}`));
      console.log(chalk.gray(`  Enabled: ${hashRule.enabled}`));
    });

  config
    .command('reset')
    .description('Reset configuration to defaults')
    .action(async () => {
      let state = storage.loadState();
      const newVersion = `v${parseInt(state.ruleConfig.version.slice(1)) + 1}`;
      const now = new Date().toISOString();

      const defaultRules: ValidationRule[] = [
        {
          id: 'rule-hash-1',
          type: 'hash',
          enabled: true,
          config: { hashAlgorithm: 'sha256' }
        },
        {
          id: 'rule-size-1',
          type: 'size',
          enabled: true,
          config: { minSize: 0, maxSize: 1024 * 1024 * 1024 }
        },
        {
          id: 'rule-license-1',
          type: 'license',
          enabled: true,
          config: {
            allowedLicenses: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'CC0-1.0', 'CC-BY-4.0'],
            requiredLicenseFile: true
          }
        }
      ];

      state.ruleConfig = {
        version: newVersion,
        createdAt: state.ruleConfig.createdAt,
        updatedAt: now,
        rules: defaultRules
      };

      storage.saveState(state);
      console.log(chalk.green(`✓ Configuration reset to defaults. New rule version: ${newVersion}`));
    });
}
