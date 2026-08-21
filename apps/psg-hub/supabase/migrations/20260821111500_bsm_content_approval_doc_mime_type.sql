-- Allow legacy Word documents already supported by the review upload validator and converter.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/msword')
where id = 'bsm-content-approvals'
  and not ('application/msword' = any (allowed_mime_types));
