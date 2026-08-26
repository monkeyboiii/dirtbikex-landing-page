# D1 migrations — read before running anything

## Never run `wrangler d1 migrations apply` against `dbx-subscribers`

It would drop the live outreach ledger.

`dbx-subscribers` was provisioned with direct `wrangler d1 execute --file` runs, so the
`d1_migrations` bookkeeping table **exists but is empty** — verified on prod 2026-08-26,
`SELECT count(*) FROM d1_migrations` → 0. `migrations apply` reads that table to decide what
is outstanding, sees nothing recorded, and replays **every file in this directory from 0001**.

`0007_outreach_pk.sql` is not idempotent. It rebuilds the table:

```sql
CREATE TABLE outreach_new ( … );
DROP TABLE outreach;
ALTER TABLE outreach_new RENAME TO outreach;
```

Replaying that destroys the send-once history and the suppression linkage — the records that
are the only thing stopping a contact being re-mailed.

## Apply new migrations one file at a time, by database id

```shell
pnpm dlx wrangler d1 execute <DB_ID> --remote --file ./migrations/00NN_name.sql -y
```

**Address the database by id, never by name.** Prod and preview both answer to the *name*
`dbx-subscribers`; only the id distinguishes them. Getting this wrong writes prod schema into
preview or the reverse.

| Environment | id |
|---|---|
| prod | `f906ae03-0e7a-4c0d-b113-bb472a15f61b` |
| preview | see `wrangler.jsonc` → `env.preview.d1_databases` |

## Applied state

Prod is at **0013** as of 2026-08-26 (`0009`–`0013` were applied during the
`v1.0.3-beta.3` → `v1.0.4-beta.1` upgrade). There is no automated record of this — the ledger
is empty — so this file is the record. **Update it when you apply one.**

Note `0003` does not exist; the numbering has always skipped it.

## The real fix, not yet done

This file is the stopgap. Two things would remove the hazard properly:

1. **Baseline the ledger.** Insert rows for `0001`–`0013` into `d1_migrations` so `apply`
   correctly treats them as done, then use `apply` normally from then on. This is the clean
   long-term answer and it is cheap; it needs one careful write against prod.
2. **Make destructive migrations non-replayable.** Guard `0007` with a schema probe, or move
   one-shot rebuilds out of `migrations/` into a `scripts/one-shot/` directory that no tool
   walks automatically.

Doing (1) without (2) leaves the next table rebuild as a fresh landmine for whoever provisions
the *next* database. Doing (2) without (1) leaves `apply` unusable forever.

Until both land, treat `migrations apply` as a command that does not exist here.
