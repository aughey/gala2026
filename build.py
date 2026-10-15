"""Build a self-contained static site using only the Python standard library."""
import hashlib
import json
import shutil
from pathlib import Path

from extract import FIELDS, ROOT, csv_text


def build(destination=None):
    destination = Path(destination) if destination else ROOT / 'dist'
    destination.mkdir(parents=True, exist_ok=True)
    for source in (ROOT / 'static').iterdir():
        if source.is_file():
            shutil.copy2(source, destination / source.name)
    data = destination / 'data'
    data.mkdir(exist_ok=True)
    working = json.loads((ROOT / 'data/working.json').read_text())
    baseline = json.loads((ROOT / 'data/baseline.json').read_text())
    payload = dict(working=working, baseline=baseline, fields=FIELDS,
                   working_file='data/working.json')
    payload['published_version'] = hashlib.sha256(
        json.dumps(payload, sort_keys=True).encode()).hexdigest()
    (data / 'show.json').write_text(json.dumps(payload, ensure_ascii=False) + '\n')
    for name, document in [('working', working), ('baseline', baseline)]:
        (data / f'{name}.json').write_text(json.dumps(document, indent=2, ensure_ascii=False) + '\n')
        (data / f'{name}.csv').write_text(csv_text(document))
    (destination / 'config.js').write_text('window.GALA_STATIC = true;\n')
    (destination / '.nojekyll').touch()
    return destination


if __name__ == '__main__':
    print(f'Static site built in {build()}')
