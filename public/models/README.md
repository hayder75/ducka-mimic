# 3D models

Drop the files here, then tell me. I'll do the rest.

```
public/models/
  char-duck.glb
  char-tiger.glb
  ...
  prop-speaker.glb
  prop-mic.glb
```

## What I need

**Characters (the important one)**
- **`.glb`** — binary glTF, single file. Not FBX, not OBJ, not USDZ.
- **Rigged** (has a skeleton) and with **animations embedded** (at least idle + walk).
- Low poly: under ~30k triangles, under ~10 MB each.
- Bipedal, cartoony / low-poly, same pack for all characters.

**Props (optional)**
- Speaker stack, stage platform, mic stand, spotlight, disco ball, truss.
- `.glb`, low poly, CC0 ideally.

## Where to get them (free, commercial-safe)

1. **quaternius.com** — "Ultimate Modular Characters", "Animated Characters".
   CC0, rigged, animations included, GLB download. **Best first stop.**
2. **kaylousberg.com** — free Character Pack. CC0, GLB, animated.
3. **poly.pizza** — search `speaker`, `stage`, `microphone`, `spotlight`. CC0/CC-BY, GLB.
4. **sketchfab.com** — filter: Downloadable + CC0/CC-BY + search `low poly character rigged`.

## Do not download

- `.fbx`, `.obj`, `.usdz` — no Blender on this machine to convert them.
- Models without a rig — they can't be animated.
- 100k+ triangle / photoreal models — they'll kill phones.
- Sketchfab "Editorial / NoAI" licenses — not for commercial use.

## If a site gives a glTF folder

Zip the whole folder (`.gltf` + `.bin` + textures). Don't rename files inside.
