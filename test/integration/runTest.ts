import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  const root = path.resolve(__dirname, '../../..');
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.resolve(__dirname, 'suite'),
    launchArgs: [path.join(root, 'samples'), '--disable-extensions'],
    version: process.env.VSCODE_TEST_VERSION ?? '1.85.2',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
