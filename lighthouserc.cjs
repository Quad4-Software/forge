// Lighthouse CI configuration for Quad4 Forge.
// Expects a running seeded instance at GITEA_URL (set by tests/e2e/lighthouse_test.go).
const base = (process.env.GITEA_URL || 'http://localhost:3003').replace(
  /\/$/,
  '',
);

const pages = [
  '/',
  '/explore/repos',
  '/explore/users',
  '/user/login',
  '/user2/repo1',
  '/user2/repo1/issues',
  '/user2/repo1/issues/1',
  '/user2/repo1/pulls',
  '/user2/repo1/commits/branch/master',
  '/user2',
];

module.exports = {
  ci: {
    collect: {
      url: pages.map((p) => `${base}${p}`),
      numberOfRuns: 1,
      settings: {
        chromeFlags: '--no-sandbox --disable-dev-shm-usage',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', {minScore: 0.5}],
        // Floor sits below the current measured scores (0.78 worst
        // page in CI, driven by the tracked upstream axe violations
        // in tests/e2e/pages-a11y-baseline.json). Raise this as those
        // violations get fixed.
        'categories:accessibility': ['error', {minScore: 0.75}],
        'categories:best-practices': ['warn', {minScore: 0.75}],
        'categories:seo': ['warn', {minScore: 0.5}],
      },
    },
    upload: {
      // Keep reports local. Do not send data to external storage.
      target: 'filesystem',
      outputDir: './tests/e2e/reports/lhci',
      reportFilenamePattern:
        '%%HOSTNAME%%-%%PATHNAME%%-%%DATETIME%%.report.%%EXTENSION%%',
    },
  },
};
