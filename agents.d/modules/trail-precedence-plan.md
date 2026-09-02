---
kind: spec
status: in-progress
summary: 2026-08-21, corrects one part of it that is unsafe as stated, and enumerates the cases it has to answer. Companion to TRAILUPLOADMODULE.
---

# TRAIL_PRECEDENCE_PLAN — who holds a spot on the map

**Status: proposal, rev 1. No code written.** Formalises the precedence rule proposed on
2026-08-21, corrects one part of it that is unsafe as stated, and enumerates the cases it
has to answer. Companion to
[TRAIL_UPLOAD_MODULE](TRAIL_UPLOAD_MODULE.md).

## 1. What was proposed

> An unclaimed anonymous trail must not block a new upload — your pending trail can still
> go onto the map. If yours is successfully claimed, an overlapping *unclaimed* trail is
> overwritten by yours. A claimed public trail cannot be overwritten by anyone; only an
> admin can take it down. Among anonymous trails at one spot, the most recent wins.

The ladder is right. **Operator > claimed > anonymous, newest-first within a tier** is a
clean, defensible ordering, and "an unclaimed trail does not reserve ground" is exactly the
correct instinct — a trail nobody has signed for should not be able to keep a real rider
off the map.

## 2. The one part that has to change

**Precedence must decide what is *displayed*. It must never delete anything.**

As written, "overwritten" is a remote delete primitive. Anyone could destroy a stranger's
pending trail by uploading a GPX near it: their link dies, their 72-hour claim window dies,
and they are never told. It is triggerable by anonymous strangers, at 6 uploads an hour,
against content whose entire value is that one link.

Nothing is lost by weakening it, because **display is all that was ever at stake.** An
unclaimed trail is already invisible to everyone but its link holder. "Overwriting" it
removes nothing from the map, because it was never on the map — it only takes someone's
ride away from them.

So the rule becomes:

> Every trail keeps existing and stays reachable by its own link. Precedence decides only
> which trails the **public map** draws when several cover the same ground. A trail that
> loses is hidden from the map, not destroyed, and it wins the spot back the moment the
> trail above it goes away.

This also makes the rest of the model work, because it forces precedence to be computed
**at read time from current state** rather than stored as a "suppressed" flag. Every one of
the awkward cases in §6 — unpublish, delete, re-publish, expiry — resolves itself for free
if nothing is ever written down as a loser.

## 3. The decision I need from you

Your message says a pending trail "can still go onto the map", but two messages earlier you
confirmed the opposite: *"anon uploads should not be world viewable, only claimed public
track is viewable."* Both cannot hold. Which did you mean?

| | **Fork A — as shipped** | **Fork B — provisional pins** |
|---|---|---|
| An unclaimed trail is | invisible to everyone but its link holder | drawn on the public map, faintly, from the moment it uploads |
| "Newest anonymous wins" | **has no effect** — nothing anonymous is on the map, so there is no spot to win | is the live rule, and does real work |
| A stranger's upload is | private until they choose otherwise | published without them ever agreeing to it |
| Privacy | an anonymous visitor's home-area trace stays theirs | a GPS trace of where someone lives goes public on drop, with no account and no consent step |
| Effort | nothing to build; precedence reduces to claimed-vs-claimed | the whole ladder, plus a provisional pin style, plus a takedown path for content nobody owns |

**I recommend Fork A**, and I think it is what you meant: "can still go onto the map" reads
naturally as *"can still eventually reach the map once claimed"* — i.e. an unclaimed trail
does not **reserve** the ground against you. Under Fork A that is automatically true, and
most of the proposed ladder is simply never exercised.

Fork B publishes a stranger's precise riding location before they have agreed to anything,
which is the one thing this feature was designed not to do. If you want the *discoverability*
that Fork B buys, §7 gets it without the disclosure.

**Everything below assumes Fork A.** Say the word and I will rewrite it for B.

## 4. The ladder, formalised

Evaluated at read time, per conflict group (§5), highest tier first:

| Tier | Who | Removable by |
|---|---|---|
| 1 | **Operator-curated** — imported from the R2 document | operator only |
| 2 | **Claimed and published** — bound to a forum account and a post | its owner (delete the post), or staff |
| 3 | **Claimed and private** | its owner. Never on the map by definition |
| 4 | **Unclaimed** | expiry, at 72 h. Never on the map by definition |

Within a tier, **newest `created_at` wins**, using the server's clock in D1 and never the
client's. Ties break by `id`, ascending, so the map cannot flicker between two orderings.

Tiers 3 and 4 are on the ladder only so the rule is total. They never render, so they never
contend. **In practice, precedence today is a rule about tier 1 versus tier 2.**

### Losers are hidden, not suppressed

A losing trail is absent from `/api/map/trails.json` for as long as it loses, and returns
by itself when it stops losing. No column records it. The only state is the trails
themselves.

## 5. What counts as "the same spot"

Two published trails conflict when **all three** hold:

| Test | Threshold | Why this one |
|---|---|---|
| centre distance | **< 2 km** | one riding area — a park, a practice loop, one trailhead's ground. At z13 that is most of a phone screen |
| `distance_km` ratio | within **±25%** | stops a 400 m practice loop suppressing a 60 km trail ride that happens to start at the same car park |
| bbox overlap | **> 60%** of the smaller box | two rides from one trailhead heading opposite ways share a centre and share almost no ground |

All three numbers are geometry, not data — there are two public trails on staging. They
belong in **one exported constant block**, because the first real club will make one of them
wrong.

Deliberately **not** used: Fréchet or Hausdorff trace similarity. It is the correct measure
and it is out of reach — the free plan gives a Worker about 10 ms of CPU, and this would
run per pair per document build. If exact comparison is ever wanted it goes client-side, at
publish time, where the browser already holds both files.

Exact-duplicate detection is separate and nearly free: `gpx_sha1` is already stored. See §7.

## 6. The cases

Including the ones not raised. Each answer is what falls out of §2 and §4 — none is a
special case.

| # | Case | What happens | Note |
|---|---|---|---|
| 1 | Two people upload the same ground; neither claims | both invisible, both expire at 72 h | no interaction at all |
| 2 | A claims and publishes; B's unclaimed trail overlaps | A is on the map. B's is untouched and B's link still works | **this is the fix to §2**: no deletion |
| 3 | B then claims and publishes too | both are tier 2. Newest wins the pin; the other is hidden, not deleted | see §8 — I would rather **cluster** than hide |
| 4 | A unpublishes; B was hidden behind A | B appears within one cache cycle | read-time evaluation, no flag to unwind |
| 5 | A deletes the post; B was hidden behind A | B appears. A's row is dropped by `on(:post_destroyed)` | already built |
| 6 | A republishes later | A and B coexist; newest wins the pin | no ground is ever reserved |
| 7 | A publishes overlapping a **curated** trail | curated wins, always | **and a publisher can currently choose `id` freely — a curated id must be refused.** Live bug, see §9 |
| 8 | Group ride: five riders publish the same GPX | one file, five owners, all legitimate | sha1 dedup among public rows only — never across owners at upload (§7) |
| 9 | One rider publishes 12 laps of their home track | the per-author cap refuses the 4th within 2 km | this, not precedence, is the clutter tool |
| 10 | A rider re-uploads a corrected file | it is a new trail; they delete the old post | fine, and already works |
| 11 | Staff takedown of a published trail | staff delete the post; the trail leaves the map | works today. There is **no** "hide from the map but keep the post" — worth having |
| 12 | An unclaimed trail loses and then expires | nothing to do | expiry is independent of precedence |
| 13 | Two trails with identical `created_at` | break by `id` ascending | deterministic, or the pin flickers between document builds |
| 14 | A newly published trail should displace an older one | up to **24 h late** | `trails.json` is edge-cached for a day. Publishing must purge, or precedence looks broken |
| 15 | Should a long-standing member outrank a new account? | **no** | invites gaming, and "who deserves the pin" is not a judgement this map should make |

## 7. "If a trail is invisible, how does the next uploader know it is there?"

They do not, and under Fork A they do not need to — **an invisible trail is invisible
precisely because it is not on the map, so it is not in anyone's way.** The question only
bites at publish, and by then every trail that matters is visible.

What is worth building, in order:

1. **A density hint from published trails only.** On the result sheet: *"3 published trails
   within 2 km of here."* Costs one query, discloses nothing that is not already on the map.
2. **A publish-time overlap nudge**, not a refusal: *"This looks like <trail>. Publish
   anyway, or keep it private?"* Publish is where clutter is created, and it is the first
   moment there is an authenticated person to talk to.
3. **Exact-file dedup at publish**, among public rows only.

And one rule that must not be broken: **no signal may be derived from private or unclaimed
trails, not even a count.** A count is a location oracle — grid the country, read the
counts, and you have found where people ride. If it cannot be computed from the public map,
it cannot be shown.

That is also why sha1 dedup belongs at publish and never at upload. If uploading known
bytes returned the existing row, anyone who fetched a published `.gpx` — they are on a
public CDN — could re-upload it and be handed the **claim credential** for a stranger's
pending trail.

## 8. Where I would go further than you did

**Prefer clustering to hiding, for tier 2 versus tier 2.** Case 3 is two real riders who
both did the work. Hiding one because the other was a minute later is a worse outcome than
a slightly busier pin, and the map already clusters above a zoom threshold. Precedence then
only decides which trail *labels* the cluster, and nothing is ever taken away from anyone.

That leaves the ladder doing exactly one job: **curated beats visitor content**, which is
the only place suppression is clearly right.

## 9. Two live bugs this surfaced

- **A publisher chooses their own `id`.** `handleTrailState` takes a caller-supplied slug,
  and `publicTrailEntries` concatenates onto the curated document with no collision check.
  Publishing with `id: "xihu-easter-egg"` puts a stranger's entry beside a curated one under
  the same id. Curated ids must be reserved and visitor ids namespaced or checked.
- **Publishing does not purge the edge cache**, so a new public trail can be up to 24 hours
  late to the map (case 14). Today that reads as "publishing did nothing".

Neither is caused by precedence; both have to be fixed before precedence would behave.

## 10. What I would build, in order

1. Reserve curated ids and purge on publish — §9. Independent of everything else.
2. The per-author publish cap: **3 published trails within 2 km**, plus sha1 uniqueness
   among public rows. Refuse at publish with a real message; the trail stays private with a
   working link, and unpublishing a nearby one frees a slot instantly.
3. The density hint on the result sheet — §7.1.
4. Clustering for tier 2 conflicts — §8.
5. Curated-beats-visitor suppression — the only precedence rule that then remains.

Steps 1–3 are most of the value. Step 5 is the smallest piece of the thing this document is
named after, which is usually the sign the model is right.

---

**Related:** [TRAIL_UPLOAD_MODULE](TRAIL_UPLOAD_MODULE.md) ·
[TRAILS_MODULE](TRAILS_MODULE.md) ·
[MAP_MODULE](MAP_MODULE.md)
