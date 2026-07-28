-- PSG-2326: allow PSG admins to upload approval-ready Markdown and HTML files.
-- Keep the existing private bucket and size limit; only widen the allowed MIME list.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/markdown',
  'text/html',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'
]
where id = 'bsm-content-approvals';
