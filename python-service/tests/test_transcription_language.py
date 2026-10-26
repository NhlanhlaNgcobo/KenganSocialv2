import os
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import main


class TranscriptionLanguageTests(unittest.TestCase):
    def transcribe(self, settings):
        model = Mock()
        model.transcribe.return_value = ([], SimpleNamespace(language="zu", language_probability=0.49, duration=10))
        with patch.dict(os.environ, settings, clear=True), patch.object(main, "get_whisper_model", return_value=model):
            main.local_transcribe(Path("fixture.wav"), "agency")
        return model

    def test_uncertain_multilingual_audio_is_not_forced_to_english_by_default(self):
        model = self.transcribe({})
        self.assertEqual(model.transcribe.call_count, 1)
        self.assertIsNone(model.transcribe.call_args.kwargs["language"])

    def test_explicit_fallback_applies_only_without_forced_language(self):
        model = self.transcribe({"WHISPER_FALLBACK_LANGUAGE": "en"})
        self.assertEqual(model.transcribe.call_count, 2)
        self.assertEqual(model.transcribe.call_args.kwargs["language"], "en")
        model = self.transcribe({"WHISPER_FALLBACK_LANGUAGE": "en", "WHISPER_LANGUAGE": "zu"})
        self.assertEqual(model.transcribe.call_count, 1)
        self.assertEqual(model.transcribe.call_args.kwargs["language"], "zu")
