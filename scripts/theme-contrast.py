"""Check the extension's field shading colors against VS Code color themes.

Blends the translucent shading colors from package.json over each theme's
editor background, line highlight and hover highlight, and reports:

  step    brightness difference between shaded and plain fields
          (normal lines / the active line). Around 18-22 reads well; below
          about 8 the fields are hard to tell apart.
  hover   whether the theme's hover highlight is blue or a neutral gray, and
          whether a hovered plain field ends up looking like a shaded field.

Usage:
    python scripts/theme-contrast.py                 # built-in + installed themes
    python scripts/theme-contrast.py <ext-dir> ...   # specific extension folders
    python scripts/theme-contrast.py --min-step 8    # exit 1 if any step is lower

An extension folder is any folder whose package.json contributes "themes".
"""
import argparse
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Workbench defaults used when a theme does not set a color.
FALLBACK = {
    'vs-dark': {'editor.background': '#1E1E1E', 'editor.hoverHighlightBackground': '#264f7840'},
    'vs': {'editor.background': '#FFFFFF', 'editor.hoverHighlightBackground': '#add6ff26'},
    'hc-black': {'editor.background': '#000000', 'editor.hoverHighlightBackground': '#ADD6FF26'},
    'hc-light': {'editor.background': '#FFFFFF', 'editor.hoverHighlightBackground': '#0F4A8540'},
}
KIND = {'vs-dark': 'dark', 'vs': 'light', 'hc-black': 'highContrast', 'hc-light': 'highContrastLight'}
# Must match blueHoverColor() in src/features/hoverTheme.ts
BLUE_HOVER = {'dark': '#3994BC33', 'light': '#3994BC26', 'highContrast': '#3994BC55', 'highContrastLight': '#3994BC26'}


def strip_jsonc(txt):
    """Remove // and /* */ comments that are outside of strings."""
    out, i, n, in_str = [], 0, len(txt), False
    while i < n:
        ch = txt[i]
        if in_str:
            out.append(ch)
            if ch == '\\' and i + 1 < n:
                out.append(txt[i + 1])
                i += 1
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
            out.append(ch)
        elif txt.startswith('//', i):
            while i < n and txt[i] not in '\r\n':
                i += 1
            continue
        elif txt.startswith('/*', i):
            end = txt.find('*/', i + 2)
            i = n if end < 0 else end + 2
            continue
        else:
            out.append(ch)
        i += 1
    return ''.join(out)


def read_json(path):
    txt = strip_jsonc(open(path, encoding='utf-8-sig').read())
    txt = re.sub(r',(\s*[}\]])', r'\1', txt)  # trailing commas
    return json.loads(txt)


def theme_colors(path, depth=0):
    d = read_json(path)
    colors = {}
    inc = d.get('include')
    if inc and depth < 10 and inc.endswith('.json'):
        colors.update(theme_colors(os.path.join(os.path.dirname(path), inc), depth + 1))
    colors.update({k: v for k, v in (d.get('colors') or {}).items() if isinstance(v, str)})
    return colors


def rgba(h):
    h = h.strip().lstrip('#')
    if len(h) in (3, 4):
        h = ''.join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    return r, g, b, a


def over(top, under):
    r, g, b, a = rgba(top)
    return tuple(round(under[i] * (1 - a) + (r, g, b)[i] * a) for i in range(3))


def lum(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def hx(c):
    return '#%02x%02x%02x' % c


def hue_label(color):
    r, g, b, _ = rgba(color)
    if max(r, g, b) - min(r, g, b) < 24:
        return 'gray'
    return 'blue' if b - max(r, g) > 25 else 'tinted'


def is_blue(color):
    return hue_label(color) == 'blue'


def extension_dirs():
    pats = [
        os.path.expandvars(r'%LOCALAPPDATA%\Programs\Microsoft VS Code\*\resources\app\extensions\*'),
        os.path.expandvars(r'%LOCALAPPDATA%\Programs\Microsoft VS Code\resources\app\extensions\*'),
        '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/*',
        '/usr/share/code/resources/app/extensions/*',
        '/usr/lib/code/extensions/*',
        os.path.expanduser('~/.vscode/extensions/*'),
    ]
    seen = set()
    for pat in pats:
        for d in sorted(glob.glob(pat)):
            if os.path.isfile(os.path.join(d, 'package.json')) and d not in seen:
                seen.add(d)
                yield d


def themes_in(ext_dir):
    try:
        pkg = read_json(os.path.join(ext_dir, 'package.json'))
    except (OSError, ValueError):
        return
    for t in (pkg.get('contributes') or {}).get('themes') or []:
        path = os.path.join(ext_dir, t.get('path', ''))
        if path.endswith('.json') and os.path.isfile(path) and t.get('uiTheme') in FALLBACK:
            yield t.get('id') or t.get('label'), t['uiTheme'], path


def shading_colors():
    pkg = json.load(open(os.path.join(ROOT, 'package.json'), encoding='utf8'))
    colors = {c['id']: c['defaults'] for c in pkg['contributes']['colors']}
    return colors['nastran.fieldShadingBackground'], colors['nastran.fieldShadingActiveLineBackground']


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('dirs', nargs='*', help='extension folders (default: built-in and installed)')
    ap.add_argument('--min-step', type=float, default=0, help='fail if a shading step is below this')
    args = ap.parse_args()

    normal, active = shading_colors()
    dirs = args.dirs or list(extension_dirs())
    rows, seen, failures = [], set(), 0
    for d in dirs:
        for name, ui, path in themes_in(d):
            if name in seen:
                continue
            seen.add(name)
            try:
                c = dict(FALLBACK[ui])
                c.update(theme_colors(path))
                kind = KIND[ui]
                key = kind if kind in normal else ('light' if kind == 'highContrastLight' else 'dark')
                bg = rgba(c['editor.background'])[:3]
                line_hl = c.get('editor.lineHighlightBackground')
                base = over(line_hl, bg) if line_hl else bg
                n_sh = over(normal[key], bg)
                a_sh = over(active[key], base)
                step_n = abs(lum(n_sh) - lum(bg))
                step_a = abs(lum(a_sh) - lum(base))
                hover = c['editor.hoverHighlightBackground']
                hovered_plain = over(hover, base)
                blends = abs(lum(hovered_plain) - lum(a_sh)) < 6
                fixed_plain = over(BLUE_HOVER[kind], base)
            except (KeyError, ValueError) as e:
                rows.append((name, ui, f'could not evaluate ({e})'))
                continue
            if step_n < args.min_step or step_a < args.min_step:
                failures += 1
            hover_txt = hue_label(hover) + (', BLENDS' if blends else '')
            fix = f' -> blue cmd {hx(fixed_plain)}' if not is_blue(hover) else ''
            rows.append((name, ui, f'bg {hx(bg)}  step {step_n:4.0f} / {step_a:4.0f}  hover {hover:10s} {hover_txt}{fix}'))

    w = max((len(r[0]) for r in rows), default=10)
    for name, ui, txt in sorted(rows, key=lambda r: (r[1], r[0])):
        print(f'{name:{w}s}  {ui:8s}  {txt}')
    print(f'\n{len(rows)} themes checked; shading step = normal / active line.')
    if args.min_step:
        print(f'{failures} theme(s) below --min-step {args.min_step}')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
