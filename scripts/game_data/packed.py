"""Bounded, read-only decoder for the observed Aniimo pmdata layout.

Format research: https://github.com/thethiny/Aniimo-Companion-WebApp/blob/master/tools/pmdata.py
Objects are decoded lazily. Unsupported tags fail explicitly; no fallback to raw integers.
"""
from dataclasses import dataclass
import struct


@dataclass(frozen=True)
class Ref:
    offset: int


class PackedData:
    widths = {0: 'd', 1: 'B', 3: 'H', 5: 'I'}
    types = {0: 'd', 1: 'B', 2: 'b', 3: 'H', 4: 'h', 5: 'I', 6: 'i', 7: 'I', 8: 'I', 9: 'B'}

    def __init__(self, data):
        self.data = data
        self.pool_end = 0
        while self.pool_end < len(data):
            end = data.find(b'\0', self.pool_end)
            if end < 0:
                break
            try:
                data[self.pool_end:end].decode('utf-8')
            except UnicodeDecodeError:
                break
            self.pool_end = end + 1
        self.root = self.locate_root()
        self.tables = self.object(self.root)

    def unpack(self, fmt, offset):
        size = struct.calcsize('<' + fmt)
        if offset < 0 or offset + size > len(self.data):
            raise ValueError(f'Out-of-range read at {offset}')
        return struct.unpack_from('<' + fmt, self.data, offset)

    def string(self, offset):
        if not 0 <= offset < self.pool_end or (offset and self.data[offset - 1] != 0):
            raise ValueError(f'Invalid string reference {offset}')
        end = self.data.index(b'\0', offset, self.pool_end)
        return self.data[offset:end].decode('utf-8')

    def references(self, offset):
        needle = struct.pack('<I', offset)
        start = self.pool_end
        while (start := self.data.find(needle, start)) >= 0:
            yield start
            start += 1

    def keys(self, offset):
        _, width, count, numeric = self.unpack('IBII', offset)
        if count > 200000 or numeric > count:
            raise ValueError('Invalid key count')
        if numeric:
            fmt = self.widths.get(width)
            if fmt is None:
                raise ValueError('Unknown numeric key width')
            return list(self.unpack(str(count) + fmt, offset + 13))
        return [self.string(v) for v in self.unpack(str(count) + 'I', offset + 13)]

    def locate_root(self):
        marker = self.data.find(b'\0default_map_mark_data\0', 0, self.pool_end)
        if marker < 0:
            raise ValueError('Unsupported pmdata: root marker absent')
        candidates = []
        for location in self.references(marker + 1):
            start = location
            while start >= self.pool_end + 4:
                try:
                    pointer = self.unpack('I', start - 4)[0]
                    if pointer == 0:
                        break
                    self.string(pointer)
                except ValueError:
                    break
                start -= 4
            header = start - 13
            try:
                keys = self.keys(header)
                if not {'pet_prototype_data', 'pet_evolve_data', 'pet_research_country_form_list'}.issubset(keys):
                    continue
                for shape in self.references(header):
                    for root in self.references(shape):
                        try:
                            obj = self.object(root)
                            if set(obj) == set(keys):
                                candidates.append((len(keys), root))
                        except (ValueError, struct.error, KeyError):
                            continue
            except (ValueError, struct.error, KeyError):
                continue
        if not candidates:
            raise ValueError('No validated root object')
        return max(candidates)[1]

    def object(self, ref, fields=None):
        offset = ref.offset if isinstance(ref, Ref) else ref
        shape = self.unpack('I', offset)[0]
        key_ref, type_ref, offset_ref = self.unpack('III', shape)
        keys = self.keys(key_ref)
        width = self.widths.get(self.unpack('B', offset_ref)[0])
        if width not in ('B', 'H', 'I'):
            raise ValueError('Unknown field offset width')
        offsets = self.unpack(str(len(keys)) + width, offset_ref + 1)
        tags = self.unpack(str(len(keys)) + 'B', type_ref)
        values = {}
        for i, (key, tag, relative) in enumerate(zip(keys, tags, offsets)):
            if fields is not None and key not in fields:
                continue
            shared = tag >= 100
            code = tag - 100 if shared else tag
            if code not in self.types:
                raise ValueError(f'Unsupported type {tag} in {key}')
            # Shared offsets are relative to their own offset entry, whose width
            # can be 1, 2 or 4 bytes (not always one byte).
            at = offset_ref + 1 + i * struct.calcsize('<' + width) - relative if shared else offset + relative
            value = self.unpack(self.types[code], at)[0]
            if code == 7:
                try:
                    value = self.string(value)
                except ValueError as error:
                    raise ValueError(f'{key}: {error}') from error
            elif code == 8:
                value = Ref(value)
            elif code == 9:
                value = bool(value)
            values[key] = value
        return values

    def table(self, name):
        return self.object(self.tables[name])

    def expand(self, value, depth=8):
        if not isinstance(value, Ref):
            return value
        if depth <= 0:
            raise ValueError('Nested value exceeds depth limit')
        return {k: self.expand(v, depth - 1) for k, v in self.object(value).items()}
