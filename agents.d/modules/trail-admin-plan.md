---
kind: note
status: in-progress
summary: a page listing and mapping every uploaded trail with simple administration, behind Cloudflare Zero Trust — or a tab in the Discourse plug…
---

# TRAIL_ADMIN_PLAN — where the operator surface for trails belongs

**Status: discussion, rev 1. No code written.** Answers the question asked on 2026-08-22:
a page listing and mapping every uploaded trail with simple administration, behind
Cloudflare Zero Trust — or a tab in the Discourse plugin settings instead?

Companion to
[TRAIL_UPLOAD_MODULE](trail-upload.md)
and [TRAIL_PRECEDENCE_PLAN](trail-precedence-plan.md).

## 1. One correction before the options

> *"Cloudflare Zero Trust that uses an email and the authentication code that is already in
> the landing page repo."*

**There is no email-and-code login in the landing repo.** What is there is
`handleJoinConfirm` — a double-opt-in confirmation link for the waitlist — and
`handleCodePrecheck`, which checks an invite code's validity. Neither issues a session,
neither authenticates a person, and neither is reusable as a login.

The good news is that nothing needs to be. **Cloudflare Access provides email one-time-PIN
natively**: you list the allowed addresses in a policy, Cloudflare emails the code, and the
origin receives a signed JWT. It is exactly the flow described, it requires no auth code in
this repo at all, and it is already the house pattern — the infra guides use Access for
Grafana. So "Zero Trust with an email code" is a *configuration*, not a build.

That removes auth from the comparison entirely, which is what makes the rest of it decidable
on other grounds.

## 2. What the surface actually has to do

| | Operation | Where the data lives |
|---|---|---|
| 1 | List every trail: state, age, expiry, author, size | **D1** |
| 2 | See them on a map, including the private ones | **D1** + the GPX on the CDN |
| 3 | Take one down | forum post (plugin) **and** D1 |
| 4 | Unpublish without deleting | D1, via the plugin's `set_state` |
| 5 | Publish past the cap — the escape hatch | D1 |
| 6 | Turn uploading off | worker var today |
| 7 | Find orphans: uploads with no row, rows with no post | **both**, compared |

The split in that last column is the whole answer. **Half of these are about the map's index
and half are about a person's content**, and the two live in different systems with
different owners.

## 3. The constraint that decides it

**The plugin cannot read D1.** The trail index is a Cloudflare D1 database bound to the
landing worker; Discourse has no route to it. Everything a plugin admin tab showed would
have to be proxied through worker endpoints that do not exist yet — one more hop, one more
shared-secret surface, and a page that goes blank when the worker is unreachable.

**The worker cannot read the forum.** It holds one Discourse scope, `uploads:create`. It
cannot see posts, users, or staff identity. Everything an Access-protected page showed about
*who* a trail belongs to comes from the columns D1 already caches — and any action on the
post has to go back through the plugin.

Neither system can do the whole job alone, and that is not a flaw to engineer around. It is
the same separation the feature already rests on: **the map owns the index, the forum owns
the people.**

## 4. The options

### A — a page in the landing repo, behind Cloudflare Access

**For:** it is where the data is, so no proxy. The map view is nearly free — MapLibre, the
trail layer and the GPX proxy are all already there, and rendering private trails is the
`?trail=` path that exists. It works when the forum is down, which is exactly when you most
want to look at the index. Access email-OTP is configuration only.

**Against:** a second origin to secure, and Access is a per-request dependency on Cloudflare
being reachable — from mainland China, on a bad day, that is not free. No staff identity, so
no audit trail: every action is "somebody on the allowlist did this". Any action touching a
post still needs the plugin.

### B — a tab in the Discourse plugin

**For:** staff identity, permissions and `StaffActionLogger` audit for free, in a place
moderators already open. Actions on posts are local. Zero new auth, zero new origin. The
plugin already has `dbx_trail_claims`, so claims and visibility are half-visible there
already.

**Against:** it can only show what the plugin knows. Unclaimed trails — the ones that
actually need watching, because they are the abuse surface and they expire — have **no row
in the plugin at all**. A tab that cannot see them is not the surface being asked for. A map
view would mean rebuilding MapLibre inside a Discourse admin page.

### C — both, in that order

The plugin owns the **actions**, which are about people and want audit. The Access page owns
the **index**, which is about the map and wants the map.

## 5. Recommendation

**Start with B for actions and add A only when the map view earns itself.**

The reason is not effort, it is accountability: taking somebody's ride off the map is a
moderation act, and moderation acts should be attributable and logged. Discourse gives that
for nothing. An Access allowlist gives an email address and no record.

Concretely, phase one is small because most of it exists:

- The plugin already drops a trail when its post is destroyed, so "take one down" is already
  a moderator deleting a post. The tab mostly needs to make that *findable*.
- `dbx_trail_claims` already holds every claimed trail; a tab listing them, with the
  visibility toggle staff can already reach, covers operations 3, 4 and 5.
- One new worker endpoint — a plugin-only, bearer-gated `GET /api/map/trails/admin.json` —
  covers 1 and 7 for the unclaimed rows the plugin cannot see. It is the same shared token
  and the same direction of trust the reconcile pull already uses.

Phase two, if wanted: `/admin/trails` in the landing repo behind Access, read-only, with the
map. Read-only is the point — every mutation stays in the forum where it is logged.

## 6. The toggle, which is a different question than it looks

`TRAILS_UPLOAD_ENABLED` is a wrangler var today. **It should stay one**, and a plugin
setting should not replace it.

A kill switch exists to stop something going wrong. If the worker took its own switch from
the forum, then the forum being compromised, misconfigured or simply down would decide
whether an unauthenticated write endpoint is open — which is backwards for the one control
whose job is to shut that endpoint.

What a plugin setting *can* honestly be is a **soft** switch:

| | Where | Effect | Survives a forum outage |
|---|---|---|---|
| Hard switch | `TRAILS_UPLOAD_ENABLED` (wrangler var) | the endpoint refuses; the control greys out | yes |
| Soft switch | a Discourse site setting | hides the control; the endpoint still works | no |

The soft one is a browser toggle for a moderator who wants to pause visible promotion. The
hard one is an operator action — editing `wrangler.jsonc` and deploying — and that is the
honest description of it. Worth saying plainly rather than letting a settings tab imply
otherwise.

**If a real browser control over the hard switch is a requirement**, the shape that does not
invert the trust is: the plugin passes its setting as a field on the publish call it is
already making, so the value travels with a request that already exists — no polling, no
cache, no invalidation bug — and the worker still refuses on its own var regardless. The
forum can then only ever be *more* restrictive than the worker, never less.

## 7. What I would want answered before building either

1. **Who is "the admin"?** One person, or a moderator group? B is obviously right for a
   group; A is defensible for one operator.
2. **Is the map view a want or a need?** It is the one thing B genuinely cannot do well, and
   the whole case for A rests on it.
3. **Does an operator need to see unclaimed trails?** If yes, B needs the worker endpoint on
   day one. If the answer is "only when something is wrong", it can wait.
4. **What happens from mainland China when Cloudflare Access is having a bad day?** The forum
   is reachable through its own tunnel; an Access-gated page is not.

---

**Related:**
[TRAIL_UPLOAD_MODULE](trail-upload.md) ·
[TRAIL_PRECEDENCE_PLAN](trail-precedence-plan.md) ·
[MAP_MODULE](map.md)
