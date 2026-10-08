-- Allow document uploads in an existing animal-photos bucket.
-- Run this once in Supabase SQL Editor for projects created before PDF support.
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    file_size_limit = 10485760,
    public = false
where id = 'animal-photos';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'animal-photos', 'animal-photos', false, 10485760,
       array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
where not exists (select 1 from storage.buckets where id = 'animal-photos');
