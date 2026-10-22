"""Assemble a GitHub firmware release from this run's two compiled variants."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
VARIANTS = ('haptic', 'no-haptic')
SDK_COMMIT = 'a46e0086f1ffb5e5502703970bff94888e67f4cb'
TOOLCHAIN = 'WCH MounRiver 1.91 / GCC 8.2.0'


def metadata(root, tag='', commit=None, run_number='0', run_url=None):
    version = json.loads((root / 'web/package.json').read_text(encoding='utf-8'))['version']
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', version):
        raise ValueError('web/package.json must contain a three-part numeric version')
    source = (root / 'firmware/platform/ch592/ble_transport.c').read_text(encoding='utf-8')
    match = re.search(r'firmware_version\[\]\s*=\s*"([^"]+)"', source)
    if not match or match[1] != version:
        raise ValueError('Firmware BLE version and web/package.json version must match')
    commit = commit or subprocess.check_output(
        ['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('A full source commit SHA is required')
    if not tag:
        if not re.fullmatch(r'\d+', run_number):
            raise ValueError('Invalid Actions run number')
        tag = f'v{version}-dev.{run_number}.{commit[:8]}'
    if not re.fullmatch(rf'v{re.escape(version)}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?', tag):
        raise ValueError(f'Release tag must match firmware version v{version}, optionally with a prerelease suffix')
    return dict(version=version, tag=tag, commit=commit, prerelease='-' in tag, runUrl=run_url)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def package(root, output, info):
    # Read all required files before writing anything: never package a stale
    # committed releases/ image when a matrix build failed or is missing.
    compiled = {}
    for variant in VARIANTS:
        files = {}
        for ext in ('hex', 'bin', 'elf', 'map'):
            name = f'KeyDeck-CH592F-{variant}.{ext}'
            data = (root / 'firmware/build' / variant / name).read_bytes()
            if not data:
                raise ValueError(f'Empty compiled artifact: {name}')
            files[name] = data
        compiled[variant] = files
    if output.exists() and any(output.iterdir()):
        raise ValueError('Release output directory must be empty')
    output.mkdir(parents=True, exist_ok=True)
    guide = (root / 'firmware/README.md').read_bytes()
    (output / 'firmware-guide.md').write_bytes(guide)
    manifest = dict(**info, sdkCommit=SDK_COMMIT, toolchain=TOOLCHAIN,
                    hardwareTested=False, variants={})
    for variant, files in compiled.items():
        artifacts = []
        for name, data in files.items():
            artifacts.append(dict(file=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
            if name.endswith(('.hex', '.bin')):
                (output / name).write_bytes(data)
        manifest['variants'][variant] = dict(haptics=variant == 'haptic', artifacts=artifacts)
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    (output / 'manifest.json').write_bytes(manifest_bytes)
    for variant, files in compiled.items():
        with ZipFile(output / f'KeyDeck-CH592F-{variant}-{info["tag"]}.zip', 'w', ZIP_DEFLATED) as archive:
            for name, data in files.items():
                archive.writestr(name, data)
            archive.writestr('manifest.json', manifest_bytes)
            archive.writestr('firmware-guide.md', guide)
    notes = f'''基于CH592F的自定义小键盘 · {info["tag"]}

| 版本 | 适用硬件 | 下载 |
| --- | --- | --- |
| haptic · 带震动 | DRV2605L + AAC0809 LRA | `KeyDeck-CH592F-haptic.hex` |
| no-haptic · 无震动 | 未装马达及驱动 | `KeyDeck-CH592F-no-haptic.hex` |

优先使用 HEX；BIN 应用起始地址为 `0x00000000`。ZIP 同时包含 HEX、BIN、ELF、MAP、构建信息与烧录说明。

本次下载文件由 GitHub Actions 从提交 `{info["commit"]}` 编译生成。SDK 固定到 `{SDK_COMMIT}`，工具链为 {TOOLCHAIN}。
编译及软件测试通过；发布不代表两种构建均完成实物验收。

校验下载：在所有附件所在目录运行 `sha256sum --check SHA256SUMS.txt`；Windows 可用 `Get-FileHash 文件名 -Algorithm SHA256` 对照校验值。
烧录前导出配置，并阅读 `firmware-guide.md`，选择与硬件对应的版本。
'''
    if info.get('runUrl'):
        notes += f'\n[本次编译与测试记录]({info["runUrl"]})\n'
    (output / 'release-notes.md').write_text(notes, encoding='utf-8', newline='\n')
    # Notes are a release body, not a downloadable asset. The checksum list
    # covers every attachment, including the two complete archives.
    attachments = sorted(p for p in output.iterdir() if p.name != 'release-notes.md')
    (output / 'SHA256SUMS.txt').write_text(
        ''.join(f'{digest(path)}  {path.name}\n' for path in attachments), encoding='utf-8', newline='\n')
    return manifest


def main():
    run_url = None
    if os.environ.get('GITHUB_REPOSITORY') and os.environ.get('GITHUB_RUN_ID'):
        run_url = f'https://github.com/{os.environ["GITHUB_REPOSITORY"]}/actions/runs/{os.environ["GITHUB_RUN_ID"]}'
    actual_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if os.environ.get('RELEASE_COMMIT') and os.environ['RELEASE_COMMIT'] != actual_commit:
        raise ValueError('Checked-out source does not match the requested release commit')
    info = metadata(ROOT, os.environ.get('RELEASE_TAG', ''), actual_commit,
                    os.environ.get('GITHUB_RUN_NUMBER', '0'), run_url)
    if sys.argv[1:] == ['prepare']:
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as stream:
                stream.write(f'tag={info["tag"]}\ncommit={info["commit"]}\nprerelease={str(info["prerelease"]).lower()}\n')
        print(json.dumps(info, ensure_ascii=False))
    elif sys.argv[1:] == ['package']:
        package(ROOT, ROOT / 'release-dist', info)
        print(f'Packaged both variants for {info["tag"]} from {info["commit"]}')
    else:
        raise SystemExit('Usage: python scripts/firmware_release.py prepare|package')


if __name__ == '__main__':
    main()
