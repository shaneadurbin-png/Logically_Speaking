-- 0008_storage.sql - the files themselves. Private buckets; every object
-- lives under ws/<workspace_id>/..., and that folder decides who may read it.
insert into storage.buckets (id, name, public) values ('uploads', 'uploads', false), ('inbox', 'inbox', false), ('forms', 'forms', false)
on conflict (id) do nothing;

create policy "members read their workspace's files" on storage.objects for select to authenticated
  using (bucket_id in ('uploads', 'inbox', 'forms') and (storage.foldername(name))[1] = 'ws'
         and app.is_member(((storage.foldername(name))[2])::uuid));
create policy "editors add files" on storage.objects for insert to authenticated
  with check (bucket_id in ('uploads', 'forms') and (storage.foldername(name))[1] = 'ws'
              and app.can_edit(((storage.foldername(name))[2])::uuid));
-- no update, no delete: a file recorded stays recorded
