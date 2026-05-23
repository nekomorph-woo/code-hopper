'use babel';

import { execFile } from 'child_process';
import fs from 'fs';

const UNIVERSAL_CTAGS_PATHS = [
  '/opt/homebrew/bin/ctags',
  '/usr/local/bin/ctags',
  '/opt/homebrew/opt/universal-ctags/bin/ctags',
  '/usr/local/opt/universal-ctags/bin/ctags'
];

function execVersion(commandPath) {
  return new Promise((resolve) => {
    execFile(commandPath, ['--version'], { timeout: 3000 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          available: false,
          path: commandPath,
          version: null,
          error: (stderr || error.message || '').trim()
        });
        return;
      }

      resolve({
        available: true,
        path: commandPath,
        version: (stdout || stderr || '').split(/\r?\n/)[0].trim(),
        error: null
      });
    });
  });
}

export default class ToolResolver {
  constructor(configReader = atom.config.get.bind(atom.config)) {
    this.configReader = configReader;
    this.ctags = { available: false, path: 'ctags', version: null, error: null };
    this.rg = { available: false, path: 'rg', version: null, error: null };
  }

  async resolveAll() {
    const ctagsPath = this.configReader('code-hopper.ctagsPath') || 'ctags';
    const rgPath = this.configReader('code-hopper.rgPath') || 'rg';

    const [ctags, rg] = await Promise.all([
      this.resolveCtags(ctagsPath),
      execVersion(rgPath)
    ]);

    this.ctags = ctags;
    this.rg = rg;
    return { ctags, rg };
  }

  async resolveCtags(ctagsPath) {
    const configured = await execVersion(ctagsPath);
    if (configured.available) return configured;

    if (ctagsPath !== 'ctags') return configured;

    for (const candidatePath of UNIVERSAL_CTAGS_PATHS) {
      if (!fs.existsSync(candidatePath)) continue;

      const candidate = await execVersion(candidatePath);
      if (candidate.available && /Universal Ctags/i.test(candidate.version || '')) {
        return candidate;
      }
    }

    return configured;
  }

  getCtags() {
    return this.ctags;
  }

  getRg() {
    return this.rg;
  }
}
