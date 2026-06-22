import {
  CLIState,
  DatasetVersion,
  FileEntry,
  FileDiff,
  LicenseComparison,
  ConflictInfo,
  PublishPlanComparison,
  RuleConfig,
  DryRunAction,
  VersionStatus
} from '../types';

export class PublishPlanComparator {
  compare(
    action: DryRunAction,
    state: CLIState,
    draftVersion: DatasetVersion,
    ruleConfig: RuleConfig
  ): PublishPlanComparison {
    const currentPubId = state.currentVersion;
    const publishedVersion = currentPubId ? state.versions[currentPubId] : null;
    const hasPublishedVersion = !!publishedVersion;

    const fileDiffs = this.computeFileDiffs(
      publishedVersion?.files || [],
      draftVersion.files
    );

    const filesAdded = fileDiffs.filter(f => f.diffType === 'added').map(f => f.path);
    const filesDeleted = fileDiffs.filter(f => f.diffType === 'deleted').map(f => f.path);
    const filesModified = fileDiffs.filter(f => f.diffType === 'modified').map(f => f.path);
    const filesUnchanged = fileDiffs.filter(f => f.diffType === 'unchanged').map(f => f.path);

    const totalSizeDelta = fileDiffs.reduce((sum, f) => sum + f.sizeDelta, 0);

    const licenseComparison = this.compareLicenses(
      publishedVersion?.files || [],
      draftVersion.files,
      ruleConfig
    );

    const candidateVersionLabel = draftVersion.version;
    const nextAvailableVersionLabel = `v${Object.keys(state.versions).length + 1}.0.0`;

    const willReplaceCurrentPublished =
      action === 'publish' && hasPublishedVersion;

    const conflict = this.detectConflicts(
      state,
      draftVersion,
      publishedVersion,
      action
    );

    const blockingPoints = this.buildBlockingPoints(
      conflict,
      licenseComparison,
      fileDiffs,
      action
    );

    const suggestedNextSteps = this.buildSuggestedNextSteps(
      action,
      blockingPoints,
      conflict,
      hasPublishedVersion
    );

    return {
      draftVersionLabel: draftVersion.version,
      draftVersionId: draftVersion.id,
      draftStatus: draftVersion.status,
      publishedVersionLabel: publishedVersion?.version || null,
      publishedVersionId: publishedVersion?.id || null,
      publishedStatus: publishedVersion?.status || null,
      hasPublishedVersion,
      fileDiffs,
      filesAdded,
      filesDeleted,
      filesModified,
      filesUnchanged,
      addedFileCount: filesAdded.length,
      deletedFileCount: filesDeleted.length,
      modifiedFileCount: filesModified.length,
      unchangedFileCount: filesUnchanged.length,
      totalSizeDelta,
      licenseComparison,
      candidateVersionLabel,
      nextAvailableVersionLabel,
      willReplaceCurrentPublished,
      conflict,
      blockingPoints,
      suggestedNextSteps,
      comparisonGeneratedAt: new Date().toISOString(),
      ruleVersion: ruleConfig.version
    };
  }

  private computeFileDiffs(publishedFiles: FileEntry[], draftFiles: FileEntry[]): FileDiff[] {
    const diffs: FileDiff[] = [];
    const publishedMap = new Map(publishedFiles.map(f => [f.path, f]));
    const draftMap = new Map(draftFiles.map(f => [f.path, f]));

    for (const draftFile of draftFiles) {
      const publishedFile = publishedMap.get(draftFile.path);
      if (!publishedFile) {
        diffs.push({
          path: draftFile.path,
          diffType: 'added',
          sizeDelta: draftFile.size,
          newSize: draftFile.size,
          newSha256: draftFile.sha256,
          newLicense: draftFile.license,
          licenseChanged: false
        });
      } else {
        const shaChanged = draftFile.sha256 !== publishedFile.sha256;
        const sizeChanged = draftFile.size !== publishedFile.size;
        const licenseChanged = draftFile.license !== publishedFile.license;
        const isModified = shaChanged || sizeChanged || licenseChanged;

        diffs.push({
          path: draftFile.path,
          diffType: isModified ? 'modified' : 'unchanged',
          sizeDelta: draftFile.size - publishedFile.size,
          oldSize: publishedFile.size,
          newSize: draftFile.size,
          oldSha256: publishedFile.sha256,
          newSha256: draftFile.sha256,
          oldLicense: publishedFile.license,
          newLicense: draftFile.license,
          licenseChanged
        });
      }
    }

    for (const publishedFile of publishedFiles) {
      if (!draftMap.has(publishedFile.path)) {
        diffs.push({
          path: publishedFile.path,
          diffType: 'deleted',
          sizeDelta: -publishedFile.size,
          oldSize: publishedFile.size,
          oldSha256: publishedFile.sha256,
          oldLicense: publishedFile.license,
          licenseChanged: false
        });
      }
    }

    return diffs.sort((a, b) => a.path.localeCompare(b.path));
  }

  private compareLicenses(
    publishedFiles: FileEntry[],
    draftFiles: FileEntry[],
    ruleConfig: RuleConfig
  ): LicenseComparison {
    const extractLicenses = (files: FileEntry[]): string[] => {
      const set = new Set<string>();
      files.forEach(f => { if (f.license) set.add(f.license); });
      return Array.from(set).sort();
    };

    const hasLicenseFile = (files: FileEntry[]): boolean =>
      files.some(f =>
        f.path.toLowerCase().includes('license') ||
        f.path.toLowerCase().includes('licence')
      );

    const draftLicenses = extractLicenses(draftFiles);
    const publishedLicenses = extractLicenses(publishedFiles);

    const addedLicenses = draftLicenses.filter(l => !publishedLicenses.includes(l));
    const removedLicenses = publishedLicenses.filter(l => !draftLicenses.includes(l));
    const keptLicenses = draftLicenses.filter(l => publishedLicenses.includes(l));

    const licenseRule = ruleConfig.rules.find(r => r.type === 'license' && r.enabled);
    const allowedLicenses = licenseRule?.config.allowedLicenses || [];
    const violatingLicenses = draftLicenses.filter(l => !allowedLicenses.includes(l));

    return {
      draftLicenses,
      publishedLicenses,
      addedLicenses,
      removedLicenses,
      keptLicenses,
      allAllowed: violatingLicenses.length === 0,
      violatingLicenses,
      licenseFilePresentInDraft: hasLicenseFile(draftFiles),
      licenseFilePresentInPublished: hasLicenseFile(publishedFiles)
    };
  }

  private detectConflicts(
    state: CLIState,
    draftVersion: DatasetVersion,
    publishedVersion: DatasetVersion | null,
    action: DryRunAction
  ): ConflictInfo {
    const conflictReasons: string[] = [];
    const resolutionHints: string[] = [];
    const conflictingVersionIds: string[] = [];
    let conflictType: ConflictInfo['conflictType'] = null;

    const pendingVersions = Object.values(state.versions)
      .filter(v => v.status === 'pending_approval' && v.id !== draftVersion.id);

    if (pendingVersions.length > 0 && action === 'publish') {
      conflictType = 'multiple_pending';
      pendingVersions.forEach(v => {
        conflictingVersionIds.push(v.id);
        conflictReasons.push(
          `Another pending version exists: ${v.version} (${v.id.substring(0, 12)}...). ` +
          `Only one pending version can be published at a time.`
        );
      });
      resolutionHints.push(
        `Publish or reject the other pending version(s) first, or rollback to a clean state.`
      );
      resolutionHints.push(
        `Use \`dataset-cli status all --filter pending_approval\` to see all pending versions.`
      );
    }

    if (publishedVersion && action === 'publish') {
      if (publishedVersion.replacedBy && publishedVersion.replacedBy !== draftVersion.id) {
        const replacingVersion = state.versions[publishedVersion.replacedBy];
        if (replacingVersion && replacingVersion.status === 'published') {
          conflictType = 'replaced_version_stale';
          conflictingVersionIds.push(publishedVersion.id, replacingVersion.id);
          conflictReasons.push(
            `Current published version ${publishedVersion.version} was already replaced by ` +
            `${replacingVersion.version} (${replacingVersion.id.substring(0, 12)}...). ` +
            `You cannot publish on top of a stale "current" pointer.`
          );
          resolutionHints.push(
            `Use the latest published version (${replacingVersion.version}) as the baseline for comparison.`
          );
          resolutionHints.push(
            `Or use \`dataset-cli rollback\` to revert to ${publishedVersion.version} first, then try again.`
          );
        }
      }

      if (publishedVersion.ruleVersion !== state.ruleConfig.version) {
        const alreadyHasType = conflictType !== null;
        if (!alreadyHasType) {
          conflictType = 'rule_version_mismatch';
        }
        conflictingVersionIds.push(publishedVersion.id);
        conflictReasons.push(
          `Rule version mismatch: published version ${publishedVersion.version} uses ` +
          `${publishedVersion.ruleVersion}, but current config is ${state.ruleConfig.version}. ` +
          `Rules were changed since the last publication.`
        );
        resolutionHints.push(
          `Review the new rule configuration via \`dataset-cli config show\`.`
        );
        resolutionHints.push(
          `Re-scan the dataset with the updated rules via \`dataset-cli scan <directory>\` before submitting/publishing.`
        );
      }
    }

    const allVersions = Object.values(state.versions);
    for (const v of allVersions) {
      if (v.id !== draftVersion.id && v.version === draftVersion.version) {
        const alreadyHasType = conflictType !== null;
        if (!alreadyHasType) {
          conflictType = 'version_label_conflict';
        }
        conflictingVersionIds.push(v.id);
        conflictReasons.push(
          `Version label "${draftVersion.version}" is already used by ` +
          `${v.status} version (${v.id.substring(0, 12)}...). ` +
          `Version labels must be unique across all versions.`
        );
        resolutionHints.push(
          `Create a new scan to generate a fresh version label.`
        );
        break;
      }
    }

    if (draftVersion.ruleVersion !== state.ruleConfig.version) {
      const alreadyHasType = conflictType !== null;
      if (!alreadyHasType) {
        conflictType = 'rule_version_mismatch';
      }
      conflictingVersionIds.push(draftVersion.id);
      conflictReasons.push(
        `Draft version ${draftVersion.version} was created under rule version ` +
        `${draftVersion.ruleVersion}, but current config is ${state.ruleConfig.version}. ` +
        `Rules were changed since this draft was created.`
      );
      resolutionHints.push(
        `Review updated rules via \`dataset-cli config show\`.`
      );
      resolutionHints.push(
        `Re-scan the dataset to apply the latest rules: \`dataset-cli scan <directory>\`.`
      );
    }

    return {
      hasConflict: conflictReasons.length > 0,
      conflictType,
      conflictReasons,
      resolutionHints,
      conflictingVersionIds
    };
  }

  private buildBlockingPoints(
    conflict: ConflictInfo,
    licenseComp: LicenseComparison,
    fileDiffs: FileDiff[],
    action: DryRunAction
  ): string[] {
    const points: string[] = [];

    if (conflict.hasConflict) {
      conflict.conflictReasons.forEach(r => points.push(`[CONFLICT] ${r}`));
    }

    if (!licenseComp.allAllowed) {
      licenseComp.violatingLicenses.forEach(l => {
        points.push(`[LICENSE BLOCK] License "${l}" is not in the allowed list.`);
      });
    }

    const licenseRuleRequired = !licenseComp.licenseFilePresentInDraft;
    if (licenseRuleRequired) {
      points.push(`[LICENSE BLOCK] Required LICENSE file is missing in the draft version.`);
    }

    const modifiedCount = fileDiffs.filter(f => f.diffType === 'modified').length;
    const deletedCount = fileDiffs.filter(f => f.diffType === 'deleted').length;
    if (action === 'publish' && (modifiedCount > 0 || deletedCount > 0)) {
      if (modifiedCount > 0) {
        points.push(`[CHANGE NOTICE] ${modifiedCount} file(s) modified since last published version.`);
      }
      if (deletedCount > 0) {
        points.push(`[CHANGE NOTICE] ${deletedCount} file(s) deleted since last published version.`);
      }
    }

    return points;
  }

  private buildSuggestedNextSteps(
    action: DryRunAction,
    blockingPoints: string[],
    conflict: ConflictInfo,
    hasPublishedVersion: boolean
  ): string[] {
    const steps: string[] = [];

    if (conflict.hasConflict) {
      conflict.resolutionHints.forEach(h => steps.push(h));
      return steps;
    }

    const licenseBlocks = blockingPoints.filter(b => b.startsWith('[LICENSE BLOCK]'));
    if (licenseBlocks.length > 0) {
      steps.push('Fix the license violations: add the detected license(s) to the allowed list, or replace/remove the non-compliant files.');
      steps.push('Use `dataset-cli config set-license --allow <licenses>` to update the allowed licenses.');
      steps.push('Then re-scan via `dataset-cli scan <directory>` to pick up the updated configuration.');
      return steps;
    }

    if (action === 'submit') {
      if (hasPublishedVersion) {
        steps.push('Review the file diffs above carefully — additions, modifications, and deletions.');
      }
      steps.push('If everything looks good, run `dataset-cli submit` to move this version to pending_approval.');
    } else if (action === 'publish') {
      if (hasPublishedVersion) {
        steps.push('Review the file diffs and license changes above. Confirm the replacement of the current published version is intended.');
      }
      steps.push('Run `dataset-cli publish --approver <name>` to publish this version.');
      steps.push('After publishing, run `dataset-cli export --output <path>` to export the manifest.');
    }

    return steps;
  }
}
