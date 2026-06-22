import * as fs from 'fs';
import * as path from 'path';
import { FileEntry, ScanOptions } from '../types';
import { computeFileSha256 } from './hash';

function matchPattern(filePath: string, patterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return patterns.some(pattern => {
    if (pattern === '**/*') {
      return true;
    }
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`).test(normalizedPath);
  });
}

export function scanDirectory(
  dirPath: string,
  options: ScanOptions = {}
): FileEntry[] {
  const {
    includePatterns = ['**/*'],
    excludePatterns = ['**/node_modules/**', '**/.git/**', '**/.dataset/**'],
    computeHash = true
  } = options;

  const absoluteDir = path.resolve(dirPath);
  
  if (!fs.existsSync(absoluteDir)) {
    throw new Error(`Directory not found: ${absoluteDir}`);
  }

  if (!fs.statSync(absoluteDir).isDirectory()) {
    throw new Error(`Not a directory: ${absoluteDir}`);
  }

  const results: FileEntry[] = [];

  function walk(currentPath: string, baseDir: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!matchPattern(relativePath + '/', excludePatterns)) {
          walk(fullPath, baseDir);
        }
      } else if (entry.isFile()) {
        const shouldInclude = matchPattern(relativePath, includePatterns);
        const shouldExclude = matchPattern(relativePath, excludePatterns);

        if (shouldInclude && !shouldExclude) {
          const stats = fs.statSync(fullPath);
          const fileEntry: FileEntry = {
            path: relativePath,
            size: stats.size,
            sha256: computeHash ? computeFileSha256(fullPath) : ''
          };

          if (relativePath.toLowerCase().includes('license') || 
              relativePath.toLowerCase().includes('licence')) {
            const licenseContent = fs.readFileSync(fullPath, 'utf8');
            fileEntry.license = detectLicense(licenseContent);
          }

          results.push(fileEntry);
        }
      }
    }
  }

  walk(absoluteDir, absoluteDir);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

function detectLicense(content: string): string {
  const lowerContent = content.toLowerCase();
  
  if (lowerContent.includes('mit license')) return 'MIT';
  if (lowerContent.includes('apache license') && lowerContent.includes('2.0')) return 'Apache-2.0';
  if (lowerContent.includes('gnu general public license') && lowerContent.includes('version 3')) return 'GPL-3.0';
  if (lowerContent.includes('gnu lesser general public license')) return 'LGPL-3.0';
  if (lowerContent.includes('bsd 2-clause')) return 'BSD-2-Clause';
  if (lowerContent.includes('bsd 3-clause')) return 'BSD-3-Clause';
  if (lowerContent.includes('mozilla public license')) return 'MPL-2.0';
  if (lowerContent.includes('creative commons') && lowerContent.includes('zero')) return 'CC0-1.0';
  if (lowerContent.includes('creative commons') && lowerContent.includes('attribution') && lowerContent.includes('4.0')) return 'CC-BY-4.0';
  
  return 'UNKNOWN';
}

export function verifyFilesExist(
  dirPath: string,
  files: FileEntry[]
): { valid: boolean; missingFiles: string[] } {
  const absoluteDir = path.resolve(dirPath);
  const missingFiles: string[] = [];

  for (const file of files) {
    const fullPath = path.join(absoluteDir, file.path);
    if (!fs.existsSync(fullPath)) {
      missingFiles.push(file.path);
    }
  }

  return {
    valid: missingFiles.length === 0,
    missingFiles
  };
}
