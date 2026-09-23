// Copyright 2026 The Forgejo Authors. All rights reserved.
// SPDX-License-Identifier: GPL-3.0-or-later

// Page-matrix accessibility regression gate.
//
// Whole-page axe scans against seeded fixture pages, compared against
// tests/e2e/pages-a11y-baseline.json. A test fails when a page gains a
// violation rule that is not in the baseline or when a known rule hits
// more nodes than recorded. Improvements (fewer violations) always pass
// and should be captured by regenerating the baseline:
//
//   UPDATE_A11Y_BASELINE=1 make test-e2e-sqlite#pages-a11y.test.e2e
//
// @watch start
// templates/**
// web_src/css/**
// @watch end

import {expect, type Page} from '@playwright/test';
import {AxeBuilder} from '@axe-core/playwright';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {test} from './utils_e2e.ts';

const BASELINE_PATH = 'tests/e2e/pages-a11y-baseline.json';
const UPDATE_BASELINE = process.env.UPDATE_A11Y_BASELINE === '1';

// Rules excluded globally, same rationale as shared/accessibility.ts plus
// rules dominated by upstream fomantic markup that is tracked separately.
const DISABLED_RULES = ['link-in-text-block'];

type RuleCount = Record<string, number>;
type Baseline = Record<string, RuleCount>;

const results: Record<
  string,
  {violations: RuleCount; nodes: Record<string, string[]>}
> = {};

function summarize(
  violations: {id: string; nodes: {target: unknown[]}[]}[],
) {
  const counts: RuleCount = {};
  const nodes: Record<string, string[]> = {};
  for (const v of violations) {
    counts[v.id] = v.nodes.length;
    nodes[v.id] = v.nodes.map((n) => n.target.join(' ')).slice(0, 3);
  }
  return {violations: counts, nodes};
}

async function scanPage(page: Page, key: string, url: string) {
  const response = await page.goto(url, {waitUntil: 'domcontentloaded'});
  expect(response?.status(), `expected 200 for ${url}`).toBe(200);
  await page.waitForLoadState('load');

  const scan = await new AxeBuilder({page})
    .disableRules(DISABLED_RULES)
    .analyze();
  results[key] = summarize(scan.violations as never[]);

  if (UPDATE_BASELINE) return;

  const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const expected = baseline[key] ?? {};
  const actual = results[key].violations;

  const problems: string[] = [];
  for (const [rule, count] of Object.entries(actual)) {
    if (!(rule in expected)) {
      problems.push(
        `new violation rule ${rule} (${count} nodes): ${results[key].nodes[rule]?.join(', ')}`,
      );
    } else if (count > expected[rule]) {
      problems.push(
        `rule ${rule} regressed: ${count} nodes > baseline ${expected[rule]}`,
      );
    }
  }
  expect(problems, `a11y regressions on ${url}`).toEqual([]);
}

const anonymousPages = [
  '/',
  '/explore/repos',
  '/explore/users',
  '/explore/organizations',
  '/user/login',
  '/user/sign_up',
  '/user2/repo1',
  '/user2/repo1/issues',
  '/user2/repo1/issues/1',
  '/user2/repo1/pulls',
  '/user2/repo1/commits/branch/master',
  '/user2/repo1/branches',
  '/user2/repo1/tags',
  '/user2',
];

const authenticatedPages = [
  '/',
  '/issues',
  '/pulls',
  '/notifications',
  '/user2/repo2',
  '/user2/repo1/settings',
  '/user/settings',
  '/user/settings/security',
  '/repo/create',
  '/org/create',
];

// Axe results differ across engines and viewports, pin the matrix to
// chromium so the baseline stays deterministic.
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'a11y matrix is pinned to chromium',
  );
});

test.describe('anonymous pages', () => {
  for (const url of anonymousPages) {
    test(`a11y: anon ${url}`, async ({page}) => {
      await scanPage(page, `anon ${url}`, url);
    });
  }
});

test.describe('authenticated pages', () => {
  test.use({user: 'user2'});

  for (const url of authenticatedPages) {
    test(`a11y: auth ${url}`, async ({page}) => {
      await scanPage(page, `auth ${url}`, url);
    });
  }
});

test.afterAll(() => {
  if (!UPDATE_BASELINE) return;
  const merged: Baseline = {};
  try {
    Object.assign(merged, JSON.parse(readFileSync(BASELINE_PATH, 'utf8')));
  } catch {}
  for (const [url, data] of Object.entries(results)) {
    merged[url] = data.violations;
  }
  mkdirSync(dirname(BASELINE_PATH), {recursive: true});
  writeFileSync(BASELINE_PATH, `${JSON.stringify(merged, null, 2)}\n`);
});
