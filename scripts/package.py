"""Package only the extension directory; never include workspace metadata or user data."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / 'extension'
manifest = json.loads((source / 'manifest.json').read_text())
destination = root / 'dist' / f'ama-{manifest["version"]}.zip'
destination.parent.mkdir(exist_ok=True)
files = sorted(path for path in source.rglob('*') if path.is_file())
allowed = {'.json', '.js', '.css', '.html', '.png', '.svg'}
for path in files:
    if path.suffix not in allowed or path.is_symlink():
        raise ValueError(f'Unexpected package file: {path}')
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, path.relative_to(source))
with ZipFile(destination) as archive:
    assert archive.testzip() is None
    assert 'manifest.json' in archive.namelist()
    packed = json.loads(archive.read('manifest.json'))
    assert packed == manifest
print(f'{destination}\n{len(files)} files, {destination.stat().st_size:,} bytes; ZIP contents verified.')
