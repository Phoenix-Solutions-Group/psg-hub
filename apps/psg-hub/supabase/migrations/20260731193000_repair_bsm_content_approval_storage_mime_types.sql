-- PSG-2536: repair production storage MIME allow-list for BSM content uploads.
-- HTML and Markdown are stored as plain text objects for browser-upload compatibility,
-- while review metadata keeps the original document MIME type for serving.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bsm-content-approvals',
  'bsm-content-approvals',
  false,
  26214400,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/markdown',
    'text/html',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
