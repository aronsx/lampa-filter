import functools
import http.server
import os


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()



def main():
    directory = os.path.dirname(os.path.abspath(__file__))
    server = http.server.ThreadingHTTPServer(('0.0.0.0', 8180), functools.partial(Handler, directory=directory))
    print('lampa-filters static server: http://127.0.0.1:8180/lampa-filters.plugin.js (no-store)')
    server.serve_forever()


if __name__ == '__main__':
    main()
