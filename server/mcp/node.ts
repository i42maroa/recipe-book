import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHttpHandler, MAX_BODY_BYTES } from './http';

type ApiRequest = IncomingMessage & { body?: unknown };
const handle = createHttpHandler();

export default async function nodeHandler(req: ApiRequest, res: ServerResponse): Promise<void> {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    let body: string | undefined;
    if (req.method === 'POST') {
      if (req.body !== undefined) body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      else {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const buffer = Buffer.from(chunk);
          size += buffer.length;
          if (size > MAX_BODY_BYTES) { res.writeHead(413, { 'Cache-Control': 'no-store' }).end(); return; }
          chunks.push(buffer);
        }
        body = Buffer.concat(chunks).toString('utf8');
      }
      if (Buffer.byteLength(body ?? '') > MAX_BODY_BYTES) { res.writeHead(413, { 'Cache-Control': 'no-store' }).end(); return; }
    }
    // Do not derive the OAuth resource or trusted URLs from forwarded/Host headers.
    const request = new Request(new URL(req.url ?? '/', 'http://localhost'), { method: req.method, headers,
      ...(body !== undefined ? { body } : {}) });
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent) res.writeHead(500, { 'Cache-Control': 'no-store' });
    res.end();
  }
}
