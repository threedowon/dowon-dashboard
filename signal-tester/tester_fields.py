"""Per-connection JSON field discovery. Runtime only; never edits a workspace."""
from collections import OrderedDict, deque
from copy import deepcopy
import json
import math
import time
from tester_sensors import Frames

MAX_FIELDS = 128
MAX_DEPTH = 8
MAX_POINTS = 600


def reject_constant(value):
    raise ValueError('Non-finite JSON value: '+value)


def flatten(value, path=()):
    # Reject escaped lone surrogates before they can break the UTF-8 API response.
    if path:
        path[-1].encode('utf-8')
    if isinstance(value, str):
        value.encode('utf-8')
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('JSON values must be finite.')
    if len(path) > MAX_DEPTH:
        raise ValueError('JSON nesting exceeds 8 levels.')
    if isinstance(value, dict) and value:
        for key, child in value.items():
            yield from flatten(child, (*path, key))
    elif isinstance(value, list) and value:
        for index, child in enumerate(value):
            yield from flatten(child, (*path, str(index)))
    elif path:
        yield path, value


class JSONFields:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.frames = Frames()
        self.last_raw = None
        self.items = OrderedDict()
        self.last_error = ''
        self.errors = 0
        self.messages = 0
        self.limited = False

    def _gap(self, row, stamp):
        row['present'] = False
        if row['points'] and row['points'][-1][1] is not None:
            row['points'].append([stamp, None])

    def receive(self, data, stamp, datagram=False):
        if datagram and data.startswith((b'/', b'#bundle')):
            return
        now = self.clock()
        if self.last_raw is not None and now - self.last_raw > 2:
            self.frames = Frames()
        self.last_raw = now
        # A UDP datagram can contain a pretty-printed JSON object. Serial is line framed.
        frames = None
        if datagram and len(data) <= 4096:
            try:
                candidate = json.loads(data, parse_constant=reject_constant)
                if isinstance(candidate, (dict, list)):
                    frames = [data]
            except (ValueError, UnicodeError, RecursionError):
                pass
        if frames is None:
            frames = self.frames.read(data, datagram)
        for frame in frames:
            if not isinstance(frame, Exception) and not frame.lstrip().startswith((b'{', b'[')):
                continue  # Plain numbers, boot messages and OSC stay in their own monitors.
            try:
                if isinstance(frame, Exception):
                    raise frame
                value = json.loads(frame, parse_constant=reject_constant)
                # Validate completely before publishing any part of a message.
                leaves = list(flatten(value))
            except (ValueError, UnicodeError, RecursionError) as error:
                self.last_error = str(error)[:240]
                self.errors += 1
                for row in self.items.values():
                    self._gap(row, stamp)
                continue
            self.last_error = ''
            self.messages += 1
            self.limited = len(leaves) > MAX_FIELDS
            seen = set()
            for path, value in leaves[:MAX_FIELDS]:
                key = json.dumps(path, ensure_ascii=False, separators=(',', ':'))
                seen.add(key)
                previous = self.items.pop(key, None)
                points = previous['points'] if previous else deque(maxlen=MAX_POINTS)
                numeric = type(value) in (int, float)
                # JSON booleans retain their type; they are not numeric sensor values.
                kind = ('number' if numeric else 'boolean' if isinstance(value, bool) else 'null' if value is None
                        else 'string' if isinstance(value, str) else 'array' if isinstance(value, list) else 'object')
                plotted = value if numeric and abs(value) <= 1e12 else None
                if points and plotted is not None and points[-1][1] is not None and stamp - points[-1][0] < 100:
                    points[-1][1] = plotted
                else:
                    points.append([stamp, plotted])
                self.items[key] = {'key': key, 'path': list(path), 'value': str(value) if numeric and abs(value) > 2**53 - 1 else value, 'type': kind,
                                   'numeric': plotted is not None, 'time': stamp, 'last': now,
                                   'count': (previous['count'] if previous else 0) + 1,
                                   'present': True, 'points': points}
            for key, row in self.items.items():
                if key not in seen:
                    self._gap(row, stamp)
            while len(self.items) > MAX_FIELDS:
                self.items.popitem(last=False)
                self.limited = True

    def snapshot(self):
        now = self.clock()
        return {'items': [deepcopy({**{k: v for k, v in row.items() if k not in ('last', 'points')},
                                   'ageSeconds': max(0, now - row['last']),
                                   'live': row['present'] and now - row['last'] <= 2})
                          for row in self.items.values()],
                'error': self.last_error, 'errors': self.errors, 'messages': self.messages,
                'partial': bool(self.frames.buffer), 'limited': self.limited, 'limit': MAX_FIELDS}

    def detail(self, key):
        row = self.items.get(key)
        return {'key': key, 'points': deepcopy(list(row['points'])) if row else []}
