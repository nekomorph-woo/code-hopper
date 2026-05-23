'use babel';

import path from 'path';
import { CompositeDisposable, Point } from 'atom';
import ToolResolver from './tool-resolver';
import IndexManager from './index-manager';
import SearchProvider from './search-provider';
import CandidateRanker from './candidate-ranker';
import CandidateListView from './candidate-list-view';
import JumpHistory from './jump-history';

function languageFromFile(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
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

function tokenAtLineColumn(lineText, column) {
  const tokenPattern = /[A-Za-z_$][\w$]*/g;
  let match;

  while ((match = tokenPattern.exec(lineText))) {
    const start = match.index;
    const end = start + match[0].length;
    if (column >= start && column <= end) return match[0];
  }

  return null;
}

function parseJavaContext(text) {
  const packageMatch = text.match(/^\s*package\s+([\w.]+)\s*;/m);
  const imports = [];
  const importPattern = /^\s*import\s+(?:static\s+)?([\w.*]+)\s*;/gm;
  let match;

  while ((match = importPattern.exec(text))) {
    imports.push(match[1].replace(/\.\*$/, ''));
  }

  return {
    packageName: packageMatch ? packageMatch[1] : null,
    imports
  };
}

function parsePythonContext(text) {
  const imports = [];
  const importPattern = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
  let match;

  while ((match = importPattern.exec(text))) {
    imports.push(match[1] || match[2]);
  }

  return {
    packageName: null,
    imports
  };
}

export default {
  config: {
    ctagsPath: {
      type: 'string',
      default: 'ctags',
      description: 'Path to the ctags executable.'
    },
    rgPath: {
      type: 'string',
      default: 'rg',
      description: 'Path to the ripgrep executable.'
    },
    refreshIntervalMinutes: {
      type: 'integer',
      default: 5,
      minimum: 1,
      description: 'How often Code Hopper refreshes its ctags index.'
    },
    indexDirectory: {
      type: 'string',
      default: '',
      description: 'Directory used to store generated ctags index files. Leave empty to use the default Pulsar user config directory.'
    },
    excludePatterns: {
      type: 'array',
      default: [
        '.git',
        '.gradle',
        '.idea',
        '.settings',
        'target',
        'build',
        'out',
        'dist',
        'coverage',
        'node_modules',
        'vendor',
        '.venv',
        'venv',
        '__pycache__',
        'generated',
        'gen'
      ],
      items: { type: 'string' },
      description: 'Directories excluded from symbol indexing and fallback search.'
    },
    directJumpThreshold: {
      type: 'integer',
      default: 85,
      minimum: 1,
      maximum: 100,
      description: 'Minimum score required for a single candidate to jump directly.'
    },
    maxCandidates: {
      type: 'integer',
      default: 50,
      minimum: 1,
      maximum: 500,
      description: 'Maximum candidates shown in the jump list.'
    }
  },

  subscriptions: null,
  editorSubscriptions: null,
  toolResolver: null,
  indexManager: null,
  searchProvider: null,
  candidateRanker: null,
  candidateListView: null,
  jumpHistory: null,
  statusBarTile: null,
  statusBarElement: null,
  statusState: 'idle',

  activate(state = {}) {
    this.subscriptions = new CompositeDisposable();
    this.editorSubscriptions = new CompositeDisposable();
    this.toolResolver = new ToolResolver();
    this.indexManager = new IndexManager(this.toolResolver);
    this.searchProvider = new SearchProvider(this.toolResolver);
    this.candidateRanker = new CandidateRanker();
    this.candidateListView = new CandidateListView();
    this.jumpHistory = new JumpHistory();
    this.jumpHistory.deserialize(state.jumpHistory);
    this.statusState = 'Starting';

    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'code-hopper:jump-to-symbol': () => this.jumpToSymbol(),
      'code-hopper:jump-back': () => this.jumpHistory.jumpBack(),
      'code-hopper:refresh-index': () => this.refreshIndex()
    }));

    this.subscriptions.add(atom.workspace.observeTextEditors((editor) => this.observeEditor(editor)));
    this.subscriptions.add(this.indexManager.onDidChangeState(() => this.updateStatusBar()));
    this.updateStatusBar();

    this.toolResolver.resolveAll().then(({ ctags, rg }) => {
      if (!ctags.available && !rg.available) {
        this.statusState = 'Failed';
        this.updateStatusBar();
        atom.notifications.addWarning('Code Hopper could not find ctags or rg.', {
          detail: 'Configure code-hopper.ctagsPath or code-hopper.rgPath in Pulsar settings.'
        });
        return;
      }

      if (ctags.available) {
        this.statusState = 'Ready';
        this.updateStatusBar();
        this.indexManager.start();
      } else {
        this.statusState = 'Rg fallback';
        this.updateStatusBar();
        atom.notifications.addInfo('Code Hopper is running in rg fallback mode.', {
          detail: 'Install Universal Ctags for faster symbol indexing.'
        });
      }
    });
  },

  deactivate() {
    if (this.subscriptions) this.subscriptions.dispose();
    if (this.editorSubscriptions) this.editorSubscriptions.dispose();
    if (this.indexManager) this.indexManager.dispose();
    if (this.candidateListView) this.candidateListView.destroy();
    if (this.statusBarTile) this.statusBarTile.destroy();
    this.statusBarTile = null;
    this.statusBarElement = null;
  },

  serialize() {
    return {
      jumpHistory: this.jumpHistory ? this.jumpHistory.serialize() : {}
    };
  },

  observeEditor(editor) {
    const editorElement = atom.views.getView(editor);
    if (!editorElement) return;

    const handler = (event) => {
      if (!event.altKey || event.button !== 0) return;
      if (editor.isMini && editor.isMini()) return;

      const bufferPosition = this.bufferPositionForMouseEvent(editor, editorElement, event);
      if (!bufferPosition) return;

      event.preventDefault();
      event.stopPropagation();
      this.jumpToSymbol(editor, bufferPosition);
    };

    editorElement.addEventListener('mousedown', handler, true);
    this.editorSubscriptions.add({
      dispose() {
        editorElement.removeEventListener('mousedown', handler, true);
      }
    });
  },

  bufferPositionForMouseEvent(editor, editorElement, event) {
    const component = editorElement.component;

    if (component && component.screenPositionForMouseEvent) {
      return editor.bufferPositionForScreenPosition(component.screenPositionForMouseEvent(event));
    }

    if (component && component.pixelPositionForMouseEvent && component.screenPositionForPixelPosition) {
      const pixelPosition = component.pixelPositionForMouseEvent(event);
      return editor.bufferPositionForScreenPosition(component.screenPositionForPixelPosition(pixelPosition));
    }

    if (editorElement.screenPositionForMouseEvent) {
      return editor.bufferPositionForScreenPosition(editorElement.screenPositionForMouseEvent(event));
    }

    const lineElement = event.target && event.target.closest && event.target.closest('.line');
    if (lineElement) {
      const screenRow = Number(lineElement.dataset.screenRow || lineElement.getAttribute('data-screen-row'));
      if (!Number.isNaN(screenRow)) {
        const lineRect = lineElement.getBoundingClientRect();
        const defaultCharWidth = editor.getDefaultCharWidth ? editor.getDefaultCharWidth() : 8;
        const column = Math.max(Math.floor((event.clientX - lineRect.left) / defaultCharWidth), 0);
        return editor.bufferPositionForScreenPosition(new Point(screenRow, column));
      }
    }

    const scrollView = editorElement.querySelector && (editorElement.querySelector('.scroll-view') || editorElement);
    const rect = scrollView.getBoundingClientRect();
    const lineHeight = editor.getLineHeightInPixels ? editor.getLineHeightInPixels() : 16;
    const defaultCharWidth = editor.getDefaultCharWidth ? editor.getDefaultCharWidth() : 8;
    const firstVisibleRow = editor.getFirstVisibleScreenRow ? editor.getFirstVisibleScreenRow() : 0;
    const row = firstVisibleRow + Math.max(Math.floor((event.clientY - rect.top) / lineHeight), 0);
    const column = Math.max(Math.floor((event.clientX - rect.left) / defaultCharWidth), 0);
    return editor.bufferPositionForScreenPosition(new Point(row, column));
  },

  async refreshIndex() {
    this.statusState = 'Indexing...';
    this.updateStatusBar();
    await this.toolResolver.resolveAll();

    if (!this.toolResolver.getCtags().available) {
      this.statusState = 'Failed';
      this.updateStatusBar();
      atom.notifications.addWarning('Code Hopper cannot refresh the index because ctags is unavailable.');
      return;
    }

    await this.indexManager.rebuildAll({ reason: 'manual' });
    this.statusState = 'Ready';
    this.updateStatusBar();
    atom.notifications.addSuccess('Code Hopper index refreshed.');
  },

  consumeStatusBar(statusBar) {
    this.statusBarElement = document.createElement('button');
    this.statusBarElement.classList.add('code-hopper-status', 'inline-block');
    this.statusBarElement.type = 'button';
    this.statusBarElement.addEventListener('click', () => this.refreshIndex());

    this.statusBarTile = statusBar.addRightTile({
      item: this.statusBarElement,
      priority: 100
    });

    this.updateStatusBar();

    return new CompositeDisposable({
      dispose: () => {
        if (this.statusBarTile) this.statusBarTile.destroy();
        this.statusBarTile = null;
        this.statusBarElement = null;
      }
    });
  },

  updateStatusBar() {
    if (!this.statusBarElement) return;

    const projectPaths = atom.project.getPaths();
    const activeState = projectPaths
      .map((projectPath) => this.indexManager && this.indexManager.getProjectState(projectPath))
      .find((state) => state && state.state && state.state !== 'idle');
    const metadata = activeState && activeState.metadata;
    const state = activeState && activeState.state
      ? activeState.state.charAt(0).toUpperCase() + activeState.state.slice(1)
      : this.statusState;

    this.statusBarElement.textContent = `Code Hopper: ${state}`;
    this.statusBarElement.title = metadata
      ? `Refresh Code Hopper index\nSymbols: ${metadata.symbolCount}\nUpdated: ${metadata.refreshedAt}\nIndex: ${this.indexManager.getIndexBaseDir()}`
      : `Refresh Code Hopper index\nIndex: ${this.indexManager.getIndexBaseDir()}`;
  },

  async jumpToSymbol(editor = atom.workspace.getActiveTextEditor(), bufferPosition = null) {
    const context = this.buildJumpContext(editor, bufferPosition);
    if (!context || !context.token) {
      atom.notifications.addInfo('Code Hopper: no symbol under cursor.');
      return;
    }

    const candidates = await this.findCandidates(context);
    if (candidates.length === 0) {
      atom.notifications.addInfo(`Code Hopper: no candidates for "${context.token}".`);
      return;
    }

    if (this.shouldDirectJump(candidates)) {
      await this.openCandidate(candidates[0]);
      return;
    }

    this.candidateListView.show(candidates, (candidate) => this.openCandidate(candidate));
  },

  async findCandidates(context) {
    const indexedCandidates = this.indexManager.query(context.token, context);
    const fallbackCandidates = indexedCandidates.length === 0
      ? await this.searchProvider.findDefinitions(context.token, context)
      : [];

    return this.candidateRanker.rank([...indexedCandidates, ...fallbackCandidates], context);
  },

  shouldDirectJump(candidates) {
    if (candidates.length !== 1) return false;
    return candidates[0].score >= atom.config.get('code-hopper.directJumpThreshold');
  },

  async openCandidate(candidate) {
    this.jumpHistory.recordCurrentLocation();

    const row = Math.max(candidate.line - 1, 0);
    const column = Math.max(candidate.column || 0, 0);
    const targetPosition = new Point(row, column);
    const existing = this.findOpenEditor(candidate.filePath);

    if (existing) {
      existing.pane.activateItem(existing.editor);
      existing.editor.setCursorBufferPosition(targetPosition);
      existing.editor.scrollToBufferPosition(targetPosition, { center: true });
      return;
    }

    await atom.workspace.open(candidate.filePath, {
      initialLine: row,
      initialColumn: column,
      searchAllPanes: false,
      pending: false
    });
  },

  findOpenEditor(filePath) {
    const targetPath = path.normalize(filePath);

    for (const pane of atom.workspace.getPanes()) {
      for (const item of pane.getItems()) {
        if (!item || !item.getPath) continue;
        if (path.normalize(item.getPath()) === targetPath) {
          return { pane, editor: item };
        }
      }
    }

    return null;
  },

  buildJumpContext(editor, bufferPosition = null) {
    if (!editor || !editor.getPath()) return null;

    const filePath = editor.getPath();
    const position = bufferPosition || editor.getCursorBufferPosition();
    const lineText = editor.lineTextForBufferRow(position.row);
    const token = tokenAtLineColumn(lineText, position.column);
    const text = editor.getText();
    const language = languageFromFile(filePath);
    const projectRoot = this.projectRootForPath(filePath);
    const languageContext = language === 'Java'
      ? parseJavaContext(text)
      : language === 'Python'
        ? parsePythonContext(text)
        : { packageName: null, imports: [] };

    return {
      token,
      filePath,
      projectRoot,
      language,
      row: position.row,
      column: position.column,
      packageName: languageContext.packageName,
      imports: languageContext.imports,
      isTestFile: /(\b|\/)(test|spec)(\/|$)/i.test(filePath)
    };
  },

  projectRootForPath(filePath) {
    const projectPaths = atom.project.getPaths();
    const normalizedFilePath = path.normalize(filePath);

    return projectPaths.find((projectPath) => {
      const normalizedProjectPath = path.normalize(projectPath);
      return normalizedFilePath === normalizedProjectPath || normalizedFilePath.startsWith(`${normalizedProjectPath}${path.sep}`);
    }) || path.dirname(filePath);
  }
};
