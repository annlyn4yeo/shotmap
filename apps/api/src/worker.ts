import { createApp } from './app';

// The Cache API is per data centre and works on custom domains; on workers.dev it may be a
// no-op, in which case the response headers (ETag, Cache-Control) still do their job.
export default createApp({
  cache: {
    match: (request) => caches.default.match(request),
    put: (request, response) => caches.default.put(request, response),
  },
});
