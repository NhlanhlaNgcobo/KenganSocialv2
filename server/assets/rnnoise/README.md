# RNNoise models

Neural noise-suppression models for FFmpeg's `arnndn` filter (RNNoise, Xiph.Org / Jean-Marc Valin),
from https://github.com/GregorR/rnnoise-models. The author states that the models are not
creative work and not subject to copyright.

| File      | Source directory                     | Tuned for                             | Used by Kengan for       |
|-----------|--------------------------------------|---------------------------------------|--------------------------|
| `sh.rnnn` | somnolent-hogwash-2018-09-01         | speech, recording noise               | "Voice" noise removal    |
| `bd.rnnn` | beguiling-drafter-2018-08-30         | voice (speech + laughter), recording  | "Voice + laughter"       |
| `mp.rnnn` | marathon-prescription-2018-08-29     | general sound, general noise          | "General" noise removal  |

Applied in `server/src/services/clip-cleanup.js`.
