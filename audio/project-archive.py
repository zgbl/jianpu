"""Portable project ZIP I/O. Only project assets are accepted; no model files."""
import json
import re
import stat
import sys
import zipfile
from pathlib import Path

LIMIT = 2 * 1024 ** 3
PATTERN = re.compile(r'^(manifest\.json|score/edited\.jpu|state/workspace\.json|audio/original\.(mp3|wav|m4a|flac|ogg|audio)|runs/[a-f0-9-]{36}/(clip\.wav|vocals\.wav|drums\.wav|bass\.wav|other\.wav|guitar\.wav|piano\.wav|stems\.json|key-analysis\.json|lyrics\.json|lyrics-alignment\.json|intro-melody\.json|result\.json|recognized\.jpu|params\.json))$')

def unpack(source, destination):
    folder = Path(destination)
    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        if not infos or len(infos) > 256:
            raise ValueError('工程文件数量不合法')
        names = set()
        total = 0
        for info in infos:
            name = info.filename
            mode = info.external_attr >> 16
            if not PATTERN.fullmatch(name) or name in names or stat.S_ISLNK(mode) or info.flag_bits & 1:
                raise ValueError('工程包包含不合法路径、重复文件或加密文件')
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError('不支持的工程压缩方式')
            total += info.file_size
            if total > LIMIT or info.file_size > 512 * 1024 ** 2:
                raise ValueError('工程解压体积超过限制')
            if name.endswith(('.json', '.jpu')) and info.file_size > 32 * 1024 ** 2:
                raise ValueError('工程数据文件过大')
            names.add(name)
        if not {'manifest.json', 'score/edited.jpu', 'state/workspace.json'}.issubset(names):
            raise ValueError('缺少工程清单、修订谱或工作状态')
        written = 0
        for info in infos:
            target = folder / info.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src, target.open('wb') as dst:
                while chunk := src.read(1024 * 1024):
                    written += len(chunk)
                    if written > LIMIT:
                        raise ValueError('工程解压体积超过限制')
                    dst.write(chunk)

def pack(folder, output):
    root = Path(folder)
    manifest = json.loads((root / 'manifest.json').read_text())
    names = ['manifest.json'] + [asset['path'] for asset in manifest['assets']]
    if len(names) != len(set(names)):
        raise ValueError('工程文件重复')
    with zipfile.ZipFile(output, 'w', allowZip64=False) as archive:
        for name in names:
            if not PATTERN.fullmatch(name):
                raise ValueError('工程文件路径不合法')
            path = root / name
            if path.is_symlink() or not path.is_file():
                raise ValueError('工程文件缺失')
            compression = zipfile.ZIP_STORED if name.endswith(('.mp3', '.m4a', '.flac', '.ogg')) else zipfile.ZIP_DEFLATED
            archive.write(path, name, compress_type=compression, compresslevel=1)

if __name__ == '__main__':
    try:
        if sys.argv[1] == 'pack':
            pack(sys.argv[2], sys.argv[3])
        elif sys.argv[1] == 'unpack':
            unpack(sys.argv[2], sys.argv[3])
        else:
            raise ValueError('未知工程操作')
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
