-- Eletron Phase 2 — migration 4: charging schema seed.
-- Bootstrap the first admin so set_user_role (admin-gated) can grant every
-- other role. Idempotent. Additional operators are added in-app via set_user_role.
insert into charging.user_roles (email, role, created_by_email)
values ('gabriel.beltrami@vammo.com', 'admin', 'system')
on conflict (email) do nothing;
