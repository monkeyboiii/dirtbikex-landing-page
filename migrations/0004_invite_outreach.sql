-- Outreach context on invite codes: the code IS the outreach record, so the
-- contacts CRM needs no ledger of its own (its cache table is disposable).
-- All nullable/additive; the worker ignores these columns.
--
-- Apply to BOTH databases before minting with the new admin.mjs flags or the
-- CRM (mint writes these columns unconditionally; an unmigrated DB errors):
--   pnpm wrangler d1 execute dbx-subscribers --env preview --remote --file ./migrations/0004_invite_outreach.sql
--   pnpm wrangler d1 execute dbx-subscribers --env "" --remote --file ./migrations/0004_invite_outreach.sql   # prod (its own CF account)
-- Note: the --file path goes through the D1 import endpoint, which briefly makes
-- the database unavailable to serve queries — apply in a quiet window, or run the
-- five ALTERs individually via --command (the /query endpoint, no outage).
-- See dirtbikex-contacts docs/CONTACT_MODULE.md "Invites".
ALTER TABLE invite_codes ADD COLUMN track_name TEXT;
ALTER TABLE invite_codes ADD COLUMN track_region TEXT;
ALTER TABLE invite_codes ADD COLUMN channel TEXT;
ALTER TABLE invite_codes ADD COLUMN contact_status TEXT;
ALTER TABLE invite_codes ADD COLUMN notes TEXT;
