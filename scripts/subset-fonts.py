#!/usr/bin/env python3
"""scripts/subset-fonts.py: how the four web font files in fonts/ were made from the Fontsource "latin" variable files (@fontsource-variable/inter, manrope and archivo,
SIL OFL 1.1, see fonts/LICENSE-OFL.txt and fonts/LICENSE-archivo-OFL.txt). It exists because the fonts were the heaviest thing on the first screen (192 KB for the two Archivo files alone).

Two things are trimmed, nothing else (the same code points, the same glyph outlines, hinting and names; text width differs by under 0.03 per cent):
  1. variation axes are cut to the range the site's CSS can reach (a variable font carries the data for every weight and width, and nobody can reach most of it);
  2. layout features the site never switches on (fractions: frac, numr, dnom) are removed. kern, ccmp, locl, liga and the number forms (tnum, pnum) stay.

  file                               axes kept                                  why that range                                           bytes before -> after
  inter-latin-wght-normal.woff2      wght 400-800                               css/tokens.css --fw-* are 400 to 800 (dashboard)         48,256 -> 34,608
  manrope-latin-wght-normal.woff2    wght 400-800                               same (dashboard headings)                                24,836 -> 22,884
  archivo-latin-wdth-normal.woff2    wght 400-800, wdth 100-125                 body 400-600, display 650 at 108, labels 600 at 125      90,104 -> 54,780
  archivo-latin-wdth-italic.woff2    PINNED wght 800, wdth 125 (a static font)  its only user is .lp-logovoice (css/landing.css)         101,676 -> 14,404

If .lp-logovoice (or any other italic text) changes weight or width, or the CSS starts to use a weight or width outside the ranges above, change the numbers here and run the
script again: tests/unit/fonts.test.mjs checks the one thing that would silently go wrong (the italic's pin) and the size of every font file.

  pip install fonttools brotli
  python3 scripts/subset-fonts.py inter=path/to/inter-latin-wght-normal.woff2 manrope=path/to/manrope-latin-wght-normal.woff2     (the ORIGINAL Fontsource files)
  python3 scripts/subset-fonts.py archivo                                                                                          (reads the originals kept in docs/landing-v5-mock/fonts/)
Each run writes the trimmed file into fonts/ over the one with the same name.
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCK = os.path.join(ROOT, 'docs', 'landing-v5-mock', 'fonts')
ARCHIVO_FEATURES = ['kern', 'ccmp', 'locl', 'liga', 'tnum', 'pnum', 'rvrn']
JOBS = {
    'inter-latin-wght-normal.woff2': ({'wght': (400, 800)}, ['kern', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'tnum', 'pnum']),
    'manrope-latin-wght-normal.woff2': ({'wght': (400, 800)}, ['kern', 'calt', 'liga', 'locl', 'tnum', 'pnum']),
    'archivo-latin-wdth-normal.woff2': ({'wght': (400, 800), 'wdth': (100, 125)}, ARCHIVO_FEATURES),
    'archivo-latin-wdth-italic.woff2': ({'wght': 800, 'wdth': 125}, ARCHIVO_FEATURES),
}


def build(source):
    name = os.path.basename(source)
    if name not in JOBS:
        sys.exit(f'{name}: expected one of {", ".join(JOBS)}')
    limits, features = JOBS[name]
    font = instancer.instantiateVariableFont(TTFont(source), limits, inplace=False)
    font.flavor = 'woff2'
    tmp = os.path.join(ROOT, 'fonts', name + '.tmp')
    font.save(tmp)
    font = TTFont(tmp)
    options = subset.Options()
    options.layout_features = features
    options.hinting = True
    options.name_IDs = ['*']
    options.name_legacy = True
    options.name_languages = ['*']
    options.notdef_outline = True
    options.glyph_names = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=list(font.getBestCmap().keys()))  # every code point the font already has
    subsetter.subset(font)
    font.flavor = 'woff2'
    out = os.path.join(ROOT, 'fonts', name)
    font.save(out)
    os.remove(tmp)
    print(f'{name}: {os.path.getsize(source):,} -> {os.path.getsize(out):,} bytes')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for arg in sys.argv[1:]:
        if arg == 'archivo':
            for name in ('archivo-latin-wdth-normal.woff2', 'archivo-latin-wdth-italic.woff2'):
                build(os.path.join(MOCK, name))
        else:
            build(arg.split('=', 1)[-1])
