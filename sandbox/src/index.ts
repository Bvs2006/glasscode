import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runSandbox, checkGVisorSupported, type SandboxOptions } from './executor.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'sandbox-execution-service',
    gVisorSupported: checkGVisorSupported(),
    timestamp: new Date().toISOString(),
  });
});

// Execute command in existing working directory
app.post('/execute', async (req, res) => {
  try {
    const { workingDir, command, image, timeoutMs, allowNetwork, cpuLimit, memoryLimit } = req.body;

    if (!workingDir || !command) {
      return res.status(400).json({ error: 'workingDir and command are required.' });
    }

    if (!fs.existsSync(workingDir)) {
      return res.status(400).json({ error: `Directory does not exist: ${workingDir}` });
    }

    const result = await runSandbox({
      workingDir,
      command,
      image,
      timeoutMs,
      allowNetwork,
      cpuLimit,
      memoryLimit,
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Execute code snippet in an isolated ephemeral directory
app.post('/execute-code', async (req, res) => {
  let tempDir: string | null = null;
  try {
    const { code, language = 'python', timeoutMs = 5000, allowNetwork = false } = req.body;

    if (code === undefined || code === null) {
      return res.status(400).json({ error: 'code is required.' });
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glasscode-sbx-'));

    let fileName = 'script.py';
    let command = 'python3 script.py';
    let image = 'python:3.11-alpine';

    if (language === 'javascript' || language === 'node') {
      fileName = 'script.js';
      command = 'node script.js';
      image = 'node:20-alpine';
    } else if (language === 'bash' || language === 'sh') {
      fileName = 'script.sh';
      command = 'sh script.sh';
      image = 'alpine:latest';
    }

    fs.writeFileSync(path.join(tempDir, fileName), code, 'utf8');

    const result = await runSandbox({
      workingDir: tempDir,
      command,
      image,
      timeoutMs,
      allowNetwork,
    });

    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (e) {}
    }
  }
});

app.listen(PORT, () => {
  console.log(`[Sandbox] Execution service running on http://localhost:${PORT}`);
  checkGVisorSupported();
});
