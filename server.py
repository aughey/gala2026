"""Local show editor. Python standard library only; run python3 server.py."""
import argparse
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from extract import ROOT, FIELDS, csv_text, initialize

LOCK = threading.Lock()
WORKING = ROOT / 'data/working.json'
BASELINE = ROOT / 'data/baseline.json'


def atomic_write(path, text):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(text, encoding='utf-8')
    os.replace(temporary, path)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / 'static'), **kwargs)

    def send_data(self, value, status=200, content_type='application/json; charset=utf-8'):
        payload = (json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value).encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/show':
            try:
                with LOCK:
                    document = json.loads(WORKING.read_text())
                    baseline = json.loads(BASELINE.read_text())
                self.send_data({'working': document, 'baseline': baseline, 'fields': FIELDS,
                                'working_file': str(WORKING.relative_to(ROOT))})
            except (ValueError, OSError) as error:
                self.send_data({'error': str(error)}, 500)
        elif path in ('/export/working.csv', '/export/baseline.csv'):
            with LOCK:
                document = json.loads((WORKING if 'working' in path else BASELINE).read_text())
            self.send_data(csv_text(document), content_type='text/csv; charset=utf-8')
        elif path == '/export/working.json':
            self.send_data(json.loads(WORKING.read_text()))
        else:
            super().do_GET()

    def do_POST(self):
        if self.path != '/api/show':
            return self.send_data({'error': 'Unknown endpoint'}, 404)
        # Bind only to loopback; disallow cross-origin writes from other web pages.
        if self.headers.get('Origin') not in (None, f'http://{self.headers.get("Host")}'):
            return self.send_data({'error': 'Origin not allowed'}, 403)
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0 or length > 2_000_000:
                raise ValueError('Invalid request length')
            incoming = json.loads(self.rfile.read(length))
            with LOCK:
                current = json.loads(WORKING.read_text())
                if incoming.get('revision') != current['revision']:
                    return self.send_data({'error': 'Another editor saved changes. Reload before saving.'}, 409)
                cues = incoming['cues']
                if not isinstance(cues, list) or not cues:
                    raise ValueError('At least one cue is required')
                ids = set()
                for cue in cues:
                    if not isinstance(cue, dict) or not isinstance(cue.get('id'), str) or cue['id'] in ids:
                        raise ValueError('Each cue needs a unique ID')
                    ids.add(cue['id'])
                    if current.get('schema_version', 1) >= 2:
                        if cue.get('kind') not in ('standby', 'go', 'set', 'note'):
                            raise ValueError('Call type must be standby, go, set, or note')
                        if not cue.get('item_id'):
                            raise ValueError('Every call needs a program item ID')
                        lead = str(cue.get('lead_seconds', '')).strip()
                        if lead and (not lead.isdigit() or int(lead) > 86400):
                            raise ValueError('Standby lead must be a whole number of seconds, from 0 to 86400')
                    for field, _ in FIELDS:
                        if field == 'confirmed':
                            if not isinstance(cue.get(field), bool):
                                raise ValueError('Reviewed must be true or false')
                        elif not isinstance(cue.get(field, ''), (str, int)):
                            raise ValueError(f'Invalid field: {field}')
                current.update(cues=cues, revision=current['revision'] + 1)
                atomic_write(WORKING, json.dumps(current, indent=2, ensure_ascii=False) + '\n')
                atomic_write(ROOT / 'data/working.csv', csv_text(current))
            self.send_data({'revision': current['revision']})
        except (ValueError, KeyError, TypeError) as error:
            self.send_data({'error': str(error)}, 400)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    initialize()
    print(f'Show caller: http://localhost:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
