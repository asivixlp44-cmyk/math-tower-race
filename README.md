# Math Tower Race

A multiplayer math battle for the browser, built with **Three.js** and **Colyseus** for Bloxity. Everyone gets the same math question on the big screen; the faster you answer, the more blocks you stack on your tower. After every question the lava in the pit rises, and every tower under it burns. The last tower standing wins. It clones the Roblox game *[Math Tower Race](https://www.roblox.com/games/17571821642/Math-Tower-Race)* (see `Reference/Gameplay.mp4`).

**There are no in-app purchases.** Everything is bought with **Gems**, earned by answering and winning.

It shares its engine with the other Legion games (server, Bloxity login and avatars, profiles, pets, effects). The arena, lava, towers, question generator, voting, HUD and music are new. An earlier Roblox (Luau/Rojo) version is kept in `_roblox-version/` and is not used by this build.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client: `main.js` (player, camera, network, spectating), `world.js` (island, pit, big screen, vote pads, boards, shops, VIP lounge, gems), `towers.js` (instanced towers, block animations, burning), `lava.js` (the lava column), `quiz.js` (question panel, answers, hints, second chance, results), `ui.js` (HUD and panels), `audio.js` (music and sounds), `fx.js` (bloom, grade, particles), `pets.js`, `avatar.js` |
| `server/` | Colyseus 0.18 server: the `race` room (`RaceRoom.js`, the whole match loop), profiles, leaderboards, play stats |
| `shared/` | `questions.js` (the question generator), `config.js` (timings, block rewards, lava, Gems economy, cosmetics, pets, shop) and `arena.js` (the world layout, used by both sides) |

## Run it locally

Needs Node 20 or newer. Double-click `start-local.bat`, or:

```sh
npm install          # installs client and server too
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2607
```

For development run `npm run dev:server` and `npm run dev:client`, then open http://localhost:5187 (the client talks to the server on port 2607; `VITE_SERVER_URL` overrides that). A match starts with one player; Wins only count when at least 2 players started.

## Gameplay (from the reference)

1. **Intermission** (15 s) in the lobby: "Waiting for players..." and the next game's timer on the status line.
2. **Voting** (15 s): everyone with Auto Join on is dropped in front of the four vote pads (**Easy**, **Medium**, **Hard**, **Algebra**). Stand on a pad to vote; the counts show on its sign. Algebra needs the Algebra Mode pass. The most votes win (ties pick at random).
3. **The game**: every player gets a tower in the lava pit (a 6 x 5 grid) and rides on top of it. Each round:
   - **Question** (15 s) on the big screen and in the top panel, with four answers (click, keys **1-4**, or A/B/X/Y on a controller). A hint pops up after 5 s or after a wrong answer.
   - **Blocks**: a right answer stacks `12 - 0.6 x seconds` blocks (at least 3), minus 2 for every wrong try before it. **"Correct! +N Blocks"**.
   - **Wrong answer**: "Incorrect!", the answer is crossed out and you are locked. **Use Second Chance** spends a retry and lets you answer again. Everyone has 2 free retries per game, plus any bought ones; Unlimited Answers never runs out.
   - **Results** (4 s): the full worked answer, then everyone's answer and time.
   - **Lava rises** by 1, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 12, 12, 13 blocks, then one more each round. Towers at or under the lava burn and sink, and their players go back to the lobby.
4. The game ends when one tower is left (or none, or after 60 rounds). **1st / 2nd / 3rd** get 100 / 40 / 20 Gems and the winner dances on the podium. Then the next intermission starts.

Eliminated players and the **Watch Game** pad spectate: Q / R (or LB / RB, or the arrows on screen) switch between towers.

### The math questions

The question pool depends on the voted difficulty and gets harder in rounds 1-3, 4-7 and 8+. No question repeats in one game. The wrong options are mostly typical mistakes (off by one, the wrong operation, adding instead of multiplying), topped up with nearby numbers.

| Difficulty | Question types (examples) |
|---|---|
| **Easy** | `9 + 6`, `9 - 7`, `3 x 10`, `Double 7`, `24 + ? = 28`, `4, 14, 24, ?`, *Which number is the biggest?*, *How many sides does an octagon have?* (with the shape drawn), later `9 x 4` and `90 ÷ 9` |
| **Medium** | times tables and division, `7²`, area of a drawn rectangle or square, perimeter, *What type of angle is this?* (acute / right / obtuse / straight, drawn), `54 + 98`, `104 - 88`, *Round 32 to the nearest 10* |
| **Hard** | `17 x 8`, `33 ÷ 3`, `9 + 3 x 8` (order of operations), `5³`, `√25`, `75% of 4`, `3/4 of 24`, `-11 + 4`, `1, 3, 9, ?`, `2, 4, 6, 10, 16, ?` (Fibonacci-style), area of a drawn triangle, the missing angle of a triangle |
| **Algebra** | `x + 9 = 14`, `7x = 49`, `4x + 15 = 23`, *If x = 2, what is 4x + 5?*, `2a + 9a`, `2(x + 4)`, `x + y = 13 and x - y = 5` |

`shared/questions.js` is checked by a fuzz test (28,800 questions: the answer is among four unique options, and areas, perimeters, angles, sequences, roots, percentages and equations are recomputed and checked).

## The lobby

A sunny island in the sea where every feature has its own spot, joined up by cream paver paths (`shared/arena.js` has the whole layout):

- **Middle**: the lava pit with stone-brick walls, a stone rim and fence, and a walkway all round it. The big question screen stands on its north side (you can walk under it) with the logo on top; the four **vote pads** are behind it.
- **South avenue**: from the pit, under the **How to Play** arch, to the spawn plaza and the **Gem Chest** (100 Gems every 20 hours). **Top Wins** and **Top Answers** stand either side of the arch, with podium statues of the top three beyond them.
- **Cross path** (south of the spawn) to the **VIP lounge** door. Along the south fence: the three **pet eggs**, the pass pads (Unlimited Answers, Algebra Mode, Watch Game, VIP) and the chest.
- **East path**: the **tower skin** row. **West path**: the **victory dance** row.
- Trees, bushes and flower beds sit in fixed spots on the lawns. **Gems** are spread over the open lawns, away from everything else (1 Gem, back after 40 s; 15 s in the VIP lounge).

## Gems and the shop

- **Earning**: 5 Gems per right answer, 100 / 40 / 20 for 1st / 2nd / 3rd, gem pickups, the chest, codes (`MATH`, `TOWER`, `GENIUS`, `LEGION`, `RELEASE`). Multiplied by pets, VIP (x1.5) and x2 Gems.
- **Passes**: VIP 3K (x1.5 Gems, VIP tag, the lounge, 4 pet slots), x2 Gems 8K, Unlimited Answers 5K, Algebra Mode 1.5K.
- **Boosts**: +10 Blocks 75 (in a game it is added at once; in the lobby it is saved for the next game), Nuke 500 (lava surges 10 blocks for everyone, your own tower grows 10), +3 Retries 60.
- **Tower skins** (14): Stone, Brick 100, Wood 150, Grassy 250, Candy 400, Ice 500, Gold 750, Rainbow 1K, Ghost 1.2K, Neon 1.5K, Electric 2K, Magma 2.5K, Diamond 4K, Galaxy 7.5K.
- **Block animations** (7): Classic Stack, Pop 200, Sky Drop 400, Spinner 650, Flashbang 900, Sparkle 1.3K, Inferno 2.2K.
- **Victory dances** (7): Classic, Big Wave 150, Cheer 300, Laugh It Up 450, Groove 800, Shuffle 1.2K, Tornado Spin 2K.
- **Pets** from eggs: Basic 250, Golden 1K, Genius 5K; 17 pets from Common (x1.1) to Mythic (x12 Golden Calculator). Equip 3 (VIP 4); they multiply your Gems and follow you.

The server checks every price, answer, vote and pickup.

## Controls

| Action | Keyboard / mouse | Controller | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick | Joystick |
| Jump | Space | A | JUMP |
| Answer | Click, keys 1-4 | A / B / X / Y | Tap |
| Interact (pads, chest, eggs, shops) | E | X | Prompt button |
| Spectate: previous / next | Q / R | LB / RB | ◀ / ▶ |
| Close a panel | Esc | B | ✕ |
| Camera | Drag, wheel to zoom | Right stick | Drag |

## Sound and graphics

- Two original code-generated tracks: a bouncy 112 BPM lobby tune and a driving 128 BPM game track; the music ducks while a panel is open. Every sound effect is synthesized: block stacks rising in pitch, the correct chime, the wrong buzz, the urgent tick in the last 5 seconds, the lava rumble, eliminations, the nuke launch and blast.
- A bright cartoon look like the reference: a painted sky (baked once into a cube map), checker grass with grass blades, bevelled stone and paver textures, soft shadows.
- **Lava** like the reference: bright yellow with big orange spots (darker rims, a pale halo) that drift and wobble, foam along the walls, bubbles that swell and pop, embers. It rests on the pit floor between games.
- **Tower blocks** look like bevelled bricks in every skin (a groove, a light bevel and an inset frame, drawn in the shader).
- **Speed**: every frame is one scene render with no post-processing. The colour grade (saturation, contrast, a soft S-curve) is part of the tone mapping, the vignette is a CSS overlay, and the browser's own MSAA smooths the edges. Matte surfaces use Lambert shading and only shiny ones use PBR. The lava's spots are baked once into a small distance-field texture. All particles are two point clouds (two draw calls). Towers and gems are instanced, static scenery and statues are merged, and far-away shop props and labels are hidden. Every shader, including every tower skin and pet, is compiled while the game loads, so nothing stalls mid-game.
- Quality: High (up to 1.5x resolution, 2048 shadows), Medium (1x, 1024 shadows), Low (no shadows). Each level also caps the number of pixels, so big or high-density screens don't render far more than the GPU can fill. Integrated and mobile GPUs start on Medium. It only steps down by itself when the game stays slow for a while, and that step is never saved: the next visit starts on the default again. A quality picked in Settings is kept.

## Multiplayer and saves

- One shared `race` room (up to 24 players, 30 tower slots). The match loop, questions, answers, blocks, lava and eliminations all run on the server; movement is client-side.
- Progress is saved per browser or per Bloxity account: MongoDB on Legion (`MONGODB_URI`), `server/data/profiles.json` locally.
- Play stats: `GET /api/stats?key=<stats key>&days=7` (the key is in `server/STATS_KEY.local.txt`, not in the repo; locally the stats are open).

## Deploy (Bloxity hosting)

Pushing `main` (prod) or `dev` runs `.github/workflows/deploy.yml`: server image `ghcr.io/asivixlp44-cmyk/math-tower-race-server`, Legion rollout, client upload. Play at https://math-tower-race.play.bloxity.io.

One-time setup: create the app `math-tower-race` on hosting.bloxity.io, add the repo secret `LEGION_DEPLOY_TOKEN`, and create the game with the same slug in Manage Games (no IAPs; `bloxity-setup.html` has every field with copy buttons).
