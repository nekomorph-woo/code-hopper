'use babel';

import CandidateListView from '../lib/candidate-list-view';

describe('CandidateListView', () => {
  let view;

  afterEach(() => {
    if (view) view.destroy();
  });

  it('renders candidates with title and detail', () => {
    view = new CandidateListView();
    view.show([
      {
        name: 'method',
        displayName: 'DoAction#method(String ac)',
        detail: 'src/DoAction.java:42 · method · Java'
      }
    ], () => {});

    expect(view.getElement()).toExist();
    expect(view.element.querySelector('.code-hopper-candidate-title').textContent).toBe('DoAction#method(String ac)');
    expect(view.element.querySelector('.code-hopper-candidate-detail').textContent).toBe('src/DoAction.java:42 · method · Java');
  });
});
