I’d treat this as **a playable world map for DirtBikeX**, not merely a “100 tracks progress map.”

The 100-track series gives you the first narrative layer—“where has Rubio been?”—but the same visual system should eventually become the geographic front door to the whole dirt-bike world: tracks, shops, mechanics, riders/industry people, events, landmarks, maybe routes. That lines up well with the mission-driven structure you’re already using in the series. 

## 1. Core product idea

Think **Need for Speed Underground 2 world map × GTA map × dirt-bike community atlas**.

The important distinction is:

> **Google Maps asks: “Where do you want to go?”**
> **Your map should ask: “What’s out there, and what have I unlocked?”**

So the emotional loop becomes:

**Explore → discover → visit → unlock → progress**

For your public map specifically:

**100 TRACKS — 2/100**

People should immediately understand:

* where the tracks are
* which ones you’ve visited
* which ones are coming up
* what other dirt-bike things surround them
* clicking something reveals its story

That is much more compelling than putting 100 ordinary pins on Mapbox.

---

# 2. The visual language

I would borrow **the mental model** from NFS/GTA, but not literally reproduce their interface.

### Base map

The map should visually recede into the background.

Not:

* detailed Google streets everywhere
* POI clutter
* restaurant labels
* transit
* dozens of irrelevant road classifications

Instead:

* dark/desaturated terrain
* major roads
* terrain/topography
* water
* regional/city labels
* possibly subtle satellite/topographic texture at high zoom

The dirt-bike content becomes the brightest layer.

Something approximately like:

```text
        ○ SHOP

                    ◇ PERSON

      ╱ mountains ╲

                 ◉ TRACK
                 #003
               COMPLETED


                         △ TRACK
                         UNVISITED
```

The important thing is that **your symbols own the screen**.

---

# 3. Don't use ordinary map pins

This is probably the most important visual decision.

Create a DirtBikeX **map icon vocabulary**.

For example:

| Type                | Map symbol idea         |
| ------------------- | ----------------------- |
| Motocross track     | track/jump glyph        |
| Enduro / trail park | mountain/trail glyph    |
| E-bike park         | lightning + track       |
| Shop                | wrench                  |
| Mechanic            | crossed tools           |
| Industry person     | portrait/person icon    |
| Event               | flag                    |
| DirtBikeX partner   | special badge           |
| Your current series | numbered mission marker |

Your S03E002 e-bike park, for example, could genuinely have its own category rather than being visually identical to a motocross track. 

And then **state is encoded separately from type**.

Example:

```text
TYPE                 STATE

MX Track             undiscovered
                     discovered
                     visited
                     featured
                     DirtBikeX partner
```

That separation matters.

Otherwise you'll eventually need 30 different icons.

---

# 4. The 100-track series should be one map layer

This is where I would slightly push back on making the whole site around “100 tracks.”

Make it:

### WORLD MAP

with filter layers:

```text
ALL
TRACKS
SHOPS
PEOPLE
EVENTS

─────────────

SERIES
● VISITING 100 TRACKS
  02 / 100
```

When the **100 Tracks** layer is activated, everything else dims.

Now you get your game map.

Visited locations could become highly visible, while future locations appear subdued.

Something like:

```text
✓ #001  Track name
✓ #002  E-bike park
○ #003  ???
○ #004  ???
```

The distinction is that #001/#002 aren't just database objects.

They're **completed missions**.

---

# 5. The strongest interaction: location → story

Clicking a track shouldn't immediately dump the user into a Yelp-like information panel.

I'd make the first interaction almost cinematic.

### Hover

```text
TRACK 002
E-BIKE PARK

✓ VISITED
```

### Click

A panel slides in:

```text
02 / 100

E-BIKE PARK
Hometown

✓ VISITED

[ episode thumbnail ]

"I came back and suddenly
all the bikes had batteries."

WATCH EPISODE

────────────

TRACK INFO
Electric
Jump track
DirtBikeX Partner

[ VIEW TRACK ]
```

Now your **content and product become the same object**.

That is powerful.

Someone discovers the track through the video.

Someone discovers the video through the map.

Someone discovers DirtBikeX through either.

---

# 6. One excellent NFS mechanic to borrow: focus mode

NFS maps usually don't feel like databases because selecting an object transforms the visual hierarchy.

Do the same.

Normal:

```text
      shop ○

   △             △
 track         track

            ◇ person

        △ track
```

Select Track 002:

```text
             ·
       ·

                ·

           ◉
       TRACK 002
       VISITED
```

Everything else fades to perhaps 20–30%.

Camera slightly centers/zooms.

Information panel appears.

It makes a click feel like **selecting a mission**, rather than clicking a marker.

---

# 7. There should be three levels of map experience

This is worth designing from the beginning.

### World / country level — discovery

You're seeing regions and density.

Eventually:

```text
USA       842 TRACKS
CHINA      27
FRANCE    114
...
```

Individual markers probably cluster.

---

### City / regional level — exploration

This is the GTA/NFS feeling.

Individual:

* tracks
* shops
* people
* events

become visible.

This should probably be the most visually impressive level.

---

### Location level — identity

Click/zoom into one track.

Now you're no longer primarily looking at geography.

You're looking at:

* identity
* images/video
* track info
* episode
* people
* events
* community

The map essentially becomes navigation into DirtBikeX.

---

# 8. “People” is actually a very interesting layer

I would absolutely keep this idea.

Not home locations of ordinary users—that creates obvious privacy problems.

Instead use **public community/industry identities tied to places**:

* track owner
* mechanic
* shop owner
* trainer
* racer
* builder
* organizer
* creator

Then the world develops characters.

Imagine:

```text
              ◇ TRACK BUILDER
             /
      △ TRACK 014
             \
              🔧 SHOP
```

You start creating a **geography of the dirt-bike scene**, rather than a directory of businesses.

That's something Google Maps cannot really give you.

And it fits extremely well with the side-quest content direction you've been developing.

---

# 9. Main desktop layout

For V1 I would keep the structure extremely simple.

```text
┌──────────────────────────────────────────────────────────┐
│ DirtBikeX                      [Search]      [02 / 100]   │
├──────────┬───────────────────────────────────────────────┤
│          │                                               │
│ MAP      │                                               │
│ FILTERS  │                                               │
│          │                   MAP                         │
│ Tracks   │                                               │
│ Shops    │                                               │
│ People   │                                               │
│ Events   │                                               │
│          │                                               │
│ ───────  │                                               │
│ Series   │                                               │
│ 100      │                                               │
│ Tracks   │                                               │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

But I wouldn't permanently waste 250px on a traditional sidebar.

Think more GTA:

### Default

Almost entirely map.

Small floating controls.

### Select something

Side panel appears.

```text
MAP MAP MAP MAP ┃ TRACK 002
MAP MAP MAP MAP ┃
MAP MAP MAP MAP ┃ thumbnail
MAP MAP MAP MAP ┃ info
MAP MAP MAP MAP ┃
```

**Map-first, interface-second.**

---

# 10. The progress element should live on the map

Rather than a boring progress bar:

```text
2 / 100
██░░░░░░░░░░░░
```

I'd give it a mission identity.

Something like:

```text
VISITING
100 DIRT BIKE TRACKS

02 / 100

●────●────○────○────○
001  002  003
```

Or simply:

```text
TRACK HUNT
02 / 100
```

Clicking it enters **Series Mode**.

That's your content-specific layer.

---

# 11. Completed markers should visibly change the world

This is another thing games understand very well.

If you visit a track, the only change should **not** be:

gray marker → green marker.

It should feel claimed/unlocked.

Possible visual differences:

**Unvisited**

```text
△
```

**Visited**

```text
◉
02
```

**DirtBikeX partner**

```text
◉
02
★
```

**Episode exists**

small video/ring indicator.

This allows a single icon to communicate:

> I've been here, I made an episode here, and the owner joined DirtBikeX.

That becomes satisfying once dozens accumulate.

---

# 12. The homepage could literally be this map

Longer term, I think that is where this becomes much more interesting.

Instead of:

> Welcome to DirtBikeX
> The community for dirt-bike riders
> [Download App]

User lands on:

```text
               THE DIRT BIKE WORLD

                    [map]

     1,632 tracks     483 shops     120 events

               Explore the map
```

And **your journey is visible inside the same world**.

That's much stronger brand imagery.

---

# 13. Desktop and iOS should not have identical UX

Same underlying visual language.

Different interaction model.

### Desktop

Designed for **exploration**.

* hover
* mouse pan
* keyboard shortcuts eventually
* larger map
* filtering
* deep browsing

### iOS

Designed for **what's around me / where am I going**.

Probably closer to:

```text
        MAP
        MAP
      ● YOU
   △       △
        MAP

───────────────
Nearby
Track A
Track B
Shop C
```

Bottom sheet instead of side panel.

But the icons, colors, progression, terminology and states stay identical.

That keeps the brand coherent.

---

# 14. I would define four primary use cases now

Everything else can wait.

### A — Follow the 100 Tracks journey

> “Where has he been?”

Open map → Series Mode → see 2/100 → inspect completed tracks → watch episode.

This is the **public storytelling product**.

---

### B — Find places to ride

> “What's around here?”

Tracks become the main layer.

Later becomes useful independently of your videos.

---

### C — Explore the local scene

> “What dirt-bike stuff exists around here?”

Tracks + shops + mechanics + events + personalities.

This becomes the **DirtBikeX world**.

---

### D — Discover stories geographically

> “What's interesting over there?”

Zoom into another city.

See:

```text
TRACK
TRACK
SHOP
MECHANIC
TRACK OWNER
EVENT
```

Now geography itself becomes content discovery.

This is the most distinctive long-term use case.

---

# 15. Visual direction I'd choose

If we put NFS Underground 2 on one end:

**arcade / underground / tuner / neon / aggressive**

and GTA V on the other:

**clean / cartographic / utilitarian / game UI**

I would put DirtBikeX roughly here:

```text
NFS U2                     DirtBikeX          GTA V
│────────────────────────────●──────────────────│
```

Take from NFS:

* feeling of discovering locations
* iconography
* mission selection
* progression
* attitude

Take from GTA:

* restrained map
* strong category symbols
* excellent spatial legibility
* map filters
* zoom-dependent detail

Don't go full fluorescent NFS tuner UI. It would get old quickly and compete with footage.

I'd describe the intended look as:

> **Off-road GPS meets open-world game map.**

Black/charcoal background, subdued terrain, almost monochrome basemap, bold DirtBikeX icons, tactile selection animation, strong typography.

---

# 16. Overall product hierarchy

I would therefore conceptualize the system as:

```text
                    DIRTBIKEX WORLD
                          │
             ┌────────────┴────────────┐
             │                         │
          PLACES                    STORIES
             │                         │
     ┌───────┼────────┐         ┌──────┼──────┐
     │       │        │         │      │      │
   TRACKS   SHOPS   EVENTS    SERIES  PEOPLE  QUESTS
     │
     │
VISITING 100 TRACKS
     │
 ┌───┼───┬───┬────── ...
001 002 003 004
 ✓   ✓
```

The crucial architectural idea is **not to make “100 tracks” the database model**.

Make the **world map the product model**, and make *Visiting 100 Dirt Bike Tracks* one curated journey through that world.

That leaves you room for future video series like:

* visiting mechanics
* meeting track builders
* riding with locals
* finding strange bikes
* regional tours
* “side quests”

without rebuilding the map concept every time.

And visually, the user experiences all of them as **missions appearing on the same world map**.

That, to me, is the version worth building.
