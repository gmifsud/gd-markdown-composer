'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Generates / increments the build number for electron-builder so every
 * packaged installer and executable has a unique version (e.g. 1.0.0.1).
 *
 * - In CI, set BUILD_NUMBER or GITHUB_RUN_NUMBER to use the CI run number
 *   without modifying package.json on disk.
 * - Locally, computes the next buildNumber up front and persists it to
 *   package.json only after all artifacts finish building successfully.
 */
module.exports = function resolveBuildVersionConfig() {
  if (globalThis.__mdcBuildVersionConfig) {
    return globalThis.__mdcBuildVersionConfig;
  }

  const pkgPath = path.resolve(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const ciBuildNumber = process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER;
  const isCiOverride = Boolean(ciBuildNumber && String(ciBuildNumber).trim() !== '');
  const nextBuild = (Number(pkg.buildNumber) || 0) + 1;
  const buildNumber = isCiOverride ? String(ciBuildNumber).trim() : String(nextBuild);

  const baseVersion = String(pkg.version || '1.0.0');
  const buildVersion = `${baseVersion}.${buildNumber}`;

  console.log(`[build-version] Packaging version ${buildVersion} (build #${buildNumber})`);

  const config = {
    buildNumber,
    buildVersion,
    extraMetadata: {
      buildNumber,
    },
    ...(isCiOverride
      ? {}
      : {
        afterAllArtifactBuild: () => {
          const latestPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          latestPkg.buildNumber = nextBuild;
          fs.writeFileSync(pkgPath, JSON.stringify(latestPkg, null, 2) + '\n', 'utf8');
          return [];
        },
      }),
  };

  globalThis.__mdcBuildVersionConfig = config;
  return config;
};
