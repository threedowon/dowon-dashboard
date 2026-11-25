"""ENTTEC USB PRO label 6 output, full 512-slot universe (API v1.44)."""


def settings(raw):
    brightness, mix = raw.get('brightness', 50), raw.get('mix', 50)
    for name, value in [('Brightness', brightness), ('Cool mix', mix)]:
        if type(value) is not int or not 0 <= value <= 100:
            raise ValueError(name + ' must be an integer from 0 to 100.')
    on = raw.get('on', [False] * 4)
    if not isinstance(on, list) or len(on) != 4 or any(type(v) is not bool for v in on):
        raise ValueError('Provide four on/off values.')
    return {'brightness': brightness, 'mix': mix, 'on': on[:]}


def frame(profile, raw):
    state = settings(raw)
    data = bytearray(513)  # start code 0 followed by 512 channels
    level = round(255 * state['brightness'] / 100)
    cool = round(level * state['mix'] / 100)
    pair = (level - cool, cool)
    if profile.get('channelOrder', 'ww-cw') == 'cw-ww':
        pair = pair[::-1]
    for i, enabled in enumerate(state['on']):
        address = profile.get('startAddress', 1) + i * 2
        if enabled:
            data[address:address + 2] = bytes(pair)
    return b'\x7e\x06\x01\x02' + data + b'\xe7'
