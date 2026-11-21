"""Add built-in sensor bundles without replacing the user's workspace."""
from copy import deepcopy
import json
from pathlib import Path

PRESETS = Path(__file__).resolve().parent / 'presets'


def add_sensor_preset(workspace, preset):
    if preset not in ('sen0610', 'fsr', 'all'):
        raise ValueError('Choose sen0610, fsr or all.')
    result = deepcopy(workspace)
    result.setdefault('sensors', [])
    added = dict(targets=0, signals=0, sensors=0)
    for key in (('sen0610', 'fsr') if preset == 'all' else (preset,)):
        bundle = json.loads((PRESETS / (key + '.json')).read_text(encoding='utf-8'))
        target_map, signal_map = {}, {}
        for target in bundle['targets']:
            # Stable built-in IDs also recognize earlier standalone workspaces.
            existing = next((t for t in result['targets'] if t['id'] == target['id']), None)
            if existing and existing.get('type', 'http') != target.get('type', 'http'):
                raise ValueError(f"Connection ID {target['id']} is used by another connection type.")
            if not existing and target.get('type', 'http') == 'http':
                existing = next((t for t in result['targets'] if t.get('type', 'http') == 'http'
                                 and t['host'] == target['host'] and t['port'] == target['port']), None)
            if not existing:
                existing = deepcopy(target)
                result['targets'].append(existing)
                added['targets'] += 1
            target_map[target['id']] = existing['id']
        for signal in bundle['signals']:
            existing = next((s for s in result['signals'] if s['key'] == signal['key']), None)
            if not existing:
                if any(s['id'] == signal['id'] for s in result['signals']):
                    raise ValueError(f"Signal ID {signal['id']} is already used by a different key.")
                existing = deepcopy(signal)
                result['signals'].append(existing)
                added['signals'] += 1
            signal_map[signal['id']] = existing['id']
        for monitor in bundle['sensors']:
            monitor = deepcopy(monitor)
            monitor['sourceId'] = target_map[monitor['sourceId']]
            # Preserve edited monitors by stable ID, and imported monitors by field.
            existing = next((m for m in result['sensors'] if m['id'] == monitor['id']), None)
            if existing:
                if existing['sourceId'] != monitor['sourceId']:
                    raise ValueError(f"Monitor ID {monitor['id']} belongs to another connection.")
                continue
            if any(m['sourceId'] == monitor['sourceId'] and m['parser'] == monitor['parser']
                   and m['field'] == monitor['field'] for m in result['sensors']):
                continue
            for rule in monitor['rules']:
                rule['targetId'] = target_map[rule['targetId']]
                rule['signalId'] = signal_map[rule['signalId']]
            result['sensors'].append(monitor)
            added['sensors'] += 1
    return result, added
