declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    WEB_ORIGIN?: string;
  }
}

declare module '*.sql?raw' {
  const text: string;
  export default text;
}
