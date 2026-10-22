"""Release regression checks: provenance, variants and download integrity."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location('firmware_release', Path(__file__).resolve().parents[1] / 'firmware_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
COMMIT = '12345678' * 5


class FirmwareReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'web').mkdir()
        (self.root / 'web/package.json').write_text('{"version":"1.15.0"}', encoding='utf-8')
        source = self.root / 'firmware/platform/ch592'
        source.mkdir(parents=True)
        (source / 'ble_transport.c').write_text('static const uint8_t firmware_version[] = "1.15.0";', encoding='utf-8')
        (self.root / 'firmware/README.md').write_text('# 烧录说明\n保留 DataFlash。\n', encoding='utf-8')
        for variant in release.VARIANTS:
            folder = self.root / 'firmware/build' / variant
            folder.mkdir(parents=True)
            for ext in ('hex', 'bin', 'elf', 'map'):
                (folder / f'KeyDeck-CH592F-{variant}.{ext}').write_bytes(f'{variant}-{ext}'.encode())
        self.info = release.metadata(self.root, 'v1.15.0', COMMIT)

    def test_tags_match_the_compiled_firmware_version(self):
        self.assertFalse(self.info['prerelease'])
        candidate = release.metadata(self.root, 'v1.15.0-rc.1', COMMIT)
        self.assertTrue(candidate['prerelease'])
        snapshot = release.metadata(self.root, commit=COMMIT, run_number='12')
        self.assertEqual(snapshot['tag'], 'v1.15.0-dev.12.12345678')
        self.assertTrue(snapshot['prerelease'])
        for tag in ('v1.16.0', 'v1.15.0/invalid', 'v1.15.0\ntag=evil'):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release.metadata(self.root, tag, COMMIT)
        source = self.root / 'firmware/platform/ch592/ble_transport.c'
        source.write_text('static const uint8_t firmware_version[] = "1.14.0";', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'must match'):
            release.metadata(self.root, 'v1.15.0', COMMIT)

    def test_both_variants_are_complete_and_every_attachment_is_checksummed(self):
        output = self.root / 'release-dist'
        manifest = release.package(self.root, output, self.info)
        self.assertEqual(manifest['commit'], COMMIT)
        self.assertFalse(manifest['hardwareTested'])
        for variant in release.VARIANTS:
            entry = manifest['variants'][variant]
            self.assertEqual(entry['haptics'], variant == 'haptic')
            self.assertEqual(len(entry['artifacts']), 4)
            with ZipFile(output / f'KeyDeck-CH592F-{variant}-v1.15.0.zip') as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(json.loads(archive.read('manifest.json')), manifest)
                self.assertIn('firmware-guide.md', archive.namelist())
                for artifact in entry['artifacts']:
                    data = archive.read(artifact['file'])
                    self.assertEqual(hashlib.sha256(data).hexdigest(), artifact['sha256'])
                    self.assertEqual(len(data), artifact['bytes'])
                    if artifact['file'].endswith(('.hex', '.bin')):
                        self.assertEqual((output / artifact['file']).read_bytes(), data)
        listed = set()
        for line in (output / 'SHA256SUMS.txt').read_text().splitlines():
            expected, name = line.split('  ', 1)
            self.assertEqual(release.digest(output / name), expected)
            listed.add(name)
        self.assertEqual(listed, {p.name for p in output.iterdir()} - {'SHA256SUMS.txt', 'release-notes.md'})

    def test_missing_matrix_artifact_never_falls_back_to_an_old_release(self):
        missing = self.root / 'firmware/build/no-haptic/KeyDeck-CH592F-no-haptic.bin'
        missing.unlink()
        old = self.root / 'releases/1.15.0'
        old.mkdir(parents=True)
        (old / missing.name).write_bytes(b'stale-release')
        output = self.root / 'release-dist'
        with self.assertRaises(FileNotFoundError):
            release.package(self.root, output, self.info)
        self.assertFalse(output.exists())

    def test_empty_artifact_and_dirty_output_are_rejected(self):
        output = self.root / 'release-dist'
        output.mkdir()
        (output / 'old.bin').write_bytes(b'stale')
        with self.assertRaisesRegex(ValueError, 'must be empty'):
            release.package(self.root, output, self.info)
        (self.root / 'firmware/build/haptic/KeyDeck-CH592F-haptic.hex').write_bytes(b'')
        with self.assertRaisesRegex(ValueError, 'Empty compiled artifact'):
            release.package(self.root, self.root / 'other-output', self.info)


if __name__ == '__main__':
    unittest.main()
