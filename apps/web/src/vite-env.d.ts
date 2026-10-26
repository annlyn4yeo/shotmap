interface ImportMetaEnv {
  /** Where match data comes from: the generated static files, or the /v1 API. */
  readonly VITE_DATA_SOURCE?: 'static' | 'api';
  /** Where /v1 is served from when it is not the page's own origin. Empty: same origin. */
  readonly VITE_API_URL?: string;
  /** "1" on a staging build: `?data=api` or `?data=static` then picks the source. */
  readonly VITE_ALLOW_DATA_OVERRIDE?: string;
}
