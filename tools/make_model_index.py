#!/usr/bin/env python3
"""Make an index.json for a folder of .glb models, so Nidorama can use it as a model library.

    python3 tools/make_model_index.py /path/to/models --name "My furniture" --license "CC0"

Put the folder (with the index.json this writes) anywhere a browser can fetch it, e.g. Home
Assistant's /config/www/models → http://<home-assistant>:8123/local/models/index.json, then in
Nidorama: More → Settings → Link another library. Sub-folders become categories. A picture with the
same name as a model (sofa.glb + sofa.jpg) is used as its thumbnail.

(Models copied into the Nidorama add-on's own folder, /share/nidorama/library, need no index.)
"""
import argparse, json, pathlib

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('folder')
ap.add_argument('--name', default='My model library')
ap.add_argument('--license', default='')
a = ap.parse_args()
root = pathlib.Path(a.folder)
models = []
for f in sorted(root.rglob('*.glb')):
    rel = f.relative_to(root)
    entry = {'name': f.stem.replace('_', ' ').replace('-', ' '), 'category': rel.parts[0] if len(rel.parts) > 1 else 'Models', 'file': rel.as_posix()}
    for ext in ('.jpg', '.png', '.webp'):
        if f.with_suffix(ext).exists():
            entry['thumb'] = rel.with_suffix(ext).as_posix()
            break
    models.append(entry)
(root / 'index.json').write_text(json.dumps({'name': a.name, 'license': a.license, 'models': models}, indent=1))
print(f'{len(models)} models → {root / "index.json"}')
