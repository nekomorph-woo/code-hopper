'use babel';

export default class JumpHistory {
  constructor() {
    this.stack = [];
  }

  recordCurrentLocation() {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor || !editor.getPath()) return;

    this.stack.push({
      filePath: editor.getPath(),
      cursorPosition: editor.getCursorBufferPosition(),
      scrollTop: editor.getScrollTop ? editor.getScrollTop() : null
    });
  }

  async jumpBack() {
    const previous = this.stack.pop();
    if (!previous) {
      atom.notifications.addInfo('Code Hopper: no jump history yet.');
      return;
    }

    const editor = await atom.workspace.open(previous.filePath, {
      initialLine: previous.cursorPosition.row,
      initialColumn: previous.cursorPosition.column,
      searchAllPanes: true,
      pending: false
    });

    if (previous.scrollTop != null && editor.setScrollTop) {
      editor.setScrollTop(previous.scrollTop);
    }
  }

  serialize() {
    return {
      stack: this.stack
    };
  }

  deserialize(state = {}) {
    this.stack = state.stack || [];
  }
}
