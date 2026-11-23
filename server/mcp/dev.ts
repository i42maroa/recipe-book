import { createServer } from 'node:http';
import handler from './node';

const port = Number(process.env['MCP_PORT'] || 3001);
createServer((request, response) => { void handler(request, response); }).listen(port, '127.0.0.1', () => {
  console.log(`Laurel MCP: http://127.0.0.1:${port}/mcp`);
});
