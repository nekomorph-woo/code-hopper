'use babel';

import CodeHopper from '../lib/code-hopper';

// Use the command `window:run-package-specs` (cmd-alt-ctrl-p) to run specs.
//
// To run a specific `it` or `describe` block add an `f` to the front (e.g. `fit`
// or `fdescribe`). Remove the `f` to unfocus the block.

describe('CodeHopper', () => {
  let workspaceElement, activationPromise;

  beforeEach(() => {
    workspaceElement = atom.views.getView(atom.workspace);
    activationPromise = atom.packages.activatePackage('code-hopper');
  });

  describe('activation', () => {
    it('registers the v0.1 navigation commands', () => {
      waitsForPromise(() => activationPromise);

      runs(() => {
        expect(atom.commands.findCommands({ target: workspaceElement }).some((command) => command.name === 'code-hopper:jump-to-symbol')).toBe(true);
        expect(atom.commands.findCommands({ target: workspaceElement }).some((command) => command.name === 'code-hopper:jump-back')).toBe(true);
        expect(atom.commands.findCommands({ target: workspaceElement }).some((command) => command.name === 'code-hopper:refresh-index')).toBe(true);
      });
    });
  });
});
