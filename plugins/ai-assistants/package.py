#!/usr/bin/env python3
"""Build independent universal provider archives from declarative manifests."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
for manifest in sorted((Path(__file__).parent / "packages").glob("*/.tabularium")):
    data = json.loads(manifest.read_text())
    target = args.output / f"{data['id']}-{data['version']}-universal.zip"
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        archive.write(manifest, ".tabularium")
        archive.write(Path(__file__).resolve().parents[2] / "LICENSE", "LICENSE")
    print(target)
