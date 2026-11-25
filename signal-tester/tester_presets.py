"""Add built-in sensor bundles without replacing the user's workspace."""
from copy import deepcopy
import json
import uuid
from pathlib import Path

PRESETS = Path(__file__).resolve().parent / 'presets'

VL53L0X_DIAGNOSTICS = (
    ('distance', 'Distance', 'mm'), ('raw_mm', 'Raw distance (unvalidated)', 'mm'),
    ('valid', 'Valid', '0 / 1'), ('range_status', 'Range status', 'code'),
    ('signal_mcps', 'Return signal', 'MCPS'), ('ambient_mcps', 'Ambient light', 'MCPS'),
    ('i2c_ack', 'I2C response', '0 / 1'), ('api_status', 'API status', 'code'),
    ('ready', 'Ready', '0 / 1'), ('error', 'Error', 'code'),
    ('spads', 'Effective SPADs', 'count'), ('timing_us', 'Timing budget', 'us'),
    ('mode', 'Test mode', 'code'), ('seq', 'Sample sequence', 'count'),
)


def add_vl53l0x_diagnostics(workspace, source_id):
    """Append read-only monitors to an explicit existing source; keep edits intact."""
    source = next((t for t in workspace['targets'] if t['id'] == source_id), None)
    if not source or source.get('type', 'http') not in ('serial', 'udp'):
        raise ValueError('Choose an existing Serial or UDP sensor connection.')
    result = deepcopy(workspace)
    monitors = result.setdefault('sensors', [])
    fields = {m.get('field') for m in monitors
              if m['sourceId'] == source_id and m['parser'] == 'json'}
    missing = [spec for spec in VL53L0X_DIAGNOSTICS if spec[0] not in fields]
    if len(monitors) + len(missing) > 32:
        raise ValueError('Adding diagnostics would exceed the 32-monitor limit. Remove unused monitors first.')
    for field, name, unit in missing:
        monitors.append(dict(id=uuid.uuid4().hex, name='VL53L0X ' + name,
            sourceId=source_id, parser='json', field=field, unit=unit,
            staleSeconds=2, rules=[]))
    return result, dict(targets=0, signals=0, sensors=len(missing))


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
