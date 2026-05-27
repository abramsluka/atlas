create table progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  weight numeric,
  weight_unit text default 'lbs',
  storage_path text not null,
  created_at timestamptz default now()
);

create index on progress_photos (user_id, date desc);

alter table progress_photos enable row level security;

create policy "users manage own photos" on progress_photos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage bucket policies (run after creating bucket manually)
-- Bucket name: progress-photos (private)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'progress-photos',
  'progress-photos',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do nothing;

create policy "users upload own photos" on storage.objects
  for insert with check (
    bucket_id = 'progress-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users read own photos" on storage.objects
  for select using (
    bucket_id = 'progress-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users delete own photos" on storage.objects
  for delete using (
    bucket_id = 'progress-photos' and
    auth.uid()::text = (storage.foldername(name))[1]
  );
