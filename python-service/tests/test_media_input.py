import tempfile
import unittest
from pathlib import Path
from media_input import copy_media_input


class MediaInputTests(unittest.TestCase):
    def test_only_shared_regular_files_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shared = root / 'shared'
            shared.mkdir()
            source = shared / 'source.mp4'
            source.write_bytes(b'media')
            target = shared / 'copy.mp4'
            self.assertEqual(copy_media_input(str(source), target, shared).read_bytes(), b'media')
            outside = root / 'secret'
            outside.write_bytes(b'private')
            for value in [str(outside), str(shared), 'file://' + str(outside), 'http://127.0.0.1/a', 'https://example.com/redirect', '']:
                with self.assertRaises((ValueError, FileNotFoundError)):
                    copy_media_input(value, target, shared)
            with self.assertRaises(ValueError):
                copy_media_input(str(source), outside, shared)


if __name__ == '__main__':
    unittest.main()
