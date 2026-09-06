-- The API and Eval admin use the Supabase service_role key.
-- Explicit grants are required for this project because service_role does not
-- inherit table privileges from the authenticated role.
grant select, insert, update on public.feedback_tickets to service_role;
