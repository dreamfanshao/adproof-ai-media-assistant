-- AdProof AI / 媒介助手 MVP
-- Migration 006: private Storage buckets and object policies

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'audit-assets', 'audit-assets', false, 10485760,
    array['image/jpeg', 'image/png']
  ),
  (
    'knowledge-documents', 'knowledge-documents', false, 20971520,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/markdown'
    ]
  ),
  (
    'ephemeral-qr', 'ephemeral-qr', false, 1048576,
    array['image/png', 'image/jpeg']
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy audit_assets_insert_own_folder
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'audit-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_upload_to_storage(bucket_id, name)
  );
create policy audit_assets_select_own_folder
  on storage.objects for select to authenticated
  using (
    bucket_id = 'audit-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy knowledge_documents_insert_own_folder
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'knowledge-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_upload_to_storage(bucket_id, name)
  );
create policy knowledge_documents_select_own_folder
  on storage.objects for select to authenticated
  using (
    bucket_id = 'knowledge-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ephemeral-qr has no authenticated object policy. Only service-role code can
-- create the QR image and issue a short-lived signed URL. Browser code never
-- receives reusable platform session material.
