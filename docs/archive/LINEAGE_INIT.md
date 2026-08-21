Q: To build an apprenticeship tracking system, what are some UX and user case? I can think of the family-tree-like visualization, but what else?

---

The family tree is only the **visualization layer**. The more interesting product is an **apprenticeship / knowledge-lineage system**: who taught whom, *what* they taught, when, how deeply, and whether that relationship is recognized by both sides.

For DirtBikeX, I would avoid making it feel like LinkedIn endorsements. It should feel closer to **martial-arts lineage + riding résumé + local scene history**.

### 1. Rider lineage graph — the obvious one

Instead of a strict tree:

> 老王 → 阿强 → Rubio

make it a **directed graph**, because riders can have multiple mentors:

```text
                   ┌─ Zhang [MX technique]
Lao Wang ──────────┤
                   └─ Chen [track building]
                           │
                           ▼
                         Rubio
                           ▲
                           │
Mike [enduro/navigation] ──┘
```

Each edge should carry meaning:

**Mentor → Student**

* MX riding
* Enduro
* Hard enduro
* Track building
* Bike maintenance
* Suspension setup
* Racecraft
* Coaching
* Trail knowledge

So my profile could say:

> **Learned MX fundamentals from 老王**
> 2026 · Zhejiang · 8 sessions
> Confirmed by 老王

That is much stronger than merely connecting two avatars.

---

## 2. The profile becomes a "rider provenance"

Click a rider and you should immediately understand:

**Who taught this person?**
**Who have they taught?**
**What do people know them for?**

Something like:

```text
老王
20+ years riding

KNOWN FOR
Track Building · MX Coaching · Zhejiang Scene

MENTORS
老李 ── MX / 2005–2008

STUDENTS
18 confirmed riders
└─ 阿强
└─ 小周
└─ Rubio
└─ +15

KNOWLEDGE PASSED DOWN
Track building ███████
MX technique   ███████
Maintenance    ███
Enduro         ██
```

This gives experienced people a reason to actually care about their DirtBikeX profile.

---

## 3. "Add my mentor" is probably the killer interaction

Don't make users manually construct graphs.

On my profile:

**Who taught you to ride?**

Then:

> Search rider / invite someone

And:

> What did they teach you?

Pick 1–3 tags.

> Roughly when?

Then send:

> **Rubio says you taught him MX riding in 2026. Confirm?**

`[ Confirm ] [ Edit ] [ Decline ]`

Once confirmed, the lineage becomes solid.

I'd visually distinguish:

* ✓ Mutual confirmation
* ○ Student-reported
* ◇ Historical / community-added

That prevents the graph becoming bullshit.

---

# But there are much better UX opportunities than the family tree

### 4. "How am I connected to this guy?"

This could be one of the coolest features.

You're viewing some famous/local rider:

> **You are 3 generations away from 王师傅**

```text
You
 ↓ learned from
阿强
 ↓ learned from
老周
 ↓ learned from
王师傅
```

Essentially **degrees of separation for dirt-bike knowledge**.

For a small scene, this is extremely compelling because people constantly have relationships like:

> "Oh, you learned from HIM? I learned from his student."

It turns offline scene relationships into something discoverable.

---

### 5. Track lineage

Don't restrict apprenticeship to people.

Tracks themselves have lineage.

```text
老王
│
├── built → Xinchang MX
│
└── taught → 阿强
             │
             └── built → Hangzhou MX
```

Now you can answer:

> **Who built this track?**

And even:

> **Which other tracks were influenced by this builder?**

This becomes particularly valuable for your 100 Tracks series.

You could eventually discover:

> 13 Zhejiang tracks trace back to 3 builders.

That's an actual cultural map of the scene.

---

### 6. Skill lineage

Another visualization:

Click **"Track Building"**.

Instead of viewing people generally, see:

```text
TRACK BUILDING

老王
├── 阿强
│   ├── Rider C
│   └── Rider D
└── 老周
    └── Rider E
```

Change filter:

**MX coaching**

and an entirely different graph appears.

This solves a major flaw of normal family trees: people don't have one lineage.

They have **different lineage per domain**.

---

### 7. Apprenticeship timeline

I'd actually consider this more useful than the tree on mobile.

```text
2021
Started riding
   │
2022
   ├── Learned basic MX
   │   老周 · 12 sessions
   │
2023
   ├── First race
   │
2024
   ├── Learned suspension setup
   │   陈师傅
   │
2025
   ├── Started coaching
   │
2026
   └── Students: 6
```

This tells a person's **riding story**.

Much easier to consume on TikTok-generation mobile UX than a giant node graph.

---

# 8. Apprenticeship isn't necessarily binary

This is important.

Don't model:

`A taught B = true`

Model **relationships/events**.

For example:

```text
Teacher: 老王
Student: Rubio

Domain: MX
Relationship:
    Formal student
Period:
    Aug 2026 → present
Sessions:
    4
Tracks:
    Xinchang MX
Skills:
    Body position
    Cornering
    Jumping basics
Status:
    Confirmed by both
```

Someone who showed me cornering once shouldn't appear equivalent to someone who trained me for three years.

UX labels might be:

**Learned from**

rather than forcing everyone to claim:

**Master / Apprentice**

because 师父/徒弟 can carry serious cultural meaning.

Let the participants optionally elevate it to:

> 师父 / 徒弟
> Coach / Rider
> Mentor / Student

---

# 9. "What can this person teach me?"

This turns historical data into utility.

Suppose I'm browsing someone nearby:

> **陈师傅**
>
> 17 years riding
> 11 riders learned bike maintenance from him
> 7 confirmed students
>
> Known for:
>
> * carburetors
> * 2-stroke rebuilding
> * suspension
>
> **Ask to learn**

Now the lineage system starts becoming a **mentor discovery network**.

Eventually:

> Find someone near Hangzhou who can teach me hard enduro.

That's a real use case rather than social decoration.

---

# 10. Scene genealogy

This is where I think it becomes uniquely DirtBikeX.

Zoom out from an individual and show:

**Zhejiang Dirt Bike Scene**

```text
                 [ 老王 ]
             2004 · Hangzhou
               /       \
              /         \
      [ 老周 ]           [ 阿强 ]
        │                /    \
        │               /      \
    9 riders        14 riders   [Track X]
```

Then overlay:

* people
* tracks
* clubs
* shops
* builders

You're basically documenting **how the scene propagated**.

That fits your map product extremely well.

Your GTA-style map answers:

> **Where is the scene?**

The apprenticeship graph answers:

> **How did the scene get here?**

Those two systems reinforce each other.

---

## 11. Legacy / contribution stats

Don't gamify it into cheesy XP.

But some metrics could be genuinely meaningful:

**老王**

* 24 confirmed students
* 3 generations of riders
* 47 downstream riders
* 4 tracks built
* active since 2004

And the coolest number:

> **47 riders trace part of their riding lineage back to 老王.**

For the 53-year-old rider you've been talking about, **this is far more respectful and interesting than follower count**.

It captures actual influence.

---

# 12. Content integration

This is where it becomes useful to *you* immediately.

During your video:

> "He told me he's taught a ton of riders over the years."

Cut to DirtBikeX:

```text
老王
      ↓
 ┌────┼────┐
 ↓    ↓    ↓
 A    B    C
 ↓         ↓
...
```

Then:

> "So I started mapping his dirt-bike family tree."

Now the feature itself becomes storytelling content.

And every time you interview someone:

> Who taught you?
> Who did you teach?
> Who built this track?
> Who taught you how to build tracks?

You're simultaneously gathering **oral history + graph data**.

---

# I would structure the product around 5 views

| View         | Question it answers                          |
| ------------ | -------------------------------------------- |
| **Lineage**  | Who taught whom?                             |
| **Timeline** | How did this rider develop?                  |
| **Skills**   | What knowledge flowed between them?          |
| **Map**      | Where did these relationships happen?        |
| **Legacy**   | What downstream impact did this person have? |

And underneath them all, don't build a "family tree database."

Build a **relationship graph**:

```text
Person ──learned_from──> Person
Person ──coached───────> Person
Person ──built─────────> Track
Person ──rides_at──────> Track
Person ──works_at──────> Shop
Person ──member_of─────> Club
Track  ──influenced_by─> Track
```

Then the family tree is merely **one way of querying the graph**.

That architecture has considerably more upside.

The product idea I find strongest is therefore not **"DirtBikeX Apprenticeship Tree."** Conceptually, I'd frame it as **the lineage of the dirt-bike scene**—apprenticeship is the first and most human relationship you use to build it.


---

Q: The validity of knowledge is a big concern, and participation rate for a cold launched app is low. How would you design a campaign to onboard the relationship filling?

---


I would **not** launch this as “help us fill the apprenticeship database.” That creates the two problems you identified simultaneously: too much work for cold users, and low-quality self-reported data.

The campaign should feel more like **“claim your place in the local riding lineage.”** The database filling happens underneath.

The central mechanic I’d use is a **seed → claim → confirm → expand** loop.

### 1. Seed the graph yourself before asking anyone to participate

For each local scene, start with 1–3 highly connected people—the old coach, track owner, mechanic, builder, long-time rider.

During your interview, collect something like:

> Who taught you?
> Who are some people you taught?
> Who did those people go on to teach?

You create an **unclaimed draft graph** from that.

For example:

```text
                    Lao Wang
               ┌──────┼──────┐
               ↓      ↓      ↓
             Zhang   Chen    Li
                     │
                     ↓
                   Rubio
```

But critically, internally:

```text
Lao Wang → Zhang
source: Lao Wang
status: unconfirmed by Zhang
```

So you're not pretending that every edge is equally authoritative.

When someone first arrives, they **don't see an empty app**. They see:

> You're already part of this story.

That's a drastically different onboarding experience.

---

## 2. The campaign itself: “Who taught you?”

I'd make this the public-facing concept.

Not:

> Build your DirtBikeX apprenticeship network.

But:

> **Who taught you to ride?**

It's an extremely low-effort question and has an emotional answer.

Then after they select somebody:

> What did they teach you?

`MX` `Enduro` `Bike setup` `Track building` `Other`

And you're done.

**One relationship is enough to complete onboarding.**

Do not ask:

* entire riding history
* dates
* all teachers
* all students
* proof
* detailed skill classification

during initial contribution.

Those are progressive enrichment.

---

# 3. Then reverse the direction

Once someone confirms their mentor:

> **Who have you passed this on to?**

Now you're exploiting something interesting about established riders: they may not particularly care about documenting who taught them, but they often **do care about the people they've helped**.

So there are two campaign entry points:

### Younger/new rider

> **Who taught you?**

### Veteran

> **Who have you taught?**

Both produce the same graph.

That distinction matters a lot.

---

# 4. Make confirmation itself an acquisition mechanism

Suppose Lao Wang says he taught Zhang.

Zhang receives:

> **Lao Wang added you to his riding lineage.**
>
> He says he taught you MX riding around 2016.
>
> ✓ Yep
> Edit details
> Not accurate

This is far stronger than:

> Join DirtBikeX!

There is already something personally relevant waiting for him.

And once Zhang confirms:

> **You're now connected to 17 riders across 3 generations.**

Then:

> Add the person who taught you →

or:

> Add someone you've taught →

That's your viral loop.

```text
Existing rider
      │
      │ names
      ▼
Unregistered rider
      │
      │ receives personal claim
      ▼
Confirms relationship
      │
      │ names another person
      ▼
Next rider
```

You're not asking users to **invite friends to an app**.

You're asking them to **verify a fact about themselves**.

Much lower psychological resistance.

---

# 5. Validity should be visible, not hidden

I wouldn't try to manufacture a binary “verified / fake” system.

Use **provenance**.

For every relationship, store:

| State               | Meaning                                 |
| ------------------- | --------------------------------------- |
| Reported            | One person says this happened           |
| Confirmed           | Both people agree                       |
| Community-supported | Multiple independent people reported it |
| Documented          | Supporting historical evidence exists   |
| Disputed            | Parties disagree                        |

So the UI might show:

> **Lao Wang → Zhang**
> MX coaching · ~2016
> ✓ Confirmed by both

versus:

> **Lao Wang → Li**
> Track building
> ○ Reported by Lao Wang

This is much more intellectually defensible.

You aren't claiming **“DirtBikeX says this is true.”**

You're claiming:

> **“This is what these participants say happened.”**

That's essentially oral-history provenance.

---

# 6. Allow imperfect information

One major participation killer would be requiring exact dates.

Someone may say:

> 老王教我的？操，十几年前吧。

That's valid data.

Store:

```text
start_year:
    ~2012

precision:
    approximate
```

Or simply:

> Early 2010s

Same with relationship intensity:

> taught me once
> trained together regularly
> coach
> 师父

Don't force a Western formal definition of apprenticeship onto informal Chinese dirt-bike relationships.

---

# 7. The reward should be revelation, not points

I wouldn't give:

> +50 XP for adding your teacher!

That cheapens the whole concept and incentivizes garbage.

Instead, the reward is **seeing more of the network**.

User adds one relationship.

Then:

> **We found your lineage.**

```text
       老李
        ↓
       老王
      ↙   ↘
   Zhang  Chen
            ↓
           YOU
```

Then:

> **4 generations · 31 connected riders**

That is intrinsically interesting.

You can even progressively reveal it:

> Add or confirm one relationship to trace your lineage.

This creates motivation without turning cultural history into FarmVille.

---

# 8. Give veterans a “legacy page”

This is probably the strongest participation incentive for the people whose information you actually need most.

Instead of asking a 53-year-old veteran to create a profile because your startup needs users, show him:

> **Your Dirt Bike Legacy**

```text
20 years riding

18
direct students

43
riders downstream

3
generations

2
tracks built
```

Then:

> **Are we missing anyone?**

That question is almost irresistible compared with:

> Please fill in your apprenticeship information.

Because now he has a reason to correct your data.

This is basically the Wikipedia dynamic:

**Don't ask somebody to create the page. Show them an incomplete page about something they know intimately.**

Correction is easier than creation.

---

# 9. I would deliberately create “missing people”

Suppose the veteran tells you:

> “还有小陈，小陈也是我带出来的。”

Don't require 小陈 to already have DirtBikeX.

Create:

```text
小陈
Unclaimed rider
Reported by 老王
```

Now the graph can exist before account creation.

Shareable page:

> **Is this you? Claim this rider.**

This is essential.

If every graph node requires an existing registered user, your cold-start problem becomes almost impossible.

The **social graph needs to grow faster than the account graph**.

---

# 10. Run this geographically, not globally

I'd avoid:

> DirtBikeX Global Lineage Campaign

Initially.

Choose one dense community where you already have access.

For example:

> **We're mapping the first generation of Zhejiang dirt-bike riders.**

Now it becomes almost an ethnographic/local-history project.

Your campaign content could repeatedly expose holes:

> “Apparently half the riders I meet keep mentioning the same three guys.”

Then show the graph.

Next video:

> “So I went to find one of them.”

Then:

> “He just added seven more people.”

Now the **campaign itself becomes a story arc**.

And every participant is socially motivated to see themselves appear in it.

---

# 11. Use your videos as the top of the funnel

This fits your existing content system particularly well.

You meet an influential rider.

Instead of merely saying:

> He has trained lots of riders.

You show:

```text
         HIM
      / / | \ \
     ? ?  ?  ? ?
```

> “He claims he's taught half the riders around here.
> So we're gonna find out.”

Then over subsequent videos, nodes become confirmed.

That's a surprisingly good recurring content device because the software visualization becomes part of the narrative.

Eventually:

> **18 claimed. 14 confirmed. 4 still missing.**

Now viewers can literally participate in finishing an episode/story.

---

# 12. I'd make the campaign funnel extremely small

The entire first-time UX could be:

**Screen 1**

> ### Who taught you to ride?
>
> Search their name or add them.

**Screen 2**

> ### What did you learn from them?
>
> `[MX] [Enduro] [Mechanics] [Track Building] [+]`

**Screen 3**

> ### Is this about right?
>
> `Around 2021`
> optional

**Done**

Then immediately:

> ### You're connected.
>
> **3 generations · 12 riders**
>
> `[Explore lineage]`

And *after* delivering the reward:

> Know someone we've missed?

That sequence matters:

**contribute → reward → ask again**, rather than **form → form → form → signup → form**.

---

## The campaign loop I'd actually build

It ultimately becomes this:

```text
1. INTERVIEW
   Veteran gives names
          ↓
2. SEED
   DirtBikeX creates provisional relationships
          ↓
3. CONTENT
   Publish partial lineage
          ↓
4. CLAIM
   Named riders recognize themselves
          ↓
5. CONFIRM
   One-tap relationship verification
          ↓
6. EXPAND
   "Who taught you / who did you teach?"
          ↓
7. REVEAL
   Show larger personal lineage
          ↓
8. SHARE
   Personalized lineage card
          ↓
       repeat
```

And I think there is an important conceptual distinction here:

**Your first campaign isn't actually a user-generated-data campaign.**

It's a **collaboratively verified oral-history campaign**.

You and a few well-connected riders do the expensive work of producing the initial graph. Ordinary users mostly **recognize, claim, confirm, correct, and add one missing edge**.

That's much more compatible with the participation economics of a cold-start community than expecting hundreds of people to enthusiastically build a database for you.
