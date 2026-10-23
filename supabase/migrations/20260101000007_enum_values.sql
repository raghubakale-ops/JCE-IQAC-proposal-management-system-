-- Migration 7: new enum value (kept in its own file: a new enum value cannot be used in the same transaction)
alter type public.report_status add value if not exists 'hod_verified';
