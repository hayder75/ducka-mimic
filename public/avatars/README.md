# Avatars

Drop character art here. The game loads it automatically.

```
1.webp ... 8.webp   (or 1.png ... 8.png)
```

- Transparent background.
- 512×512 or 1024×1024, square, front-facing.
- Same style and crop for all characters.
- WebP preferred (smaller), PNG is fine.

Players get a slot when they join, so the same person keeps the same character
for the whole game. If a file is missing, that player shows an emoji instead.

Free, commercial-safe sources: kenney.nl (CC0), opengameart.org, svgrepo.com.
Keep a `CREDITS.md` with the license/source of whatever you use.

## If you generate them with AI

Ask for a **flat solid magenta background (#FF00FF)**, full body, feet at the
bottom of the frame, same style for every character. Drop the raw files in
`public/avatars/raw/` and run:

```bash
python3 scripts/chroma.py public/avatars/raw/duck.png public/avatars/1.webp
```

That keys out the background, despills the edges, crops and resizes to
512×512. Repeat for `2.webp … 8.webp`.
