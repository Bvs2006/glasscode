import assert from 'assert';
import { runSandbox } from '../dist/executor.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

console.log('=== Starting Test Suite: Phase 6 (Sandboxed Code Execution) ===\n');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-test-suite-'));
fs.chmodSync(testDir, 0o700);

try {
  // TEST 1: Normal execution
  console.log('[TEST 1] Testing normal Python execution in sandbox...');
  const script1 = path.join(testDir, 'test1.py');
  fs.writeFileSync(script1, 'print("SANDBOX_OK: 123 + 456 =", 123 + 456)', 'utf8');

  const res1 = await runSandbox({
    workingDir: testDir,
    command: 'python3 test1.py',
    image: 'python:3.11-alpine',
    timeoutMs: 5000,
  });

  assert.strictEqual(res1.exitCode, 0, 'Normal execution failed');
  assert.match(res1.stdout, /SANDBOX_OK: 123 \+ 456 = 579/, 'Stdout did not match');
  assert.strictEqual(res1.timedOut, false, 'Should not time out');
  console.log('✓ TEST 1 PASSED: Normal execution succeeded with correct stdout');

  // TEST 2: Network isolation (Blocked outbound network)
  console.log('\n[TEST 2] Testing network isolation (attempting outbound HTTP request)...');
  const script2 = path.join(testDir, 'test2.py');
  fs.writeFileSync(
    script2,
    `
import urllib.request
try:
    urllib.request.urlopen("http://8.8.8.8", timeout=2)
    print("NETWORK_SUCCESS")
except Exception as e:
    print("NETWORK_BLOCKED:", type(e).__name__)
`,
    'utf8'
  );

  const res2 = await runSandbox({
    workingDir: testDir,
    command: 'python3 test2.py',
    image: 'python:3.11-alpine',
    allowNetwork: false,
    timeoutMs: 5000,
  });

  assert.strictEqual(res2.exitCode, 0);
  assert.match(res2.stdout, /NETWORK_BLOCKED/, 'Network was not blocked');
  console.log('✓ TEST 2 PASSED: Outbound network call was blocked by network isolation');

  // TEST 3: Read-only Root Filesystem isolation
  console.log('\n[TEST 3] Testing read-only root filesystem isolation...');
  const script3 = path.join(testDir, 'test3.py');
  fs.writeFileSync(
    script3,
    `
try:
    with open("/etc/pwned.txt", "w") as f:
        f.write("malicious")
    print("WRITE_SUCCESS")
except OSError as e:
    print("WRITE_PREVENTED:", type(e).__name__, e)
`,
    'utf8'
  );

  const res3 = await runSandbox({
    workingDir: testDir,
    command: 'python3 test3.py',
    image: 'python:3.11-alpine',
    timeoutMs: 5000,
  });

  assert.strictEqual(res3.exitCode, 0);
  assert.match(res3.stdout, /WRITE_PREVENTED.*ReadOnlyFileSystemError|Read-only file system|PermissionError/i);
  console.log('✓ TEST 3 PASSED: Writing to container root filesystem was blocked (read-only mount)');

  // TEST 4: Hard Execution Timeout
  console.log('\n[TEST 4] Testing hard execution timeout enforcement...');
  const script4 = path.join(testDir, 'test4.py');
  fs.writeFileSync(script4, 'import time\nprint("Loop started")\nwhile True:\n    pass', 'utf8');

  const t0 = Date.now();
  const res4 = await runSandbox({
    workingDir: testDir,
    command: 'python3 test4.py',
    image: 'python:3.11-alpine',
    timeoutMs: 2000, // 2 second timeout
  });
  const elapsed = Date.now() - t0;

  assert.strictEqual(res4.timedOut, true, 'Long running script was not marked as timed out');
  assert(elapsed >= 1900 && elapsed <= 5000, `Timeout took unexpected duration: ${elapsed}ms`);
  console.log(`✓ TEST 4 PASSED: Infinite loop was terminated by hard timeout (${elapsed}ms)`);

  // TEST 5: No leaked containers
  console.log('\n[TEST 5] Verifying no containers leaked...');
  const activeContainers = execSync('docker ps --filter "name=sbx-" --format "{{.Names}}"', {
    encoding: 'utf8',
  }).trim();
  assert.strictEqual(activeContainers, '', 'Found leaked sandbox containers!');
  console.log('✓ TEST 5 PASSED: Container destroyed immediately, zero leaked containers');

  console.log('\n=== ALL PHASE 6 SANDBOX ACCEPTANCE TESTS PASSED! ===');
} finally {
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (e) {}
}
