'use babel';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { spawn } from 'child_process';
import { Emitter } from 'atom';

const STATE = {
  IDLE: 'idle',
  INDEXING: 'indexing',
  READY: 'ready',
  DIRTY: 'dirty',
  FAILED: 'failed'
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hashProject(projectPath) {
  return crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 12);
}

function parseFields(fields) {
  const parsed = {
    kind: null,
    line: null,
    column: 0,
    scope: null,
    signature: null,
    language: null
  };

  for (const field of fields) {
    if (!field) continue;

    if (field.indexOf(':') === -1 && !parsed.kind) {
      parsed.kind = field;
      continue;
    }

    const separatorIndex = field.indexOf(':');
    const key = field.slice(0, separatorIndex);
    const value = field.slice(separatorIndex + 1);

    if (key === 'kind') parsed.kind = value;
    if (key === 'line') parsed.line = Number(value);
    if (key === 'column') parsed.column = Math.max(Number(value) - 1, 0);
    if (key === 'signature') parsed.signature = value;
    if (key === 'language') parsed.language = value;
    if (['class', 'struct', 'interface', 'enum', 'object', 'scope'].includes(key)) parsed.scope = value;
  }

  return parsed;
}

function parseLineFromExCommand(exCommand) {
  if (/^\d+$/.test(exCommand)) return Number(exCommand);
  return null;
}

function displayNameFor(candidate) {
  if (candidate.scope && candidate.signature) return `${candidate.scope}#${candidate.signature}`;
  if (candidate.scope) return `${candidate.scope}#${candidate.name}`;
  if (candidate.signature) return candidate.signature;
  return candidate.name;
}

export default class IndexManager {
  constructor(toolResolver) {
    this.toolResolver = toolResolver;
    this.projectStates = new Map();
    this.timers = new Set();
    this.runningProcesses = new Set();
    this.emitter = new Emitter();
  }

  start() {
    this.rebuildAll({ reason: 'startup' });

    const minutes = atom.config.get('code-hopper.refreshIntervalMinutes') || 5;
    const timer = setInterval(() => this.rebuildAll({ reason: 'interval' }), minutes * 60 * 1000);
    this.timers.add(timer);
  }

  dispose() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();

    for (const child of this.runningProcesses) child.kill();
    this.runningProcesses.clear();
    this.emitter.dispose();
  }

  onDidChangeState(callback) {
    return this.emitter.on('did-change-state', callback);
  }

  rebuildAll(options = {}) {
    const projectPaths = atom.project.getPaths();
    return Promise.all(projectPaths.map((projectPath) => this.rebuild(projectPath, options)));
  }

  async rebuild(projectPath, options = {}) {
    const ctags = this.toolResolver.getCtags();
    if (!ctags.available) {
      this.setState(projectPath, STATE.FAILED, { error: ctags.error || 'ctags is unavailable' });
      return null;
    }

    if (this.getProjectState(projectPath).state === STATE.INDEXING) return null;

    this.setState(projectPath, STATE.INDEXING, { reason: options.reason || 'manual' });

    const indexDir = this.getIndexDir(projectPath);
    ensureDir(indexDir);

    const tagsPath = path.join(indexDir, 'tags');
    const metadataPath = path.join(indexDir, 'metadata.json');
    const excludeArgs = this.getExcludePatterns().map((pattern) => `--exclude=${pattern}`);
    const sourceRoots = this.getSourceRoots(projectPath);

    const richArgs = [
      '-R',
      '-f',
      tagsPath,
      '--fields=+nKSt',
      '--extras=+q',
      ...excludeArgs,
      ...sourceRoots
    ];

    const basicArgs = [
      '-R',
      '-f',
      tagsPath,
      ...excludeArgs,
      ...sourceRoots
    ];

    try {
      await this.runCtags(ctags.path, richArgs, projectPath);
    } catch (error) {
      await this.runCtags(ctags.path, basicArgs, projectPath);
    }

    const symbolCount = this.countSymbols(tagsPath);
    const metadata = {
      projectPath,
      refreshedAt: new Date().toISOString(),
      ctagsVersion: ctags.version,
      symbolCount,
      sourceRoots,
      excludePatterns: this.getExcludePatterns(),
      reason: options.reason || 'manual'
    };

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    this.setState(projectPath, STATE.READY, { tagsPath, metadata });
    return metadata;
  }

  runCtags(commandPath, args, cwd) {
    return new Promise((resolve, reject) => {
      const child = spawn(commandPath, args, { cwd });
      let stderr = '';

      this.runningProcesses.add(child);

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        this.runningProcesses.delete(child);
        reject(error);
      });

      child.on('close', (code) => {
        this.runningProcesses.delete(child);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `ctags exited with code ${code}`));
        }
      });
    });
  }

  query(token, context) {
    const projectPath = context.projectRoot;
    const state = this.getProjectState(projectPath);
    const tagsPath = state.tagsPath || path.join(this.getIndexDir(projectPath), 'tags');

    if (!token || !fs.existsSync(tagsPath)) return [];

    const lines = fs.readFileSync(tagsPath, 'utf8').split(/\r?\n/);
    const candidates = [];

    for (const line of lines) {
      if (!line || line.startsWith('!_TAG_')) continue;

      const candidate = this.parseTagLine(line, projectPath);
      if (!candidate) continue;

      if (candidate.name === token || candidate.name.endsWith(`.${token}`)) {
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  listSymbols(projectPath) {
    const state = this.getProjectState(projectPath);
    const tagsPath = state.tagsPath || path.join(this.getIndexDir(projectPath), 'tags');

    if (!fs.existsSync(tagsPath)) return [];

    return fs.readFileSync(tagsPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('!_TAG_'))
      .map((line) => this.parseTagLine(line, projectPath))
      .filter(Boolean);
  }

  parseTagLine(line, projectPath) {
    const parts = line.split('\t');
    if (parts.length < 3) return null;

    const [name, tagPath, exCommand, ...fields] = parts;
    const parsedFields = parseFields(fields);
    const filePath = path.isAbsolute(tagPath) ? tagPath : path.join(projectPath, tagPath);
    const lineNumber = parsedFields.line || parseLineFromExCommand(exCommand) || 1;

    const candidate = {
      name: name.includes('.') ? name.split('.').pop() : name,
      qualifiedName: name,
      kind: parsedFields.kind || 'symbol',
      filePath,
      line: lineNumber,
      column: parsedFields.column || 0,
      language: parsedFields.language || null,
      scope: parsedFields.scope,
      signature: parsedFields.signature || null,
      source: 'ctags',
      score: 0
    };

    candidate.displayName = displayNameFor(candidate);
    candidate.detail = `${path.relative(projectPath, candidate.filePath)}:${candidate.line} · ${candidate.kind}${candidate.language ? ` · ${candidate.language}` : ''}`;
    return candidate;
  }

  getIndexDir(projectPath) {
    return path.join(this.getIndexBaseDir(), hashProject(projectPath));
  }

  getProjectState(projectPath) {
    return this.projectStates.get(projectPath) || { state: STATE.IDLE };
  }

  setState(projectPath, state, extra = {}) {
    const nextState = {
      ...this.getProjectState(projectPath),
      ...extra,
      state
    };

    this.projectStates.set(projectPath, nextState);
    this.emitter.emit('did-change-state', { projectPath, state: nextState });
  }

  getExcludePatterns() {
    return atom.config.get('code-hopper.excludePatterns') || [];
  }

  getSourceRoots(projectPath) {
    const configured = atom.config.get('code-hopper.sourceRoots') || [];
    const configuredRoots = configured
      .filter((root) => root && root.trim())
      .map((root) => root.trim())
      .filter((root) => fs.existsSync(path.isAbsolute(root) ? root : path.join(projectPath, root)));

    if (configuredRoots.length > 0) return configuredRoots;

    const languageRoots = [
      'src/main/java',
      'src/test/java',
      'src/main/kotlin',
      'src/test/kotlin'
    ].filter((root) => fs.existsSync(path.join(projectPath, root)));

    if (languageRoots.length > 0) return languageRoots;

    const broadRoots = [
      'src',
      'lib',
      'app',
      'packages',
      'cmd',
      'internal'
    ].filter((root) => fs.existsSync(path.join(projectPath, root)));

    return broadRoots.length > 0 ? broadRoots : ['.'];
  }

  countSymbols(tagsPath) {
    if (!fs.existsSync(tagsPath)) return 0;
    return fs.readFileSync(tagsPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('!_TAG_'))
      .length;
  }

  getIndexBaseDir() {
    const configured = atom.config.get('code-hopper.indexDirectory');
    if (configured && configured.trim()) {
      return configured.replace(/^~(?=$|\/|\\)/, os.homedir());
    }

    return path.join(atom.getConfigDirPath(), 'code-hopper', 'indexes');
  }
}
