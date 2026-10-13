// Actual UI and server routes with synthetic data and mocked OpenAI. No real credentials.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { createNotebookFixture } from './notebook-fixture.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), out = join(root, 'outputs/notebook-fixture');
await mkdir(out, { recursive: true });
const fixture = await createNotebookFixture();
await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ProjectOS} from './app/project-os';createRoot(document.getElementById('root')).render(<ProjectOS ownerEmail="demo@fixture.test"/>);`, resolveDir: root, loader: 'tsx' }, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', outfile: join(out, 'app.js'), define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': root } });
// Build current Tailwind/CSS using the project's installed PostCSS plugins.
const { default: postcss } = await import('postcss'), { default: tailwind } = await import('@tailwindcss/postcss');
const result = await postcss([tailwind()]).process(await readFile(join(root, 'app/globals.css'), 'utf8'), { from: join(root, 'app/globals.css') });
await writeFile(join(out, 'style.css'), result.css + '\n' + await readFile(join(root, 'app/project-os.css'), 'utf8') + '\n' + await readFile(join(root, 'app/notebook.css'), 'utf8'));
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.url === '/api/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture.state())); return; }
    if (req.url.startsWith('/api/notebook')) {
      let response;
      if (req.method === 'GET') response = await fixture.api.notebook.GET(new Request(fixture.origin + req.url));
      else { const chunks = []; for await (const c of req) chunks.push(c); const request = new Request(fixture.origin + req.url, { method: 'POST', headers: { origin: fixture.origin, 'content-type': req.headers['content-type'] }, body: Buffer.concat(chunks) }); response = await (req.url.endsWith('/voice') ? fixture.api.voice.POST(request) : fixture.api.notebook.POST(request)); }
      res.statusCode = response.status; res.setHeader('Content-Type', 'application/json'); res.end(await response.text()); return;
    }
    if (req.url === '/api/action' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body), state = fixture.state(), replay = state.events.find(e => e.id === request.commandId);
      const result = replay ? { id: replay.sourceId, state, replayed: true } : fixture.apply((['suggestion_status', 'edit_suggestion'].includes(request.action) ? fixture.api.buildDailyCommand : fixture.api.buildCoreCommand)(state, fixture.userId, request.action, request.payload, request.commandId));
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
    }
    if (req.url === '/app.js' || req.url === '/style.css') { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await readFile(join(out, req.url.slice(1)))); return; }
    if (req.url === '/' || req.url === '/login') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bloc · Vista de prueba</title><link rel="stylesheet" href="/style.css"></head><body><div style="position:fixed;bottom:80px;right:12px;z-index:1000;background:#2A0D3A;color:white;padding:7px 12px;border-radius:8px;font:11px sans-serif;pointer-events:none">VISTA DE PRUEBA · Datos ficticios</div><div id="root"></div><script src="/app.js"></script></body></html>'); return; }
    res.statusCode = 404; res.end('Not found');
  } catch (error) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: error.message })); }
});
server.listen(3102, '127.0.0.1', () => console.log('Notebook fixture: http://127.0.0.1:3102/ · synthetic data only; no upstream calls.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
