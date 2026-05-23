'use babel';

import path from 'path';
import { execFile } from 'child_process';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferKind(lineText) {
  const trimmed = lineText.trim();
  if (/^(public\s+|private\s+|protected\s+)?(abstract\s+|final\s+)?class\s+/.test(trimmed)) return 'class';
  if (/^(public\s+|private\s+|protected\s+)?interface\s+/.test(trimmed)) return 'interface';
  if (/^(public\s+|private\s+|protected\s+)?enum\s+/.test(trimmed)) return 'enum';
  if (/^(async\s+)?def\s+/.test(trimmed)) return 'function';
  if (/^function\s+/.test(trimmed)) return 'function';
  if (/\)\s*(throws\s+[\w.,\s]+)?[{;]?\s*$/.test(trimmed)) return 'method';
  return 'symbol';
}

function languageFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.java') return 'Java';
  if (ext === '.py') return 'Python';
  if (['.c', '.h'].includes(ext)) return 'C';
  if (['.cc', '.cpp', '.cxx', '.hpp', '.hh'].includes(ext)) return 'C++';
  if (['.js', '.jsx'].includes(ext)) return 'JavaScript';
  if (['.ts', '.tsx'].includes(ext)) return 'TypeScript';
  if (['.kt', '.kts'].includes(ext)) return 'Kotlin';
  if (ext === '.rs') return 'Rust';
  if (['.sh', '.bash', '.zsh'].includes(ext)) return 'Shell';
  if (['.html', '.htm'].includes(ext)) return 'HTML';
  if (['.css', '.less', '.scss', '.sass'].includes(ext)) return 'CSS';
  if (ext === '.go') return 'Go';
  if (ext === '.dart') return 'Dart';
  return null;
}

export default class SearchProvider {
  constructor(toolResolver) {
    this.toolResolver = toolResolver;
  }

  async findDefinitions(token, context) {
    const rg = this.toolResolver.getRg();
    if (!rg.available || !token || !context.projectRoot) return [];

    const pattern = this.buildDefinitionPattern(token);
    const args = [
      '--vimgrep',
      '--smart-case',
      '--no-heading',
      ...this.getExcludeGlobArgs(),
      '-e',
      pattern,
      context.projectRoot
    ];

    const stdout = await this.execRg(rg.path, args);
    return this.parseVimgrep(stdout, context.projectRoot, token);
  }

  buildDefinitionPattern(token) {
    const name = escapeRegExp(token);
    return [
      `\\b(class|interface|enum|struct)\\s+${name}\\b`,
      `\\b(data\\s+class|sealed\\s+class|object|companion\\s+object)\\s+${name}\\b`,
      `\\b(async\\s+def|def|function)\\s+${name}\\s*\\(`,
      `\\b(suspend\\s+)?fun\\s+(?:[\\w.<>]+\\.)?${name}\\s*\\(`,
      `\\b(fn|trait|struct|enum|impl|mod)\\s+${name}\\b`,
      `^\\s*(function\\s+)?${name}\\s*\\(\\)\\s*\\{`,
      `\\bfunc\\s+(?:\\([^)]*\\)\\s*)?${name}\\s*\\(`,
      `\\b(type|struct|interface)\\s+${name}\\b`,
      `\\b(id|class|name)\\s*=\\s*["'][^"']*\\b${name}\\b`,
      `\\.${name}\\b\\s*[,{]`,
      `#${name}\\b\\s*[,{]`,
      `\\b(class|enum|mixin|extension)\\s+${name}\\b`,
      `\\b(?:[\\w<>?]+\\s+)?${name}\\s*\\([^)]*\\)\\s*(?:async\\s*)?[{=>]`,
      `\\b${name}\\s*[:=]\\s*(function|async\\s*\\(|\\()`,
      `\\b[a-zA-Z_$][\\w$<>,\\[\\]\\s]*\\s+${name}\\s*\\(`
    ].join('|');
  }

  execRg(commandPath, args) {
    return new Promise((resolve) => {
      execFile(commandPath, args, { timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
        if (error && error.code !== 1) {
          resolve('');
          return;
        }

        resolve(stdout || '');
      });
    });
  }

  parseVimgrep(stdout, projectRoot, token) {
    const candidates = [];
    const lines = stdout.split(/\r?\n/).filter(Boolean).slice(0, atom.config.get('code-hopper.maxCandidates') || 50);

    for (const line of lines) {
      const match = line.match(/^(.+?):(\d+):(\d+):(.*)$/);
      if (!match) continue;

      const filePath = path.isAbsolute(match[1]) ? match[1] : path.join(projectRoot, match[1]);
      const lineNumber = Number(match[2]);
      const column = Math.max(Number(match[3]) - 1, 0);
      const lineText = match[4];
      const kind = inferKind(lineText);

      candidates.push({
        name: token,
        qualifiedName: token,
        kind,
        filePath,
        line: lineNumber,
        column,
        language: languageFromFile(filePath),
        scope: null,
        signature: this.signatureFromLine(token, lineText),
        source: 'rg',
        score: 0,
        lineText: lineText.trim()
      });
    }

    return candidates.map((candidate) => ({
      ...candidate,
      displayName: candidate.signature || candidate.name,
      detail: `${path.relative(projectRoot, candidate.filePath)}:${candidate.line} · ${candidate.kind}${candidate.language ? ` · ${candidate.language}` : ''}`
    }));
  }

  signatureFromLine(token, lineText) {
    const index = lineText.indexOf(token);
    if (index === -1) return null;

    const fragment = lineText.slice(Math.max(0, index - 40)).trim();
    const match = fragment.match(new RegExp(`(?:[\\w<>\\[\\],.?]+\\s+)*${escapeRegExp(token)}\\s*\\([^)]*\\)`));
    return match ? match[0] : null;
  }

  getExcludeGlobArgs() {
    const patterns = atom.config.get('code-hopper.excludePatterns') || [];
    return patterns.flatMap((pattern) => ['--glob', `!${pattern}/**`]);
  }
}
