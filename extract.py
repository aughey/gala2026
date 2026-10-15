"""Deterministic, lossless source capture plus reviewable show-cue extraction."""
import csv
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / '2026 Gala Event Manual    - Run of Show.csv'
FIELDS = [
    ('sequence', 'Sequence'), ('item', 'Program item'), ('kind', 'Call type'),
    ('time', 'Source time'), ('estimated_time', 'Estimated time'),
    ('lead_seconds', 'Standby lead (seconds)'), ('target_time', 'Linked GO time'),
    ('duration', 'Duration'), ('trigger', 'Call trigger'),
    ('house', 'House lights'), ('stage', 'Stage lights'), ('backlight', 'Backlight / object lights'),
    ('lav', 'Fr Brian lav'), ('podium', 'Podium mic'), ('piano', 'Piano / pianist'),
    ('choir', 'Choir mics'), ('erin', 'Erin handheld'), ('dj', 'DJ'), ('monitors', 'Stage monitors'),
    ('audio_other', 'Other audio'), ('camera', 'Camera'), ('screens', 'Screens / playback'),
    ('activity', 'Activity / stage action'), ('call', 'Caller script'),
    ('review', 'Questions / assumptions'), ('confirmed', 'Reviewed'), ('source_row', 'Source record'),
    ('item_id', 'Program item ID'), ('moment_id', 'Technical moment ID'), ('pair_id', 'Standby / GO pair ID'),
]


def normalize(value):
    return re.sub(r'[ \t]+', ' ', value.strip())


def extract_legacy(path=SOURCE):
    raw = path.read_bytes()
    records = list(csv.reader(raw.decode('utf-8-sig').splitlines(keepends=True)))
    header = next(i for i, r in enumerate(records) if r[:2] == ['Time', 'Duration'])
    cues, originals = [], []
    for number, cells in enumerate(records[header + 1:], 1):
        if not any(cells):
            continue
        cells = (cells + [''] * 7)[:7]
        time, duration, lighting, audio, camera, screens, activity = map(normalize, cells)
        original = dict(zip(['time', 'duration', 'lighting', 'audio', 'camera', 'screens', 'activity'], cells))
        originals.append({'source_row': number, **original})
        cue = {key: '' for key, _ in FIELDS}
        cue.update(id=f'source-{number:03}', sequence=str(number), time=time, duration=duration,
                   camera=camera, activity=activity, source_row=number, confirmed=False)
        for subject, field in [('House', 'house'), ('Stage', 'stage')]:
            match = re.search(subject + r' lights (up|down)', lighting, re.I)
            if match:
                cue[field] = match[1].capitalize()
        for block in re.split(r'\n\s*\n', audio):
            block = normalize(block)
            if not block:
                continue
            lower = block.lower()
            if 'dj sound' in lower:
                field = 'dj'
            elif 'fr brian' in lower:
                field = 'lav'
            elif 'podium' in lower:
                field = 'podium'
            elif 'pian' in lower:
                field = 'piano'
            elif 'choir' in lower:
                field = 'choir'
            elif 'monitor' in lower:
                field = 'monitors'
            elif 'auctioneer' in lower:
                field = 'erin'
            else:
                field = 'audio_other'
            cue[field] = '\n'.join(filter(None, [cue.get(field), block]))
        cue['screens'] = screens
        cue['review'] = 'Caller wording is suggested; confirm the GO trigger with the show team.'
        if not time:
            cue['review'] += ' No clock time supplied; call on the agreed trigger.'
        if number == 14:
            cue['review'] += ' Source dinner duration is approximately 45 min; 6:47–7:30 is 43 min.'
        if number == 18:
            cue['review'] += ' 15 min covers the live-auction segment, including following auction items.'
        if number == 20:
            cue['review'] += ' 3 min appears to cover the introduction and following video; confirm split.'
        if number == 26:
            cue['review'] += ' 20 min covers bids and paddle drop, including following amount slides.'
        if number == 37:
            cue['review'] += ' Source ends this minute at 8:26; dancing is listed at 8:30. Confirm the gap.'
        # Only estimate an adjacent untimed row following a timed, duration-bearing row.
        if not time and cues and cues[-1]['time'] and number not in (19, 21):
            prior = cues[-1]
            tm = re.fullmatch(r'(\d+):(\d+) PM', prior['time'])
            dm = re.fullmatch(r'(\d+) [Mm]inutes?', prior['duration'])
            if tm and dm:
                minutes = int(tm[1]) * 60 + int(tm[2]) + int(dm[1])
                cue['estimated_time'] = f'{minutes // 60}:{minutes % 60:02d} PM'
                cue['review'] += ' Estimated time assumes the preceding duration ends at this cue.'
        cues.append(cue)
    # Expand sequential screen actions into separate callable rows. Source record stays attached.
    expanded = []
    for cue in cues:
        parts = re.split(r'\n\s*\n', cue['screens'])
        parts = [normalize(p) for p in parts if normalize(p) and normalize(p) != 'Slides -'] or ['']
        for index, screen in enumerate(parts):
            row = dict(cue)
            row['id'] = cue['id'] + (f'-{index + 1}' if len(parts) > 1 else '')
            row['screens'] = screen
            if index:
                for field, _ in FIELDS:
                    if field not in ('source_row', 'review', 'confirmed', 'screens'):
                        row[field] = ''
                row['review'] = 'Sequential screen cue split from a source cell; confirm the GO trigger.'
            if cue['source_row'] == 19:
                row['trigger'] = 'On auctioneer introducing this item (confirm)'
                if 'Holy Spirits' in screen:
                    row['trigger'] = 'Only if NOT selected by Golden Ticket winner'
                    row['review'] += ' Source says "if not not selected"; interpreted from its following "otherwise skip". Confirm.'
            elif index:
                row['trigger'] = 'On speaker / caller direction (confirm)'
            if cue['source_row'] == 23 and not index:
                row['trigger'] = 'Hold Tim Bono slide until he stops referring to it'
            if cue['source_row'] in range(27, 35):
                row['trigger'] = 'On auctioneer calling this giving level (confirm)'
            row['sequence'] = f'{len(expanded) + 1:03}'
            actions = []
            for field, label in FIELDS:
                if field in ('house', 'stage', 'backlight', 'lav', 'podium', 'piano', 'choir', 'erin', 'dj', 'monitors', 'audio_other', 'camera', 'screens') and row.get(field):
                    actions.append(f'{label}: {row[field]}')
            row['call'] = 'GO — ' + '; '.join(actions) if actions else ''
            expanded.append(row)
    return {'schema_version': 1, 'title': 'Voices of the CSC · 2026 Newman Gala',
            'source_file': path.name, 'source_sha256': hashlib.sha256(raw).hexdigest(),
            'revision': 0, 'cues': expanded, 'source_records': originals}


def csv_text(document):
    import io
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow([label for _, label in FIELDS])
    for cue in document['cues']:
        writer.writerow([cue.get(key, '') for key, _ in FIELDS])
    return output.getvalue()


def extract(path=SOURCE):
    from call_events import upgrade
    return upgrade(extract_legacy(path))


def initialize():
    data = ROOT / 'data'
    data.mkdir(exist_ok=True)
    document = extract()
    for name in ('baseline', 'working'):
        target = data / f'{name}.json'
        if not target.exists():
            target.write_text(json.dumps(document, indent=2, ensure_ascii=False) + '\n')
        from call_events import upgrade
        saved = json.loads(target.read_text())
        migrated = saved.get('schema_version', 1) < 3
        if migrated:
            previous_version = saved.get('schema_version', 1)
            backup = data / f'{name}.v{previous_version}.json'
            if not backup.exists():
                backup.write_bytes(target.read_bytes())
            previous_csv = data / f'{name}.csv'
            if previous_csv.exists() and not (data / f'{name}.v{previous_version}.csv').exists():
                (data / f'{name}.v{previous_version}.csv').write_bytes(previous_csv.read_bytes())
            target.write_text(json.dumps(upgrade(saved), indent=2, ensure_ascii=False) + '\n')
        csv_target = data / f'{name}.csv'
        if migrated or not csv_target.exists():
            csv_target.write_text(csv_text(json.loads(target.read_text())))
    return document


if __name__ == '__main__':
    doc = initialize()
    print(f"Extracted {len(doc['source_records'])} source records into {len(doc['cues'])} cues. Existing files preserved.")
