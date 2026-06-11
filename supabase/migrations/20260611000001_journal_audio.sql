-- Voice recordings on journal entries
alter table journal_entries
  add column if not exists audio_path text,
  add column if not exists audio_transcript text;

-- Private bucket for journal audio (25MB = OpenAI transcription file limit)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'journal-audio',
  'journal-audio',
  false,
  26214400,
  array['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg','audio/x-m4a']
)
on conflict (id) do nothing;

create policy "users upload own journal audio" on storage.objects
  for insert with check (
    bucket_id = 'journal-audio' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users read own journal audio" on storage.objects
  for select using (
    bucket_id = 'journal-audio' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users delete own journal audio" on storage.objects
  for delete using (
    bucket_id = 'journal-audio' and
    auth.uid()::text = (storage.foldername(name))[1]
  );
