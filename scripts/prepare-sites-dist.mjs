import { mkdir, writeFile } from 'node:fs/promises';

const worker = `const immutableAssetPattern = /\\/assets\\/|\\/favicon\\.svg$|\\/icons\\.svg$/;

function withHeaders(response, pathname) {
  const headers = new Headers(response.headers);

  if (immutableAssetPattern.test(pathname)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    headers.set('Cache-Control', 'no-cache');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchAsset(env, request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);
    const fileName = pathname.split('/').pop() ?? '';
    const assetPath = pathname === '/' || !fileName.includes('.') ? '/index.html' : pathname;
    const response = await fetchAsset(env, request, assetPath);

    if (response.ok) {
      return withHeaders(response, assetPath);
    }

    const fallback = await fetchAsset(env, request, '/index.html');
    return withHeaders(fallback, '/index.html');
  },
};
`;

await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', worker);
