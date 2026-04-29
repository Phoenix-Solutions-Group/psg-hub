# PSG Supabase Auth Email Templates

These templates are for Supabase Auth emails used by the PSG Advantage portal.
They are intentionally restrained: inline CSS, table layout, no tracking, no
remote CSS, no promotional copy, and one primary action where needed.

The templates use the email-safe PNG logo hosted by the portal:

`https://gylkkzmcmbdftxieyabw.supabase.co/storage/v1/object/public/public-assets/brand/psg-logo-primary-email.png`

## Templates

| Supabase template | File | Subject |
| --- | --- | --- |
| Confirm signup | `confirmation.html` | `Confirm your PSG Advantage email` |
| Invite user | `invite.html` | `You have been invited to PSG Advantage` |
| Magic link | `magic_link.html` | `Your PSG Advantage sign-in link` |
| Reset password | `recovery.html` | `Reset your PSG Advantage password` |
| Change email address | `email_change.html` | `Confirm your PSG Advantage email change` |
| Password changed notification | `password_changed_notification.html` | `Your PSG Advantage password was changed` |

## Supabase Variables Used

- `{{ .ConfirmationURL }}` for confirmation, invite, magic link, recovery, and email-change actions.

## Apply In Hosted Supabase

Open the Supabase project dashboard:

`Authentication > Email Templates`

Paste each file into the matching template body and set the subject from the
table above.

For password changed notifications, enable the notification first:

`Authentication > Email Templates > Security notifications > Password changed`

## Generate Management API Payload

Run:

```bash
node scripts/build-supabase-email-config.mjs
```

This writes:

`supabase/email-templates/supabase-auth-config.generated.json`

Apply it with a Supabase access token:

```bash
export SUPABASE_ACCESS_TOKEN=...
export PROJECT_REF=gylkkzmcmbdftxieyabw

curl -X PATCH "https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data @supabase/email-templates/supabase-auth-config.generated.json
```

## Production SMTP

For production, configure a custom SMTP provider rather than relying on
Supabase's default test sender.

Recommended sender pattern:

`PSG Advantage <no-reply@auth.phoenixsolutionsgroup.net>`

Keep auth email sending separate from marketing email sending.

## Redirects

The portal reset flow calls Supabase with:

`/auth/callback?next=/update-password`

The Supabase Auth redirect allow list should include:

`https://data-psg-digital.vercel.app/auth/callback`
