// Test-only: maps Supabase's /rest/v1 prefix onto a bare PostgREST server.
import http from 'node:http'
const target = Number(process.env.PGRST_PORT ?? 3001), port = Number(process.env.PROXY_PORT ?? 3002)
http.createServer((req, res) => {
  const p = http.request({ host: '127.0.0.1', port: target, path: req.url.replace(/^\/rest\/v1/, '') || '/', method: req.method, headers: req.headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  p.on('error', (e) => { res.writeHead(502); res.end(String(e)) }); req.pipe(p)
}).listen(port, '127.0.0.1')
