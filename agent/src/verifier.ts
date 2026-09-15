export interface VerificationResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  error?: string;
}

export class SandboxVerifier {
  sandboxUrl: string;

  constructor(sandboxUrl = 'http://localhost:4000') {
    this.sandboxUrl = sandboxUrl;
  }

  async verifyCode(code: string, language: 'python' | 'javascript' = 'python'): Promise<VerificationResult> {
    console.log(`[Agent Verifier] Executing verification in Docker/gVisor sandbox (${language})...`);
    
    const response = await fetch(`${this.sandboxUrl}/execute-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        language,
        timeoutMs: 5000,
        allowNetwork: false,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Sandbox service returned HTTP ${response.status}: ${text}`);
    }

    const result = await response.json();
    const success = result.exitCode === 0 && !result.timedOut;

    console.log(`[Agent Verifier] Verification outcome: ${success ? 'PASSED (exit 0)' : 'FAILED'}`);
    if (result.stdout) console.log(`[Sandbox stdout]\n${result.stdout}`);
    if (result.stderr) console.error(`[Sandbox stderr]\n${result.stderr}`);

    return {
      success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: result.durationMs,
      error: result.error,
    };
  }
}
