-- Persist health information and document references in existing installations.
alter table public.pets add column if not exists care_data jsonb not null default '{"special_needs":"","allergies":"","chronic_conditions":"","medications":"","diet":"","behavior":"","health_records":[],"vaccinations":[],"reminders":[],"documents":[]}'::jsonb;
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    file_size_limit = 10485760
where id = 'animal-photos';
notify pgrst, 'reload schema';
