-- Per-batch drip scheduling: `send_after` gates when a row becomes eligible to send.
-- NULL = immediately. The CRM sets a start-delay + interval; enqueue stamps each row
-- send_after = now + start_delay + i*interval, so the drip paces the batch and the ETA is
-- just max(send_after). See docs/OUTREACH_MODULE.md §"Batch outreach".
--   pnpm wrangler d1 execute dbx-subscribers --remote --env preview --file ./migrations/0006_outreach_schedule.sql
ALTER TABLE outreach ADD COLUMN send_after TEXT;
CREATE INDEX IF NOT EXISTS idx_outreach_send_after ON outreach(send_after);
