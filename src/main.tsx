import { render } from 'preact';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app';

const root = document.getElementById('app');

async function boot(target: HTMLElement) {
  // Dev-only. The branch is statically false in production builds, so the
  // specimen (and its CSS) never ships.
  if (import.meta.env.DEV && location.pathname.startsWith('/specimen')) {
    const { Specimen } = await import('./specimen/Specimen');
    render(<Specimen />, target);
    return;
  }
  render(<App />, target);
}

if (root) void boot(root);
