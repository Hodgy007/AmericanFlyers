# Settings

This page lists every setting, its default and range, and what it changes. Open settings with the **⚙** button.

## The settings

| Setting | Default | Range | What it changes |
| --- | --- | --- | --- |
| Rider weight (kg) | 75 | 30 to 200, step 0.5 | With bike weight, sets how the speed model responds to your power. Also used for W/kg and the **Four watts** achievement. |
| Bike weight (kg) | 8 | 5 to 30, step 0.5 | Added to rider weight in the speed model. |
| FTP (watts) | 200 | 50 to 600, step 1 | Sets the power zones, workout targets, TSS and the FTP history. A ramp test can also set it. |
| Max heart rate (bpm) | 185 | 120 to 230, step 1 | Sets the heart-rate zones. The dialog suggests your highest heart rate in a hard effort, with 220 minus your age as a rough guide. |
| Graphics | Auto | Auto, Low, Medium, High or Ultra | How much work the 3D view does: sky and haze, light and colour, shadows, reflections and sharpness. Kept **on this device only** (not synced to your account), because a phone and a TV need different answers. See [Graphics](#graphics). |
| Units | Metric | Metric or Imperial | Changes displayed distances, speeds and heights: metric shows km, km/h and m; imperial shows mi, mph and ft. |
| Trainer difficulty (%) | 50 | 0 to 100, step 5 | How much of the road's grade the trainer simulates. 100% feels like the real hill. 0% means no grade resistance. |
| Virtual shifting | Off | On or off | Choose your own gear with − / + (see [Sound and virtual shifting](sound-and-shifting.md)). |
| Race my best ride | On | On or off | On a stage you've finished, a ghost of your fastest ride rides with you. See [Leaderboards and ghosts](leaderboards-and-ghosts.md). |
| Wind | On | On or off | Headwinds slow you and tailwinds help, crosswinds make the best shelter diagonal, and your trainer feels the headwind. See [Riding](riding.md#wind-and-echelons). |
| Mini-map and climb preview | On | On or off | A small route map with riders on it, and a card for the next climb. Also in ☰ Menu. See [Riding](riding.md#mini-map-and-climb-preview). |
| Pro teams on the road | On | On or off | Computer-ridden teams riding the stage at different paces. See [Riding together](riding-together.md#pro-teams). |
| AI coach | Off | On or off | Coach Marty's tips and debriefs. Needs an account. Saved to your account, not just this browser. See [AI coach and AI rivals](ai-coach-and-rivals.md). |
| AI rivals | Off | On or off | Rivals write fresh lines and remember your rides together. Needs an account. |
| Speak their lines aloud | Off | On or off | Uses your browser's voice for the coach and rivals. |
| Race commentary | On | On or off | A commentator calls the action in races. Needs sound on. See [Group rides, races and the commentator](events-and-commentary.md#the-race-commentator). |
| Ride together | On | On or off | Show you to other signed-in riders on the same stage, and them to you. See [Riding together](riding-together.md). |

Your kit colours (☰ Menu → 🎨 My kit, see [My kit](my-kit.md)) are saved with your settings too, but you change them in their own dialog. What you ride and wear from the [Garage](garage-and-credits.md) (`loadout`) is saved with your settings in the same way.

Changing **FTP** in Settings adds an entry to your FTP history when you're signed in. See [Zones and FTP](zones-and-ftp.md).

Changing **Trainer difficulty** takes effect straight away, on the next grade update.

**Remembered devices** lists the trainer and heart rate strap this browser remembers, with a **Forget** button for each. See [Connecting devices](connecting-devices.md#remembered-devices-you-only-join-once). It isn't part of your synced settings: it stays on this browser.

**Auto-steer into the draft** is on by default: with no steering for about 3 seconds and a rider within 12 m ahead, you ease onto their line. See [Riding](riding.md#steering).

Time of day and weather live in **☰ Menu → 🌤 Time & weather**, not in this dialog, but they're saved with your settings. See [Riding](riding.md#time-of-day-and-weather).

## Graphics

**Graphics** picks how detailed the 3D view is. The default, **Auto**, chooses for your device when the app opens (software renderers, phones and small tablets start on Low or Medium, ordinary computers on High) and then watches how smoothly it runs: if frames come slowly it first makes the picture a little less sharp (down to 70%), then drops a tier, and if the device is very slow it turns shadows off. If it has plenty of room to spare for a while it climbs back up, never past the tier it first picked. The line under the setting says what Auto picked and whether it has stepped down since.

| Tier | What you get |
| --- | --- |
| Low | The sky, haze and cloud improvements, lighter shadows (1,024-pixel shadow map), sharpness capped at 1× the screen's pixels. No post-processing, so nothing extra is downloaded. The ground has grass, rock and snow (or sandstone and rock in the desert) textures at a lower resolution, and the climbs get painted words, guardrails and a thinner crowd. |
| Medium | Adds glow on bright things (the sun, the Tron bike, night lights), colour grading for the time of day and weather, smoothed edges, a 2,048-pixel shadow map. The ground gets all its textures (grass, dry grass, dirt, rock, snow, sandstone, sand), the road gets a grainy asphalt surface, and the crowds are thicker and wave flags. |
| High | Adds soft contact shadows where things touch the road, reflections of the sky on helmets, frames and wheels, softer shadows, and the shadows of clouds drifting over the land. The ground and cliffs gain fine bumps, wet-road puddles reflect the sky, and spectators cast shadows. |
| Ultra | Adds fuller-resolution glow, higher-quality contact shadows, a bigger and sharper shadow map. |

Choosing a tier yourself turns off the automatic tier changes; the sharpness still eases off by itself if frames run slow. Changing it takes effect when you press **Save**.

## Data blocks

The data blocks you show are also saved in settings, but you change them with the **✎** button, not in the Settings dialog. See [Data blocks](data-blocks.md).

## Where settings are kept

- **In this browser:** settings are saved on every change, so they survive a reload.
- **In your account:** when you're signed in, changes are saved to your account about 0.8 seconds after you stop making them.

When you sign in on a new browser:

- If your account already has settings, they replace the settings in that browser.
- If your account has none yet, the settings in the browser are copied up to your account.

See [Accounts and profile](accounts-and-profile.md#what-syncs) for the full rules.

*Run the setup guide again* (a link above the buttons) reopens the first-ride guide. Sound is in the ☰ Menu (or the **M** key), and the training plan you're following is also saved with your settings.
