# GENESIS — controls

Every control at its default binding. Keys are rebindable in Settings → Controls; the in-game card (F1) always shows
the keys as they are bound now. This file is generated from `src/ui/keybinds.ts` and `src/ui/controlstext.ts`
(`node _harness/gen-controls.ts`; `tests/ui-meta.test.ts` fails when it goes stale).

## The Touch and the mouse

The Touch is the god's presence on the land: light where the people trust you, storm-dark where they fear you.

| mouse | what it does |
|---|---|
| drag the land | turn the world under you |
| wheel | descend / rise |
| Ctrl + wheel | brush size (keys: [ ]) |
| Alt + wheel | brush strength (keys: ⇧ [ ⇧ ]) |
| right-drag | turn and tilt the view |
| click | inspect a person, a building, a town, a herd, the ground… |
| drag someone | lift them in the Touch — flick and let go to hurl |
| ⇧ E | while carrying: hold to aim a hurl at the cursor, let go to hurl |
| rub someone | soothe: comfort them, heal a little — they feel it |
| Alt + click | rebuke: a sharp blow (hurts a person, cracks a wall; the modifier is rebindable) |
| long press | the radial menu at that spot |
| middle-drag | draw a sigil |
| power armed | click / drag on the ground to use it · right-click or Esc puts it away |

## The people and their god

| key | what it does |
|---|---|
| F4 | The god: how the people hold you (feared · awed · trusted — their faith, fear, trust and loyalty), open prayers, prophets, wrath, what is holy · the card under the worlds opens it too |
| ⇧ F4 | answer the most pressing prayer (a lamp over a town is a prayer: its card, its toast and The god answer it too) |
| a prophet | select a grown person · Make them your prophet · Foretell what you will do, then make it true: they are believed, and the town with them |
| F7 | send a sign: an eclipse, a comet, a rainbow, the sun standing still… — a trusting town reads favour, a fearful one anger |
| wrath | how hard your harm falls: survivable by default (The god) · say “a gentle storm” or “a huge meteor” for one act |
| holy things | hallow a spring, a grove or a peak · a town's sacred animal on its card · the Signs ring of the radial has them all |
| invent | a material or a plant from Ideas / Life (a form: name, kind, traits, uses) · Seed a vein lays ore in the ground |

## Camera modes

| key | mode |
|---|---|
| ` | every camera mode in one list (gamepad: Back / View, then the D-pad and A) |
| L | follow the selection (the inspector's Follow) · drag circles them, wheel nearer / farther · Esc stops |
| J | cinematic: circle the selected settlement (the inspector's Cinematic) · drag or Esc ends it |
| K | walk among them, at the selection or the cursor (the inspector's Walk) · W A S D walk, ⇧ runs, drag looks, R jumps and floats, F comes down, wheel to eye level · K or Esc rises |
| P | photo mode: the interface goes, time stands still · drag looks, W A S D R F move, wheel zooms, click focuses · Space takes the picture |
| V | free flight · M the whole system · Home back to orbit |

## Worlds, saves, mods

| key | what it does |
|---|---|
| the opening | a key or a click lights the star · any key goes straight to the world · Esc: the scenario menu (stay, or another world) · “hush” ends the whispers |
| F3 | a new world: the barren world, two worlds, a living system, the sandbox, your own system — with a seed |
| F6 | saves: slots with a picture and the date, export to a file, import one, autosave |
| F5 · F9 | quicksave · quickload |
| F8 | mods: load a content pack (JSON) from a file or an address; ?mod=<address> at start |

## Camera

| key | action |
|---|---|
| W · ↑ | Pan forward |
| S · ↓ | Pan back |
| A · ← | Pan left |
| D · → | Pan right |
| Z | Turn left |
| X | Turn right |
| R | Tilt toward the horizon |
| F | Tilt to look down |
| = · Num Add | Descend |
| − · Num Subtract | Rise |
| \ | Look at the selection |

## Time

| key | action |
|---|---|
| Space | Pause / resume |
| 1 | Speed 1× |
| 2 | Speed 2× |
| 3 | Speed 3× |
| 4 | Speed 5× |
| 5 | Speed 10× |
| 6 | Speed 30× |
| 7 | Speed 100× |
| 8 | Speed 300× |
| 9 | Speed 1000× (time-lapse) |
| 0 | Speed 3000× (deep time-lapse) |
| PgUp | Faster (the next speed) |
| PgDn | Slower (the speed before) |
| , | Step one minute |
| . | Step one hour |
| ⇧ . | Step one day |
| ⇧ , | Rewind one hour |

## Powers

| key | action |
|---|---|
| / · Ctrl K | Command palette |
| Enter · ; | Do this… (words) |
| Q | Radial menu (hold) |
| G | Draw a sigil (hold) |
| Y | Use the power at the cursor |
| T | Cast the last power again at the cursor |
| Esc | Cancel / back |
| ] | Brush larger |
| [ | Brush smaller |
| ⇧ ] | Brush stronger |
| ⇧ [ | Brush weaker |

## Touch

| key | action |
|---|---|
| left button | Touch / use (hold: lift, paint) |
| E | Lift what is under the Touch / set it down |
| ⇧ E | Hurl what the Touch holds toward the cursor |
| B | Rebuke what is under the Touch |
| N | Soothe what is under the Touch |
| Alt | Rebuke modifier (+ click) |

## The god

| key | action |
|---|---|
| F4 | The god: how the people hold you, prayers, prophets, wrath |
| F7 | Send a sign |
| ⇧ F4 | Answer the most pressing prayer |

## Windows

| key | action |
|---|---|
| C | Chronicle |
| O | Next map overlay |
| ⇧ O | Previous map overlay |
| Alt O | Overlay off |
| I | Inspect what is under the cursor |
| U | Laws of this world |
| F10 · Ctrl , | Settings |
| F6 · Ctrl S | Saves |
| F3 | New world |
| F8 | Mods |
| F5 | Quicksave |
| F9 | Quickload |
| F1 · ⇧ / | Controls card |
| F2 | Game menu |
| H | Hide the interface |

## Photo mode

| key | action |
|---|---|
| Space · Enter | Take the picture |
| P | Leave photo mode |
| [ | Focus nearer |
| ] | Focus farther |
| ⇧ [ | Close the lens a stop (less depth blur) |
| ⇧ ] | Open the lens a stop (more depth blur) |
| , | Darker |
| . | Brighter |
| = · Num Add | Longer lens (zoom in) |
| − · Num Subtract | Wider lens (zoom out) |
| T | Next filter |
| G | Next frame |
| H | Show / hide the photo panel |
| Y | Freeze time / let it run |
| R | Move the camera up (hold) |
| F | Move the camera down (hold) |

## Walking

| key | action |
|---|---|
| K | Rise from the ground (leave walking) |
| R | Jump; hold to float up |
| F | Come down (hold) |

## Gamepad

A standard-mapping pad (Xbox / PlayStation layout); the left stick moves a cursor that the Touch and every power use like a mouse.

| button | action |
|---|---|
| left stick | the cursor (push to the edge to pan) · walking: walk · photo: move |
| right stick | turn and tilt the view · points in the radial · following: circle them · walking and photo: look |
| LB · RB | rise · descend · following: farther · nearer · walking: to and from eye level · photo: wider · longer lens |
| D-pad / A / B | in a menu or panel: move, press, back |
| Start | the game menu: The god, Send a sign, saves, settings, the title |
| RB (hold) | Descend |
| LB (hold) | Rise |
| Back | Camera modes |
| Up | Faster (the next speed) |
| Down | Slower (the speed before) |
| Y | Command palette |
| X | Do this… (words) |
| RS (hold) | Radial menu |
| LT (hold) | Draw a sigil |
| A | Use the power at the cursor |
| B | Cancel / back |
| RT | Touch / use (hold: lift, paint) |
| LS | Lift what is under the Touch / set it down |
| Right | Next map overlay |
| Left | Previous map overlay |
| Start | Game menu |
| A | Take the picture (photo mode) |
| B | Leave photo mode (photo mode) |
| Down | Focus nearer (photo mode) |
| Up | Focus farther (photo mode) |
| Left | Darker (photo mode) |
| Right | Brighter (photo mode) |
| X | Next filter (photo mode) |
| Y | Next frame (photo mode) |
| Start | Show / hide the photo panel (photo mode) |
| RT (hold) | Move the camera up (photo mode) |
| LT (hold) | Move the camera down (photo mode) |
| B | Rise from the ground (leave walking) (walking) |
| Up | Jump; hold to float up (walking) |
| Down (hold) | Come down (walking) |

## Sigils

Hold G (or the middle mouse button) and draw one stroke: each sigil is an original glyph that casts one miracle.
The F1 card draws every sigil with the miracle it casts.

## Words

Press Enter and say it — “Make it rain over Aru for three days.”, “Teach them writing.”, “Set gravity to 3.”.
Anything not in a list, the world will try, and tell you what it can do instead.
