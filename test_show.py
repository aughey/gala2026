import csv
import hashlib
import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer

import extract
import server
from call_events import upgrade


class ExtractionTests(unittest.TestCase):
    def test_traceability_and_no_invented_lighting(self):
        show = extract.extract_legacy()
        self.assertEqual(len(show['source_records']), 38)
        self.assertEqual(len(show['cues']), 47)
        self.assertEqual(show['source_sha256'], hashlib.sha256(extract.SOURCE.read_bytes()).hexdigest())
        source = list(csv.reader(io.StringIO(extract.SOURCE.read_text())))[4:]
        for record, cells in zip(show['source_records'], source):
            self.assertEqual(list(record.values())[1:], cells)
        self.assertTrue(all(not c['backlight'] for c in show['cues']))
        self.assertTrue(all(not c['confirmed'] for c in show['cues']))
        dinner = next(c for c in show['cues'] if c['source_row'] == 14)
        self.assertEqual(dinner['time'], '6:47 PM')
        self.assertEqual(dinner['house'], 'Up')
        self.assertEqual(dinner['stage'], 'Up')
        self.assertTrue(dinner['piano'])
        self.assertTrue(dinner['lav'])

    def test_screen_splits_and_estimates_are_explicit(self):
        show = extract.extract_legacy()
        cues = show['cues']
        self.assertEqual(len({c['id'] for c in cues}), len(cues))
        auction = [c for c in cues if c['source_row'] == 19]
        self.assertEqual(len(auction), 6)
        self.assertIn('NOT selected', auction[0]['trigger'])
        self.assertTrue(auction[0]['erin'])
        self.assertTrue(all(not c['erin'] for c in auction[1:]))
        switch = [c for c in cues if c['source_row'] == 22][1]
        self.assertEqual(switch['screens'], 'Switch to camera feed')
        self.assertFalse(switch['podium'])
        video = next(c for c in cues if c['source_row'] == 16)
        self.assertEqual(video['time'], '')
        self.assertEqual(video['estimated_time'], '7:31 PM')
        self.assertIn('Estimated time assumes', video['review'])

    def test_csv_round_trips_multiline_and_commas(self):
        show = extract.extract()
        rows = list(csv.reader(io.StringIO(extract.csv_text(show))))
        self.assertEqual(len(rows), len(show['cues']) + 1)
        self.assertEqual(len(rows[0]), len(extract.FIELDS))
        index = [k for k, _ in extract.FIELDS].index('activity')
        self.assertEqual(rows[1][index], show['cues'][0]['activity'])
        self.assertIn('Slide - Fund-a-need: $20,000', [r[[k for k, _ in extract.FIELDS].index('screens')] for r in rows[1:]])


class CallEventTests(unittest.TestCase):
    def test_each_call_point_groups_actions_with_separate_standby_and_go(self):
        show = extract.extract()
        self.assertEqual(show['schema_version'], 3)
        pairs = {}
        for call in show['cues']:
            self.assertTrue(call['item'])
            if call['kind'] == 'note':
                continue
            pairs.setdefault(call['pair_id'], []).append(call)
            self.assertGreaterEqual(sum(bool(call.get(k)) for k in __import__('call_events').ACTION_LABELS), 1)
        for standby, go in pairs.values():
            self.assertEqual(standby['kind'], 'standby')
            self.assertEqual(go['kind'], 'go')
            self.assertEqual(standby['item_id'], go['item_id'])
            self.assertEqual(standby['time'], '')
            self.assertEqual(standby['lead_seconds'], '30')
        dinner = next(pair for pair in pairs.values() if pair[0]['moment_id'] == 'source-002')
        self.assertIn('Standby DJ music', dinner[0]['call'])
        self.assertIn('Standby House lights up', dinner[0]['call'])
        self.assertEqual(dinner[1]['call'], 'Lights, DJ, Screens, GO!')
        self.assertEqual(len([c for c in show['cues'] if c['moment_id']=='source-003']), 2)
        for field in ('house','stage','piano','choir','monitors','camera','screens'):
            group = next(c for c in show['cues'] if c['moment_id']=='source-003' and c['kind']=='go')
            self.assertTrue(group[field])
        choir = [c for c in show['cues'] if c['source_row'] in (3, 4)]
        self.assertEqual(len({c['item_id'] for c in choir}), 1)
        self.assertTrue(all(c['item'] == 'Opening number' for c in choir))

    def test_upgrade_preserves_previous_work_and_is_idempotent(self):
        old = extract.extract_legacy()
        old['cues'][2]['call'] = 'Custom original caller wording'
        old['cues'][2]['house'] = '50%'
        migrated = upgrade(old)
        self.assertEqual(migrated['legacy_cues'], old['cues'])
        self.assertEqual(migrated['source_records'], old['source_records'])
        self.assertTrue(any(c['house'] == '50%' for c in migrated['cues']))
        migrated['cues'][1]['call'] = 'Custom new standby'
        self.assertEqual(upgrade(migrated), migrated)

    def test_different_call_points_and_custom_wording_are_preserved(self):
        from call_events import upgrade_individual
        individual = upgrade_individual(extract.extract_legacy())
        custom = next(c for c in individual['cues'] if c['moment_id']=='source-002' and c['kind']=='go')
        custom['call'] = 'My custom lighting GO'
        grouped = upgrade(individual)
        self.assertEqual(grouped['ungrouped_cues'],individual['cues'])
        self.assertTrue(any('My custom lighting GO' in c['call'] for c in grouped['cues']))
        screen_moments = {c['moment_id'] for c in grouped['cues'] if c['source_row']==22}
        self.assertEqual(len(screen_moments),2)


class PersistenceTests(unittest.TestCase):
    def test_save_export_stale_revision_and_baseline_preservation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            working, baseline = root / 'data/working.json', root / 'data/baseline.json'
            document = extract.extract()
            initial_revision = document['revision']
            text = json.dumps(document)
            working.write_text(text)
            baseline.write_text(text)
            with patch.multiple(server, ROOT=root, WORKING=working, BASELINE=baseline):
                http = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
                thread = threading.Thread(target=http.serve_forever, daemon=True)
                thread.start()
                url = f'http://127.0.0.1:{http.server_port}'
                try:
                    document['cues'][1]['house'] = '50%'
                    document['cues'][1]['kind'] = 'set'
                    document['cues'][1]['call'] = 'Set house lights to 50%'
                    body = json.dumps(document).encode()
                    request = lambda: urllib.request.Request(url + '/api/show', data=body, headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(request()) as response:
                        self.assertEqual(json.load(response)['revision'], initial_revision + 1)
                    self.assertEqual(json.loads(working.read_text())['cues'][1]['house'], '50%')
                    self.assertEqual(json.loads(working.read_text())['cues'][1]['kind'], 'set')
                    self.assertEqual(baseline.read_text(), text)
                    with urllib.request.urlopen(url + '/export/working.csv') as response:
                        self.assertIn('50%', response.read().decode())
                    self.assertIn('50%', (root / 'data/working.csv').read_text())
                    with self.assertRaises(urllib.error.HTTPError) as result:
                        urllib.request.urlopen(request())
                    self.assertEqual(result.exception.code, 409)
                    result.exception.close()
                    self.assertEqual(json.loads(working.read_text())['revision'], initial_revision + 1)
                    # An external file editor is reflected by the next read, without restarting.
                    external = json.loads(working.read_text())
                    external['title'] = 'Updated show from disk'
                    external['cues'][1]['house'] = 'Down'
                    external['revision'] += 1
                    working.write_text(json.dumps(external))
                    with urllib.request.urlopen(url + '/api/show') as response:
                        reread = json.load(response)
                    self.assertEqual(reread['working']['title'], 'Updated show from disk')
                    self.assertEqual(reread['working']['cues'][1]['house'], 'Down')
                    self.assertEqual(reread['working_file'], 'data/working.json')
                finally:
                    http.shutdown()
                    thread.join()
                    http.server_close()


if __name__ == '__main__':
    unittest.main()
