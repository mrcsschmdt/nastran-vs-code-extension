"""Cross-check the extension's small/large/free field writer with pyNastran.

Usage:
    npm run compile
    node out/test/roundtrip.js samples/model.bdf <outDir>
    python test/roundtrip_pynastran.py <outDir>

Reads original.bdf, small.bdf, large.bdf and free.bdf with pyNastran and
checks that every card has the same field values (reals compared with a
tolerance that matches the field width).
"""
import math
import os
import sys

from pyNastran.bdf.bdf import BDF


def card_fields(path):
    model = BDF(debug=None)
    model.read_bdf(path, xref=False, punch=False, validate=False)
    out = {}
    groups = [
        model.nodes, model.elements, model.rigid_elements, model.masses, model.properties,
        model.materials, model.coords, model.params,
    ]
    for group in groups:
        for key, card in group.items():
            if getattr(card, 'type', None) == 'CORD2R' and key == 0:
                continue
            out[(card.type, key)] = card.raw_fields()
    for dct in (model.loads, model.spcs):
        for sid, cards in dct.items():
            for i, card in enumerate(cards):
                out[(card.type, sid, i)] = card.raw_fields()
    return out


def same(a, b, rtol):
    if isinstance(a, float) or isinstance(b, float):
        if a is None or b is None:
            return (a or 0.0) == (b or 0.0)
        return math.isclose(float(a), float(b), rel_tol=rtol, abs_tol=1e-30)
    return a == b


def main(out_dir):
    ref = card_fields(os.path.join(out_dir, 'original.bdf'))
    ok = True
    # small field keeps 3-6 significant digits depending on sign and exponent
    for fmt, rtol in (('small', 6e-3), ('large', 1e-12), ('free', 1e-12)):
        got = card_fields(os.path.join(out_dir, f'{fmt}.bdf'))
        if set(got) != set(ref):
            print(f'[{fmt}] different card set: {set(ref) ^ set(got)}')
            ok = False
        for key, fields in ref.items():
            other = got.get(key)
            if other is None:
                continue
            n = max(len(fields), len(other))
            f1 = list(fields) + [None] * (n - len(fields))
            f2 = list(other) + [None] * (n - len(other))
            if not all(same(x, y, rtol) for x, y in zip(f1, f2)):
                print(f'[{fmt}] {key}:\n   original {fields}\n   {fmt:8s} {other}')
                ok = False
        print(f'[{fmt}] {len(got)} cards compared')
    print('OK' if ok else 'MISMATCH')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
