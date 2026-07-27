import os
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler

HTML_PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>AMA Dashboard</title>
<style>
body{background:#0d1117;color:#c9d1d9;font-family:Consolas,monospace;margin:0;padding:24px;}
h1{color:#e6edf3;}
</style></head><body>
<h1>🚀 Antigravity Multi-Agent Dashboard</h1>
<p>Monitoring directory: {repo_path}</p>
<p>To view logs, you can tail the console output of your AMA run.</p>
</body></html>
"""

class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        html = HTML_PAGE.replace("{repo_path}", self.server.repo_path)
        self.wfile.write(html.encode('utf-8'))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-path", type=str, default=os.getcwd())
    parser.add_argument("--port", type=int, default=47614)
    args = parser.parse_args()
    
    server = HTTPServer(('127.0.0.1', args.port), DashboardHandler)
    server.repo_path = args.repo_path
    
    print(f"DASHBOARD READY http://localhost:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
