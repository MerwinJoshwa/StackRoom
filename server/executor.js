const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const TIMEOUT_MS = 10000;
const MAX_OUTPUT = 50000;

/**
 * Execute code in a sandboxed subprocess.
 * Returns { stdout, stderr, exitCode, language, executedAt }
 */
async function execCode(language, code) {
  const lang = language.toLowerCase();
  const id = uuidv4();
  const tmpDir = path.join(os.tmpdir(), `stackroom_${id}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const executedAt = new Date().toISOString();

  try {
    let result;
    switch (lang) {
      case 'javascript':
      case 'js':
      case 'nodejs':
        result = await runProcess('node', ['-e', code], tmpDir);
        break;

      case 'python':
      case 'python3':
        result = await runFile(tmpDir, 'main.py', code, 'python3', []);
        break;

      case 'java': {
        // Extract class name
        const match = code.match(/public\s+class\s+(\w+)/);
        const className = match ? match[1] : 'Main';
        const javaFile = path.join(tmpDir, `${className}.java`);
        fs.writeFileSync(javaFile, code);
        // Compile
        const compileResult = await runProcess('javac', [javaFile], tmpDir);
        if (compileResult.exitCode !== 0) {
          result = compileResult;
          break;
        }
        result = await runProcess('java', ['-cp', tmpDir, className], tmpDir);
        break;
      }

      case 'c':
      case 'cpp':
      case 'c++': {
        const ext = lang === 'c' ? '.c' : '.cpp';
        const compiler = lang === 'c' ? 'gcc' : 'g++';
        const srcFile = path.join(tmpDir, `main${ext}`);
        const outFile = path.join(tmpDir, 'a.out');
        fs.writeFileSync(srcFile, code);
        const compileResult = await runProcess(compiler, [srcFile, '-o', outFile], tmpDir);
        if (compileResult.exitCode !== 0) {
          result = compileResult;
          break;
        }
        result = await runProcess(outFile, [], tmpDir);
        break;
      }

      case 'bash':
      case 'sh':
        result = await runFile(tmpDir, 'run.sh', code, 'bash', []);
        break;

      default:
        // Fallback: try node
        result = await runProcess('node', ['-e', code], tmpDir);
    }

    return {
      ...result,
      language: lang,
      executedAt
    };
  } finally {
    // Cleanup temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}

function runFile(dir, filename, code, cmd, args) {
  const file = path.join(dir, filename);
  fs.writeFileSync(file, code);
  return runProcess(cmd, [...args, file], dir);
}

function runProcess(cmd, args, cwd) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    let proc;
    try {
      proc = spawn(cmd, args, {
        cwd,
        timeout: TIMEOUT_MS,
        env: {
          ...process.env,
          NODE_PATH: undefined,
          // Restrict dangerous env vars
          HOME: cwd,
        }
      });
    } catch (err) {
      return resolve({ stdout: '', stderr: err.message, exitCode: 1 });
    }

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT) {
        killed = true;
        proc.kill('SIGKILL');
      }
    });

    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (killed && stdout.length > MAX_OUTPUT) {
        stderr += '\n[Output truncated - exceeded limit]';
      }
      if (killed && stdout.length <= MAX_OUTPUT) {
        stderr += '\n[Process timed out after 10s]';
      }
      resolve({
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, 5000),
        exitCode: code ?? 1
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + '\n' + err.message,
        exitCode: 1
      });
    });
  });
}

module.exports = { execCode };
