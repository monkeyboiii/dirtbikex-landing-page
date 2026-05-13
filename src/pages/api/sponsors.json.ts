// Static endpoint — Astro pre-renders the body at build time.
// Cache headers are set in `public/_headers` (Cloudflare Pages convention) since
// static endpoints don't propagate Response headers.

import type { APIRoute } from 'astro';
import { payload } from '../../data/sponsors';

export const GET: APIRoute = () => {
  return new Response(JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
};
