-- 0010_jctd_kind.sql - Sage's Job Cost To Date export is a kind of upload.
-- On its own because a new enum value cannot be used inside the transaction
-- that adds it; 0011 uses it.
alter type app.upload_kind add value if not exists 'jctd';
