"""Bounded OSC packet inspection, not an OSC method dispatcher or scheduler."""
from collections import OrderedDict, deque
from copy import deepcopy
import math
import struct

MAX_ADDRESSES = 128
MAX_MESSAGES = 128
MAX_ARGUMENTS = 64


def decode_packet(data):
    """Decode a complete datagram atomically; malformed packets raise ValueError."""
    if not data or len(data) % 4 or len(data) > 65504:
        raise ValueError('OSC packet must be aligned to 4 bytes (maximum 65504 bytes).')
    messages = []

    def parse(packet, depth=0, timetag=None):
        if depth > 8:
            raise ValueError('OSC bundle nesting exceeds 8 levels.')
        pos = 0

        def take(size):
            nonlocal pos
            if size < 0 or pos + size > len(packet):
                raise ValueError('Truncated OSC argument or bundle.')
            value = packet[pos:pos + size]
            pos += size
            return value

        def string():
            nonlocal pos
            end = packet.find(b'\0', pos)
            if end < 0 or end - pos > 4096:
                raise ValueError('Missing or oversized OSC string.')
            raw = packet[pos:end]
            padded = (end + 4) & ~3
            if padded > len(packet) or any(packet[end:padded]):
                raise ValueError('Invalid OSC string padding.')
            pos = padded
            try:
                return raw.decode('utf-8')
            except UnicodeDecodeError as error:
                raise ValueError('Invalid OSC string encoding.') from error

        address = string()
        if address == '#bundle':
            tag = take(8).hex()
            while pos < len(packet):
                size = struct.unpack('>i', take(4))[0]
                if size <= 0 or size % 4:
                    raise ValueError('Invalid OSC bundle element size.')
                parse(take(size), depth + 1, tag)
            return
        if not address.startswith('/'):
            raise ValueError('OSC address must begin with /.')
        tags = string()
        if not tags.startswith(',') or len(tags) > MAX_ARGUMENTS + 1:
            raise ValueError('Missing type tags or too many OSC arguments (maximum 64).')
        args, stack = [], []
        current = args
        for tag in tags[1:]:
            value = None
            if tag in 'ifhdtrmc':
                fmt = {'i': '>i', 'f': '>f', 'h': '>q', 'd': '>d', 't': '>Q', 'r': '>I', 'm': '>I', 'c': '>I'}[tag]
                value = struct.unpack(fmt, take(struct.calcsize(fmt)))[0]
                if tag in 'ht':
                    value = str(value)  # JavaScript cannot represent every 64-bit integer.
                elif tag in 'rm':
                    value = f'{value:08X}'
                elif tag == 'c':
                    if value > 0x10ffff or 0xd800 <= value <= 0xdfff:
                        raise ValueError('Invalid OSC character.')
                    value = chr(value)
                elif isinstance(value, float) and not math.isfinite(value):
                    value = str(value)
            elif tag in 'sS':
                value = string()
            elif tag == 'b':
                size = struct.unpack('>i', take(4))[0]
                blob = take(size)
                if any(take((-size) % 4)):
                    raise ValueError('Invalid OSC blob padding.')
                value = {'bytes': size, 'hex': blob[:128].hex(' '), 'truncated': size > 128}
            elif tag in 'TFNI':
                value = {'T': True, 'F': False, 'N': None, 'I': 'Infinitum'}[tag]
            elif tag == '[':
                if len(stack) >= 8:
                    raise ValueError('OSC array nesting exceeds 8 levels.')
                child = []
                current.append({'type': 'array', 'value': child})
                stack.append(current)
                current = child
                continue
            elif tag == ']':
                if not stack:
                    raise ValueError('Unbalanced OSC array.')
                current = stack.pop()
                continue
            else:
                raise ValueError(f'Unsupported OSC type tag: {tag}')
            current.append({'type': tag, 'value': value})
        if stack or pos != len(packet):
            raise ValueError('Unbalanced array or unexpected trailing OSC bytes.')
        if len(messages) >= MAX_MESSAGES:
            raise ValueError('OSC bundle exceeds 128 messages.')
        messages.append({'address': address, 'types': tags, 'arguments': args, 'timetag': timetag})

    parse(data)
    return messages


class OSCMonitor:
    """Called under the owning Session lock. No settings or packets go to cloud."""
    def __init__(self):
        self.addresses = OrderedDict()
        self.errors = 0
        self.last_error = None

    def receive(self, data, stamp, peer):
        if not data.startswith((b'/', b'#bundle')):
            return None
        try:
            messages = decode_packet(data)
        except ValueError as error:
            self.errors += 1
            self.last_error = {'message': str(error), 'time': stamp}
            return {'error': str(error)}
        for message in messages:
            address = message['address']
            previous = self.addresses.pop(address, None)
            history = previous['history'] if previous else deque(maxlen=120)
            # Keep just numeric scalar arguments for bounded plotting history.
            history.append((stamp, {i: arg['value'] for i, arg in enumerate(message['arguments'])
                                    if arg['type'] in ('i', 'f', 'd') and type(arg['value']) in (int, float)}))
            self.addresses[address] = {**message, 'count': (previous['count'] if previous else 0) + 1,
                                       'time': stamp, 'peer': peer, 'history': history}
            if len(self.addresses) > MAX_ADDRESSES:
                self.addresses.popitem(last=False)
        return {'messages': messages}

    def snapshot(self):
        return deepcopy({'addresses': [{k: v for k, v in row.items() if k != 'history'}
                                       for row in reversed(self.addresses.values())],
                         'errors': self.errors, 'lastError': self.last_error, 'limit': MAX_ADDRESSES})

    def detail(self, address, argument):
        row = self.addresses.get(address)
        return {'address': address, 'argument': argument,
                'points': [[stamp, values.get(argument)] for stamp, values in row['history']] if row else []}
