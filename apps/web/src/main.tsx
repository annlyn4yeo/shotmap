import { render } from 'preact';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { seedFromDocument } from './data/load';
import { init } from './state/app';
import { App } from './app';

const root = document.getElementById('app');
if (root) {
  seedFromDocument();
  init();
  // Dev only: the branch is statically false in production builds.
  if (import.meta.env.DEV) void import('./lib/debug').then((m) => m.countRenders());
  render(<App />, root);
}
