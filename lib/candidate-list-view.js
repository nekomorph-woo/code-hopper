'use babel';

export default class CandidateListView {
  constructor() {
    this.element = document.createElement('div');
    this.element.classList.add('code-hopper');

    this.input = document.createElement('input');
    this.input.classList.add('code-hopper-filter', 'native-key-bindings');
    this.input.placeholder = 'Filter candidates';
    this.element.appendChild(this.input);

    this.list = document.createElement('ol');
    this.list.classList.add('code-hopper-candidates');
    this.element.appendChild(this.list);

    this.panel = atom.workspace.addModalPanel({
      item: this.element,
      visible: false
    });

    this.candidates = [];
    this.filteredCandidates = [];
    this.selectedIndex = 0;
    this.onConfirm = null;

    this.input.addEventListener('input', () => this.filter());
    this.input.addEventListener('keydown', (event) => this.handleKeydown(event));
  }

  show(candidates, onConfirm, options = {}) {
    this.candidates = candidates;
    this.filteredCandidates = candidates;
    this.selectedIndex = 0;
    this.onConfirm = onConfirm;
    this.input.value = '';
    this.input.placeholder = options.placeholder || 'Filter candidates';
    this.render();
    this.panel.show();
    this.input.focus();
  }

  hide() {
    this.panel.hide();
  }

  destroy() {
    this.panel.destroy();
    this.element.remove();
  }

  getElement() {
    return this.element;
  }

  filter() {
    const query = this.input.value.toLowerCase().trim();
    this.filteredCandidates = this.candidates.filter((candidate) => {
      const haystack = `${candidate.displayName} ${candidate.detail} ${candidate.lineText || ''}`.toLowerCase();
      return haystack.includes(query);
    });
    this.selectedIndex = 0;
    this.render();
  }

  handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.hide();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = Math.min(this.selectedIndex + 1, this.filteredCandidates.length - 1);
      this.render();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
      this.render();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.confirmSelected();
    }
  }

  confirmSelected() {
    const candidate = this.filteredCandidates[this.selectedIndex];
    if (!candidate) return;
    this.hide();
    this.onConfirm(candidate);
  }

  render() {
    this.list.textContent = '';

    if (this.filteredCandidates.length === 0) {
      const empty = document.createElement('li');
      empty.classList.add('code-hopper-empty');
      empty.textContent = 'No candidates';
      this.list.appendChild(empty);
      return;
    }

    const maxVisible = atom.config.get('code-hopper.maxCandidates') || 50;
    const startIndex = Math.max(0, this.selectedIndex - maxVisible + 1);
    const visibleCandidates = this.filteredCandidates.slice(startIndex, startIndex + maxVisible);

    visibleCandidates.forEach((candidate, visibleIndex) => {
      const index = startIndex + visibleIndex;
      const item = document.createElement('li');
      item.classList.add('code-hopper-candidate');
      if (index === this.selectedIndex) item.classList.add('selected');

      const title = document.createElement('div');
      title.classList.add('code-hopper-candidate-title');
      title.textContent = candidate.displayName || candidate.name;

      const detail = document.createElement('div');
      detail.classList.add('code-hopper-candidate-detail');
      detail.textContent = candidate.detail;

      item.appendChild(title);
      item.appendChild(detail);
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        this.selectedIndex = index;
        this.confirmSelected();
      });

      this.list.appendChild(item);
    });
  }
}
