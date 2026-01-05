#!/usr/bin/env python3
"""
Simple HTTP server with correct MIME types for ES6 modules
"""
import http.server
import socketserver
import mimetypes

# Fix MIME type for JavaScript modules
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')

PORT = 8000

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Add headers for ES6 modules
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

    def guess_type(self, path):
        # Force correct MIME type for .js files
        if path.endswith('.js'):
            return 'application/javascript'
        return super().guess_type(path)

with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
    print(f"Server running at http://localhost:{PORT}/")
    print("Press Ctrl+C to stop")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")