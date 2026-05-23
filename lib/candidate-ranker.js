'use babel';

import path from 'path';

function normalize(filePath) {
  return path.normalize(filePath);
}

function extensionLanguage(filePath) {
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

export default class CandidateRanker {
  rank(candidates, context) {
    const deduped = this.dedupe(candidates);
    const ranked = deduped.map((candidate) => ({
      ...candidate,
      language: candidate.language || extensionLanguage(candidate.filePath),
      score: this.score(candidate, context)
    }));

    ranked.sort((left, right) => right.score - left.score || left.detail.localeCompare(right.detail));
    return ranked.slice(0, atom.config.get('code-hopper.maxCandidates') || 50);
  }

  dedupe(candidates) {
    const seen = new Map();

    for (const candidate of candidates) {
      const key = [
        normalize(candidate.filePath),
        candidate.line,
        candidate.name,
        candidate.kind
      ].join(':');

      const existing = seen.get(key);
      if (!existing || candidate.source === 'ctags') {
        seen.set(key, candidate);
      }
    }

    return Array.from(seen.values());
  }

  score(candidate, context) {
    let score = 0;

    if (candidate.source === 'ctags') score += 35;
    if (candidate.source === 'rg') score += 20;
    if (candidate.name === context.token) score += 20;
    if (candidate.language && candidate.language === context.language) score += 12;
    if (normalize(candidate.filePath) === normalize(context.filePath)) score += 20;
    if (path.dirname(candidate.filePath) === path.dirname(context.filePath)) score += 12;
    if (context.projectRoot && candidate.filePath.startsWith(context.projectRoot)) score += 8;
    if (candidate.kind === 'class' && /^[A-Z]/.test(context.token)) score += 10;
    if (candidate.kind === 'method' || candidate.kind === 'function') score += 4;

    const relative = context.projectRoot ? path.relative(context.projectRoot, candidate.filePath) : candidate.filePath;
    if (/(\b|\/)(target|build|out|dist|generated|gen|vendor|node_modules)(\/|$)/.test(relative)) score -= 30;
    if (!context.isTestFile && /(\b|\/)(test|spec)(\/|$)/i.test(relative)) score -= 6;

    if (context.packageName && relative.replace(/[\\/]/g, '.').includes(context.packageName)) score += 8;
    if (context.imports && context.imports.some((importPath) => candidate.filePath.replace(/[\\/]/g, '.').includes(importPath))) {
      score += 14;
    }

    return score;
  }
}
