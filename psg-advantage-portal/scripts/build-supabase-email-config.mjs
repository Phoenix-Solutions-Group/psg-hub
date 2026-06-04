import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const templatesDir = join(root, 'supabase', 'email-templates')

const templates = {
  confirmation: {
    subjectKey: 'mailer_subjects_confirmation',
    contentKey: 'mailer_templates_confirmation_content',
    subject: 'Confirm your PSG Advantage email',
    file: 'confirmation.html',
  },
  invite: {
    subjectKey: 'mailer_subjects_invite',
    contentKey: 'mailer_templates_invite_content',
    subject: 'You have been invited to PSG Advantage',
    file: 'invite.html',
  },
  magicLink: {
    subjectKey: 'mailer_subjects_magic_link',
    contentKey: 'mailer_templates_magic_link_content',
    subject: 'Your PSG Advantage sign-in link',
    file: 'magic_link.html',
  },
  recovery: {
    subjectKey: 'mailer_subjects_recovery',
    contentKey: 'mailer_templates_recovery_content',
    subject: 'Reset your PSG Advantage password',
    file: 'recovery.html',
  },
  emailChange: {
    subjectKey: 'mailer_subjects_email_change',
    contentKey: 'mailer_templates_email_change_content',
    subject: 'Confirm your PSG Advantage email change',
    file: 'email_change.html',
  },
  passwordChangedNotification: {
    subjectKey: 'mailer_subjects_password_changed_notification',
    contentKey: 'mailer_templates_password_changed_notification_content',
    subject: 'Your PSG Advantage password was changed',
    file: 'password_changed_notification.html',
  },
}

const payload = {
  mailer_notifications_password_changed_enabled: true,
}

for (const template of Object.values(templates)) {
  payload[template.subjectKey] = template.subject
  payload[template.contentKey] = readFileSync(join(templatesDir, template.file), 'utf8')
}

const outputPath = join(templatesDir, 'supabase-auth-config.generated.json')
writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
console.log(outputPath)
