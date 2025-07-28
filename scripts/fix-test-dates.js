#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Find all test files
const testFiles = glob.sync('test/**/*.e2e-spec.ts');

console.log(`Found ${testFiles.length} test files to process...`);

testFiles.forEach((filePath) => {
  console.log(`Processing: ${filePath}`);

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Check if TestDateUtils import already exists
  const hasImport = content.includes('TestDateUtils');

  // Add import if not present
  if (
    !hasImport &&
    (content.includes('2025-07-26') || content.includes('2025-07-27'))
  ) {
    // Find the last import statement
    const importLines = content.split('\n');
    let lastImportIndex = -1;

    for (let i = 0; i < importLines.length; i++) {
      if (
        importLines[i].startsWith('import ') &&
        !importLines[i].includes("from './")
      ) {
        lastImportIndex = i;
      }
    }

    if (lastImportIndex !== -1) {
      importLines.splice(
        lastImportIndex + 1,
        0,
        '',
        "import { TestDateUtils } from './utils/test-dates';",
      );
      content = importLines.join('\n');
      modified = true;
    }
  }

  // Replace hardcoded dates
  const replacements = [
    {
      from: /date: '2025-07-26'/g,
      to: 'date: TestDateUtils.getValidTestDate()',
    },
    {
      from: /date: '2025-07-27'/g,
      to: 'date: TestDateUtils.getValidTestDate()',
    },
    { from: /'2025-07-26'/g, to: 'TestDateUtils.getValidTestDate()' },
    { from: /'2025-07-27'/g, to: 'TestDateUtils.getValidTestDate()' },
    {
      from: /const date = '2025-07-26';/g,
      to: 'const date = TestDateUtils.getValidTestDate();',
    },
    {
      from: /const date = '2025-07-27';/g,
      to: 'const date = TestDateUtils.getValidTestDate();',
    },
  ];

  replacements.forEach(({ from, to }) => {
    if (from.test(content)) {
      content = content.replace(from, to);
      modified = true;
    }
  });

  if (modified) {
    fs.writeFileSync(filePath, content);
    console.log(`  ✅ Updated: ${filePath}`);
  } else {
    console.log(`  ⏭️  No changes needed: ${filePath}`);
  }
});

console.log('\n✅ All test files processed!');
