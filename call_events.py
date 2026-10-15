"""Upgrade technical moments into ordered Standby/Go events with grouped actions."""
import copy
import re

ACTION_LABELS = {
    'house': 'House lights', 'stage': 'Stage lights', 'backlight': 'Backlight / object lights',
    'lav': 'Fr Brian lav', 'podium': 'Podium mic', 'piano': 'Piano / pianist',
    'choir': 'Choir mics', 'erin': 'Erin handheld', 'dj': 'DJ music',
    'monitors': 'Stage monitors', 'audio_other': 'Audio', 'camera': 'Camera', 'screens': 'Screens',
}


def call_wording(kind, field, value):
    prefix = 'Standby' if kind == 'standby' else 'Go'
    value = ' '.join(value.split())
    name = ACTION_LABELS[field]
    if field in ('house', 'stage', 'backlight'):
        return f'{prefix} {name} {value.lower()}'
    if field == 'dj':
        off = bool(re.search(r'\boff\b', value, re.I))
        return f'{prefix} ' + ('DJ music off' if off else 'DJ music' if kind == 'standby' else 'DJ')
    if field in ('camera', 'screens'):
        value = re.sub(r'^(?:slide[s]?|video)\s*-\s*', '', value, flags=re.I)
        return f'{prefix} {name.lower()} — {value}'
    state = 'off' if re.search(r'\boff\b', value, re.I) else 'on' if re.search(r'\bon\b', value, re.I) else ''
    return f'{prefix} {name}' + (f' {state}' if state else f' — {value}')


def upgrade_individual(document):
    if document.get('schema_version', 1) >= 2:
        return copy.deepcopy(document)
    result = copy.deepcopy(document)
    result['legacy_cues'] = copy.deepcopy(document['cues'])
    result['schema_version'] = 2
    result['revision'] = document.get('revision', 0) + 1
    events = []
    program_id, program_title = 'item-001', 'Show preparation'
    programs = {}
    for record in document.get('source_records', []):
        text = record.get('activity', '').strip()
        heading = text.split('\n')[0].strip().rstrip(':')
        if record.get('time', '').strip() and '\n\n' in text and heading and len(heading) < 72 and not heading.endswith('.') and not heading.startswith(('Fr ', 'Fr. ', 'Auctioneer/')):
            program_id = f"item-{record['source_row']:03}"
            program_title = heading
        programs[record['source_row']] = (program_id, program_title)
    for moment in document['cues']:
        program_id, program_title = programs.get(moment.get('source_row'), (program_id, program_title))
        pairs = []
        for field in ACTION_LABELS:
            if moment.get(field):
                pairs.append((field, moment[field]))
        if not pairs:
            event = copy.deepcopy(moment)
            event.update(item_id=program_id, item=program_title, kind='note', moment_id=moment['id'], pair_id='', lead_seconds='', target_time='')
            events.append(event)
            continue
        # Prepare every operator for this moment before any GO actions.
        for kind in ('standby', 'go'):
            for field, value in pairs:
                event = copy.deepcopy(moment)
                for key in ACTION_LABELS:
                    event[key] = value if key == field else ''
                event.update(
                    id=f"{moment['id']}-{field}-{kind}", item_id=program_id, item=program_title,
                    kind=kind, moment_id=moment['id'], pair_id=f"{moment['id']}-{field}",
                    lead_seconds='30' if kind == 'standby' else '',
                    target_time=moment.get('time') or moment.get('estimated_time', ''),
                    call=call_wording(kind, field, value), confirmed=False,
                )
                event['review'] += ' Program grouping and individual call order are proposed; review.'
                if kind == 'standby':
                    event.update(time='', estimated_time='', duration='',
                                 trigger='Before the linked GO — confirm standby point. ' + moment.get('trigger', ''))
                    event['review'] += ' Standby lead is an editable 30-second suggestion, not supplied by the source.'
                events.append(event)
    for index, event in enumerate(events, 1):
        event['sequence'] = f'{index:03}'
    result['cues'] = events
    return result


def group_wording(kind, actions):
    if kind == 'standby':
        return '\n'.join(call_wording(kind, key, value) for key, value in actions.items() if value)
    departments = []
    for key, value in actions.items():
        if not value:
            continue
        department = ('Lights' if key in ('house', 'stage', 'backlight') else
                      'DJ' if key == 'dj' else 'Camera' if key == 'camera' else
                      'Screens' if key == 'screens' else 'Sound')
        if department not in departments:
            departments.append(department)
    return ', '.join(departments) + ', GO!' if departments else ''


def upgrade(document):
    if document.get('schema_version', 1) >= 3:
        return copy.deepcopy(document)
    individual = upgrade_individual(document)
    result = copy.deepcopy(individual)
    result['ungrouped_cues'] = copy.deepcopy(individual['cues'])
    result['schema_version'] = 3
    result['revision'] += 1
    groups = []
    def grouping_key(c):
        return tuple(c.get(k, '') for k in ('moment_id', 'item_id', 'kind', 'time', 'estimated_time', 'target_time', 'lead_seconds', 'trigger'))
    for event in individual['cues']:
        if event['kind'] == 'note' or not groups or grouping_key(groups[-1][0]) != grouping_key(event):
            groups.append([event])
        else:
            groups[-1].append(event)
    events = []
    for members in groups:
        combined = copy.deepcopy(members[0])
        combined['member_ids'] = [c['id'] for c in members]
        if combined['kind'] != 'note':
            custom = False
            for member in members:
                original_actions = [(k, member.get(k, '')) for k in ACTION_LABELS if member.get(k)]
                expected = '\n'.join(call_wording(member['kind'], k, v) for k, v in original_actions)
                custom |= member.get('call', '') != expected
            for key in ACTION_LABELS:
                values = list(dict.fromkeys(c[key] for c in members if c.get(key)))
                combined[key] = '\n'.join(values)
            combined['pair_id'] = '|'.join(sorted({c['pair_id'] for c in members if c.get('pair_id')}))
            combined['call'] = ('\n'.join(c['call'] for c in members if c.get('call')) if custom else
                                group_wording(combined['kind'], {k: combined.get(k, '') for k in ACTION_LABELS}))
            combined['confirmed'] = all(c.get('confirmed', False) for c in members)
            combined['review'] = '\n'.join(dict.fromkeys(c.get('review', '') for c in members))
            combined['review'] += ' Actions on this screen are proposed as one shared call point; confirm simultaneity.'
        combined['sequence'] = f'{len(events)+1:03}'
        events.append(combined)
    result['cues'] = events
    return result
