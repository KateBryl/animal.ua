-- Animal.ua базова схема профілю користувача.
-- Виконується в Supabase SQL Editor.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'owner' check (role in ('owner', 'vet')),
  phone text not null default '',
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists emergency_contact text not null default '';

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can create own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can create own profile" on public.profiles
  for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data ->> 'full_name', coalesce(new.raw_user_meta_data ->> 'role', 'owner'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table if not exists public.pets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  species text,
  breed text,
  sex text,
  birth_date date,
  color text,
  weight numeric(6,2),
  chip_number text,
  last_vaccination date,
  notes text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pets_owner_id_idx on public.pets(owner_id);
alter table public.pets enable row level security;
drop policy if exists "Users can view own pets" on public.pets;
drop policy if exists "Users can create own pets" on public.pets;
drop policy if exists "Users can update own pets" on public.pets;
drop policy if exists "Users can delete own pets" on public.pets;
create policy "Users can view own pets" on public.pets for select using (auth.uid() = owner_id);
create policy "Users can create own pets" on public.pets for insert with check (auth.uid() = owner_id);
create policy "Users can update own pets" on public.pets for update using (auth.uid() = owner_id);
create policy "Users can delete own pets" on public.pets for delete using (auth.uid() = owner_id);
alter table public.pets add column if not exists photo_path text;
alter table public.pets add column if not exists care_data jsonb not null default '{"special_needs":"","allergies":"","chronic_conditions":"","medications":"","diet":"","behavior":"","health_records":[],"vaccinations":[],"reminders":[],"documents":[]}'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('animal-photos', 'animal-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

drop policy if exists "Users can read own animal photos" on storage.objects;
drop policy if exists "Users can upload own animal photos" on storage.objects;
drop policy if exists "Users can delete own animal photos" on storage.objects;
create policy "Users can read own animal photos" on storage.objects for select
  using (bucket_id = 'animal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can upload own animal photos" on storage.objects for insert
  with check (bucket_id = 'animal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users can delete own animal photos" on storage.objects for delete
  using (bucket_id = 'animal-photos' and (storage.foldername(name))[1] = auth.uid()::text);
