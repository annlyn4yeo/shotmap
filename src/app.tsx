import { Wordmark } from './components/Wordmark';
import './app.css';

export function App() {
  return (
    <>
      <main class="shell">
        <h1>
          <Wordmark />
        </h1>
        <p class="shell-tagline">Every shot, surveyed.</p>
        <p class="shell-note">
          Football shots from StatsBomb open data, plotted on the pitch.
        </p>
      </main>
      <footer class="credit">
        <span class="credit-logo" data-slot="statsbomb-logo" aria-hidden="true" />
        <p>
          Data by{' '}
          <a href="https://statsbomb.com" rel="noopener">
            StatsBomb
          </a>
          .
        </p>
      </footer>
    </>
  );
}
