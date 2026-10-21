#!/usr/bin/env python3
"""Generate and verify the USB/BLE shared descriptor within ATT's 512-byte limit.

Run from any directory; --check verifies the checked-in header without writing.
The readable source macros remain authoritative. No HID fields are removed.
"""
import argparse
import itertools
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
HEADER = ROOT / 'features/hid_compact_map.h'


def source_bytes(no_haptics=False):
    source = '''#include "hid_features.h"
#include "hid_reports.h"
#include <stdio.h>
#define INSERT C5_HAPTIC_REPORT_MAP_BYTES,
static const unsigned char map[]={C5_HID_REPORT_MAP_WITH_HAPTIC(INSERT),C5_LAMP_REPORT_MAP_BYTES};
int main(void){return fwrite(map,1,sizeof(map),stdout)==sizeof(map)?0:1;}
'''
    if no_haptics:
        source=source.replace('#define INSERT C5_HAPTIC_REPORT_MAP_BYTES,', '#define INSERT')
    with tempfile.TemporaryDirectory(prefix='c5-hid-') as directory:
        cfile, exe = Path(directory)/'map.c', Path(directory)/'map'
        cfile.write_text(source)
        subprocess.run([os.environ.get('HOST_CC', 'cc'), '-I'+str(ROOT/'features'),
                        '-I'+str(ROOT/'platform/ch592'), str(cfile), '-o', str(exe)], check=True)
        return subprocess.check_output([str(exe)])


def parse(data):
    """Resolve global PUSH/POP and local usage pages at each main item."""
    globals_ = [0]*10
    items, stack, local = [], [], []
    i = 0
    while i < len(data):
        prefix = data[i]
        count = (0, 1, 2, 4)[prefix & 3]
        assert prefix != 0xfe and i+1+count <= len(data)
        value_bytes = data[i+1:i+1+count]
        i += count+1
        kind, tag = prefix >> 2 & 3, prefix >> 4
        value = int.from_bytes(value_bytes, 'little')
        if kind == 1:
            if tag == 10:
                stack.append(globals_[:])
            elif tag == 11:
                globals_ = stack.pop()
            else:
                assert tag < 10
                signed = tag in (1, 3) or tag == 2 and globals_[1] < 0 or tag == 4 and globals_[3] < 0
                if signed:
                    value = int.from_bytes(value_bytes, 'little', signed=True)
                globals_[tag] = value
        elif kind == 2:
            local.append((tag, value, globals_[0]))
        elif kind == 0:
            items.append((tag, value, globals_[:], local))
            local = []
        else:
            raise ValueError('Reserved HID item')
    assert not stack and not local
    return items


def encode(kind, tag, value, signed=False):
    for count in (1, 2, 4):
        if -(1 << (count*8-1)) <= value < (1 << (count*8-(1 if signed else 0))):
            return bytes([(tag << 4) | (kind << 2) | {1: 1, 2: 2, 4: 3}[count]]) + value.to_bytes(count, 'little', signed=value < 0)
    raise ValueError('HID item does not fit')


def optimize(items, push=-1, pop=-1):
    current, result, saved = [0]*10, bytearray(), None
    for index, (tag, value, desired, local) in enumerate(items):
        if index == push:
            result.append(0xa4)
            saved = current[:]
        if index == pop:
            result.append(0xb4)
            current = saved[:]
        # A Collection uses only Usage Page; End Collection needs no globals.
        required = [0] if tag == 10 else [] if tag == 12 else range(10)
        for key in required:
            if current[key] != desired[key]:
                signed = key in (1, 3) or key == 2 and desired[1] < 0 or key == 4 and desired[3] < 0
                result += encode(1, key, desired[key], signed)
                current[key] = desired[key]
        index = 0
        while index < len(local):
            local_tag, local_value, page = local[index]
            assert local_tag not in (0, 1, 2) or page == current[0]
            end = index+1
            if local_tag == 0:
                while end < len(local) and local[end] == (0, local_value+end-index, page):
                    end += 1
            if end-index >= 3:
                result += encode(2, 1, local_value)+encode(2, 2, local[end-1][1])
                index = end
            else:
                result += encode(2, local_tag, local_value)
                index += 1
        result += bytes([0xc0]) if tag == 12 else encode(0, tag, value)
    return bytes(result)


def canonical(items):
    """Report offset, collection path, usages, flags and every numeric global.

    Expanding usage ranges catches ordering/duplication errors that byte-count
    tests miss, including the eight repeated RGBI usage groups.
    """
    parents, offsets, result = [], {}, []
    for tag, value, globals_, local in items:
        usages, minimum = [], None
        for local_tag, local_value, page in local:
            assert local_tag in (0, 1, 2)
            full = local_value if local_value > 0xffff else page << 16 | local_value
            if local_tag == 0:
                usages.append(full)
            elif local_tag == 1:
                minimum = full
            else:
                assert minimum is not None and minimum <= full
                usages.extend(range(minimum, full+1))
                minimum = None
        assert minimum is None
        if tag == 10:
            parents.append((value, tuple(usages)))
        elif tag == 12:
            parents.pop()
        else:
            assert tag in (8, 9, 11)
            key = (tag, globals_[8])
            offset = offsets.get(key, 0)
            result.append((key, offset, tuple(parents), value, tuple(globals_[1:]), tuple(usages)))
            offsets[key] = offset+globals_[7]*globals_[9]
    assert not parents
    return sorted(result)


def generate(original):
    items = parse(original)
    groups, group, depth = [], [], 0
    for item in items:
        group.append(item)
        depth += 1 if item[0] == 10 else -1 if item[0] == 12 else 0
        if not depth:
            groups.append(group)
            group = []
    candidates = ((optimize([item for i in order for item in groups[i]]), order)
                  for order in itertools.permutations(range(len(groups))))
    _, order = min(candidates, key=lambda candidate: len(candidate[0]))
    ordered = [item for i in order for item in groups[i]]
    # One stack pair is sufficient and keeps firmware parser complexity low.
    candidates = (optimize(ordered, start, end) for start in range(len(ordered))
                  for end in range(start+1, len(ordered)))
    compact = min(candidates, key=len)
    assert len(compact) <= 512, f'ATT Report Map too long: {len(compact)}'
    assert canonical(parse(compact)) == canonical(items), 'HID field semantics differ'
    lines = ['#ifndef C5_HID_COMPACT_MAP_H', '#define C5_HID_COMPACT_MAP_H',
             '/* Generated by compact_report_map.py from the readable HID macros.',
             f' * {len(compact)} bytes; USB and BLE use the same fields and collection paths.',
             ' * Re-run the generator after changing any source descriptor. */',
             '#define C5_COMPACT_HID_REPORT_MAP_BYTES \\']
    for start in range(0, len(compact), 16):
        part = ','.join(f'0x{value:02x}' for value in compact[start:start+16])
        lines.append('  '+part+(', \\' if start+16 < len(compact) else ''))
    lines += ['#endif', '']
    return '\n'.join(lines), compact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--no-haptic', action='store_true')
    args = parser.parse_args()
    original = source_bytes(args.no_haptic)
    content, compact = generate(original)
    header = HEADER
    if args.no_haptic:
        header=HEADER.with_name('hid_no_haptic_map.h')
        content=content.replace('C5_HID_COMPACT_MAP_H','C5_HID_NO_HAPTIC_MAP_H').replace('C5_COMPACT_HID_REPORT_MAP_BYTES','C5_NO_HAPTIC_HID_REPORT_MAP_BYTES')
    if args.check:
        assert header.read_text() == content, 'Generated header is stale; run without --check'
    else:
        header.write_text(content)
    print(f'HID map: {len(original)} -> {len(compact)} bytes; all report fields/collections/units/usages equivalent')


if __name__ == '__main__':
    main()
