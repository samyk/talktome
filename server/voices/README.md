# Voice packages for Step-Audio-EditX

Each subdirectory is one clone voice:

```text
myvoice/
  voice.json
  prompt.wav
```

`voice.json` example:

```json
{
  "id": "myvoice",
  "name": "Narrator",
  "language": "en",
  "prompt_audio": "prompt.wav",
  "prompt_text": "Exact transcript of the reference audio.",
  "style_hint": "neutral read"
}
```

`prompt.wav` should be a clean 3–10s clip of the target speaker. The placeholder `default/prompt.wav` is silence and will not produce good clones.
