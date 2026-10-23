import { render } from 'preact';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app';

const root = document.getElementById('app');
if (root) render(<App />, root);
