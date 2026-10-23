import './wordmark.css';

/** The O of SHOTMAP is the goal mark: the most special thing on screen, in the logo too. */
export function Wordmark() {
  return (
    <span class="wordmark" role="img" aria-label="Shotmap">
      <span aria-hidden="true">SH</span>
      <svg
        class="wordmark-o"
        viewBox="-10 -10 20 20"
        aria-hidden="true"
        focusable="false"
      >
        <circle class="wordmark-halo" r="9.1" />
        <circle class="wordmark-disc" r="6.4" />
        <circle class="wordmark-core" r="1.8" />
      </svg>
      <span aria-hidden="true">TMAP</span>
    </span>
  );
}
