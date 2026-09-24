#!/usr/bin/env python3
"""Applique la substitution terracotta a une variante dense livree par designer.

    python3 scripts/icon-src/derive-terracotta.py \
        design/icon-concepts/concept-2-dense.svg \
        scripts/icon-src/concept-2-terracotta-dense.svg

Regle appliquee, section "Variante dense" de design/ICON_PLAN.md, dernier point :
fond `#B4552B`, secteur terracotta en `#F6F1E7`, le reste inchange. Exactement deux
attributs `fill` permutes, et le script echoue s'il n'en trouve pas exactement deux :
une dense redessinee par designer ne doit pas passer en silence.

Pourquoi un script et pas une edition a la main : les fichiers de design/ sont le
perimetre de designer, on ne les modifie pas et on ne les recopie pas non plus a la
main. La derivation reste rejouable a l'identique quand la dense evolue.
"""

import pathlib
import sys

CREAM = '#F6F1E7'
TERRACOTTA = '#B4552B'


def derive(text: str) -> str:
    out, done = [], []
    for line in text.split('\n'):
        if '<rect' in line and f'fill="{CREAM}"' in line:
            line = line.replace(f'fill="{CREAM}"', f'fill="{TERRACOTTA}"')
            done.append('fond')
        elif '<path' in line and f'fill="{TERRACOTTA}"' in line:
            line = line.replace(f'fill="{TERRACOTTA}"', f'fill="{CREAM}"')
            done.append('secteur')
        out.append(line)
    if done != ['fond', 'secteur']:
        raise SystemExit(
            f'Substitution non conforme : {done or "aucune"}. Attendu un <rect> plein '
            f'cadre en {CREAM} puis un <path> en {TERRACOTTA}. Verifier la dense livree.'
        )
    return '\n'.join(out)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    source, target = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    body = derive(source.read_text())
    header = (
        '<!-- DERIVE, ne pas editer a la main.\n'
        f'     Source : {source} (perimetre de designer).\n'
        '     Transformation : substitution terracotta de design/ICON_PLAN.md, section\n'
        '     "Variante dense", dernier point. Exactement deux attributs fill permutes :\n'
        f'       - le <rect> plein cadre : {CREAM} -> {TERRACOTTA}\n'
        f'       - le <path> du secteur terracotta : {TERRACOTTA} -> {CREAM}\n'
        '     Les ecarts angulaires et le trou central sont des VIDES, pas des formes :\n'
        '     ils suivent donc le fond automatiquement, conformement a la ligne "Ecarts\n'
        '     et trou : couleur du fond" du tableau de couleurs. Miel et sauge inchanges.\n'
        f'     Re-deriver : python3 {pathlib.Path(__file__).name.join(("scripts/icon-src/", ""))} {source} {target}\n'
        '     Ne sert QUE le favicon.ico aux tailles 16 et 32. -->\n'
    )
    cut = body.index('\n') + 1
    target.write_text(body[:cut] + header + body[cut:])
    print(f'{target} derive depuis {source}')


if __name__ == '__main__':
    main()
