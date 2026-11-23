"""Bounded, session-only diagnostics. Called while the workspace store is locked."""
from collections import deque
from copy import deepcopy


def outcome(event):
    if event.get('protocol') == 'http':
        if event.get('received'):
            return 'acknowledged'
        if event.get('stage') == 'cooldown':
            return 'blocked'
        return 'unconfirmed'
    if event.get('direction') == 'RX':
        return 'received'
    return 'error' if event.get('ok') is False else 'other'


class DebugLog:
    def __init__(self):
        self.clear()

    def clear(self):
        self.recent = deque(maxlen=200)
        self.signals = deque(maxlen=200)
        self.counts = dict(acknowledged=0, blocked=0, unconfirmed=0, received=0, error=0, other=0)
        self.watched = {key: {'acknowledged': 0, 'blocked': 0, 'unconfirmed': 0, 'last': None}
                        for key in ('person', 'person_far')}

    def record(self, event):
        self.recent.appendleft(event)
        kind = outcome(event)
        self.counts[kind] += 1
        if event.get('protocol') == 'http':
            self.signals.appendleft(event)
            watched = self.watched.get(event.get('key'))
            if watched:
                watched[kind] += 1
                watched['last'] = event

    def snapshot(self):
        # Keep Signal outcomes even when a busy sensor fills the raw-data ring.
        events = {event['id']: event for event in (*self.recent, *self.signals)}
        return deepcopy({'events': sorted(events.values(), key=lambda e: e['seq'], reverse=True),
                         'counts': self.counts, 'watched': self.watched,
                         'limits': {'recent': self.recent.maxlen, 'signals': self.signals.maxlen}})
