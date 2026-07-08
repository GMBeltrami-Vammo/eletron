-- Eletron Phase 2 — migration 5: harden function search_path.
-- The security advisor flagged set_updated_at / jwt_email / is_vammo_user for a
-- role-mutable search_path (is_admin / is_operator already SET it). All three
-- reference only schema-qualified objects (auth.jwt(), charging.*) or pg_catalog
-- (now(), lower()), so an empty search_path is safe and closes the warning.
alter function charging.set_updated_at() set search_path = '';
alter function charging.jwt_email() set search_path = '';
alter function charging.is_vammo_user() set search_path = '';
