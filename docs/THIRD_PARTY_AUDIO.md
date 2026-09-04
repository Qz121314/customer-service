# Third-party audio assets

The notification sounds under `public/agent-sounds/` come from **Kenney — Interface Sounds (1.0)**.

- Original author/distributor: Kenney
- Original project: https://kenney.nl/assets/interface-sounds
- Verified mirror used for exact source files: https://github.com/Calinou/kenney-interface-sounds
- License: Creative Commons Zero (CC0 1.0)
- License text: https://creativecommons.org/publicdomain/zero/1.0/
- Commercial use: permitted
- Attribution: not required by the upstream license; provenance is retained here for auditability

## File mapping

| Bundled file | Upstream source file | Upstream blob SHA |
| --- | --- | --- |
| `strong.wav` | `click_003.wav` | `9276c9b268ae96f6473ce7035432bb3aaa78eb37` |
| `classic.wav` | `click_005.wav` | `ac0a5d93373d6fa7be9c714094edd5f6699e8369` |
| `crisp.wav` | `click_004.wav` | `0c4a267e2e90981450f5003bde40a3a3cdf8003a` |
| `triple.wav` | `tick_002.wav` | `4391d33248beb96f76f62a1e3680822d7be89dbe` |
| `soft.wav` | `click_002.wav` | `ff6b64fcfe07f29ac9d20edbedb4dbe85a196ce0` |

The application uses these WAV samples as the primary foreground notification sound source. Existing synthesized WebAudio tones remain only as a best-effort fallback when an asset cannot be fetched or decoded.
