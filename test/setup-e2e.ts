import { TestDateUtils } from './utils/test-date-utils';

// Make TestDateUtils available globally in e2e tests
declare global {
  const TestDateUtils: typeof import('./utils/test-date-utils').TestDateUtils;
}

(global as any).TestDateUtils = TestDateUtils;
