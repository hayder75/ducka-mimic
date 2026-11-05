# Ducka Mimic — ሚሚክ ፓርቲ

A streamer-facing party game: the host shares the **stage** screen, players join
from their phones, everyone hears the same sound and mimics it at once. One
shot. Closest impression wins.

Built for a short Ducka Labs campaign. No accounts, no database, no TikTok
integration. The streamer handles OBS/streaming; this app is only the game.

---

## Quick start (local)

```bash
npm install
npm run dev
```

- Stage (the big screen the streamer captures): <http://localhost:5173>
- Join page (players' phones): <http://localhost:5173/play>

Click **Start a game** → a 4-letter room code and QR appear. Players open the
join link, enter the code + their name, and allow the microphone. Hit **Start
round**.

### Test with two browser tabs

Open the stage in one tab and `/play?code=XXXX` in a second tab. Chrome allows
two tabs to use the mic at the same time, so you can validate the whole loop
without phones.

### Test on real phones

Phone microphones **require HTTPS**. `http://192.168.x.x` will not work —
browsers block `getUserMedia` outside `localhost` and HTTPS.

Easiest way tonight:

```bash
# install once
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
  -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared

# while `npm run dev` is running
cloudflared tunnel --url http://localhost:5173
```

Use the printed `https://....trycloudflare.com` URL on the phones. Vite proxies
the websocket automatically, so both the stage and the players work through it.
The URL is temporary — fine for testing.

---

## Adding sounds (the important part)

1. Drop audio files into `public/audio/` (subfolders are fine).
2. Describe them in `public/audio/meta.json`:

```json
{
  "categories": [{ "id": "funny", "name": "Funny expressions" }],
  "sounds": {
    "funny_001.mp3": {
      "title": "እኔ አልነበርኩም!",
      "subtitle": "angry auntie",
      "category": "funny",
      "difficulty": "easy"
    }
  }
}
```

3. Rebuild the manifest:

```bash
npm run scan-audio
```

The scanner reads the real duration with `ffprobe` and writes
`public/audio/manifest.json`. The server reads that file on boot; you can also
hit `POST /api/reload` after editing it.

**Sound rules for a good round:**

- 1–3 seconds. Long clips kill the pace.
- No background music; the mimic only copies voice/sound.
- Normalize the volume so all clips feel equally loud.
- Mono, 44.1 kHz, mp3 or wav.

Aim for 30–50 clips before the first real stream — 4 clips get old in one
round.

---

## How scoring works

It runs in the browser on the player's phone (no audio upload, no server
transcoding):

1. The demo clip and the microphone take are both downsampled to 8 kHz.
2. Pitch (autocorrelation) and loudness are extracted per ~32 ms frame.
3. Pitch contours are compared as **intervals from each performer's opening
   note**, so a deeper voice is not punished.
4. Score = pitch shape + rhythm + how much of the sound you sustained.

| Attempt | Typical score |
|---|---|
| Identical recording | ~96 |
| Good imitation | 70–90 |
| Rough | 40–65 |
| Wrong notes / silence | 0–35 |

Tune the weights in `scoreAttempt()` in `src/lib/audio.ts`. Because it is
client-side, a determined player could fake a score — for a friends' party
game that does not matter. If it ever does, move the comparison to the server.

The **bonus** is server-side: 96+ → +35, 90+ → +15, 80+ → +5.

---

## Production on a VPS

```bash
npm run build
PORT=3001 npm start        # serves dist/ + socket.io
```

You need HTTPS in front (microphone). Caddy is the fastest:

```caddyfile
mimic.yourdomain.com {
    reverse_proxy 127.0.0.1:3001
}
```

`socket.io` upgrades automatically through Caddy. Open the resulting
`https://mimic.yourdomain.com` on the stage and share
`https://mimic.yourdomain.com/play` with players.

One 4-vCPU / 8-GB VPS is more than enough: the app is stateless (rooms live in
memory), audio is served as static files, and scoring happens on the client.

---

## What is in v0

- Room code + QR join, 1–8 players
- Same sound for everyone, one shot, 3-2-1-GO
- Real 3D stage (three.js) on the streamer's screen **and** on each player's screen
- Characters walk to the mic, step forward, jump / clap / collapse on the score
- Live mic meters, projected name tags, "you" highlight on your own character
- Score reveal with confetti + bonus
- Solo mode (the stage itself plays)
- Sound library + manifest scanner

Not in v0: playback of the recorded takes (we only send scores), attacks in the
score, the wheel, in-app voice chat.

## How this compares to the real Mimic Party (FoliesApp)

The reference is *Mimic Party* on Steam / iOS / Android: 1–5 players, ~10 min,
one shot, local AI scoring of **melody, rhythm and attacks**, and a **wheel**
between rounds that hands out points, multipliers and sabotages (echo, pitch
shift, chopped audio, fart). Voice chat goes quiet exactly while a take plays.

What we already match: one sound for everyone, one countdown, one shot, scoring
that ignores voice register, public scores, 3D stage, sound packs.

What we still lack, in order of impact:

1. **Playback of each take.** In the real game the room hears every take, one by
   one, while everyone else is muted. That's the funniest part. It needs audio
   upload (MediaRecorder → R2) instead of only features.
2. **Attacks in the score.** Count onsets (one bark ≠ three barks).
3. **The wheel.** Multipliers and sabotages between rounds — extremely
   clip-friendly.
4. **In-app voice chat** with auto-mute during playback.


---

## Project layout

```
server/index.js        socket.io rooms + round state machine
src/lib/audio.ts       mic capture, pitch analysis, scoring, sfx
src/pages/Stage.tsx    the big screen (OBS source)
src/pages/Play.tsx     the phone controller
scripts/scan-audio.mjs builds public/audio/manifest.json
public/audio/          sound pack
```
