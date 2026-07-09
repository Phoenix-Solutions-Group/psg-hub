const shop = {
  name: 'shop',
  type: 'document',
  title: 'Shop',
  fields: [
    {name: 'name', type: 'string', title: 'Shop Name', validation: (Rule) => Rule.required()},
    {name: 'slug', type: 'slug', title: 'Slug', options: {source: 'name'}},
    {name: 'city', type: 'string', title: 'City'},
    {name: 'state', type: 'string', title: 'State'},
    {name: 'websiteUrl', type: 'url', title: 'Website URL'},
    {name: 'phone', type: 'string', title: 'Phone'},
    {name: 'profileJson', type: 'text', title: 'Full Profile JSON'},
    {name: 'hasSurveyData', type: 'boolean', title: 'Has PSG Survey Data', initialValue: false},
  ],
}

const contentItem = {
  name: 'contentItem',
  type: 'document',
  title: 'Content Item',
  fields: [
    {name: 'title', type: 'string', title: 'Title', validation: (Rule) => Rule.required()},
    {name: 'slug', type: 'slug', title: 'Slug', options: {source: 'title'}},
    {name: 'shop', type: 'reference', title: 'Shop', to: [{type: 'shop'}], validation: (Rule) => Rule.required()},
    {name: 'contentType', type: 'string', title: 'Content Type', options: {list: ['blog_post', 'service_page', 'meta_descriptions', 'faq', 'landing_page', 'google_business_post']}},
    {name: 'status', type: 'string', title: 'Status', options: {list: ['draft', 'pending_review', 'approved', 'published', 'rejected']}, initialValue: 'draft'},
    {name: 'targetKeywords', type: 'array', title: 'Target Keywords', of: [{type: 'string'}]},
    {name: 'body', type: 'array', title: 'Content Body', of: [{type: 'block'}]},
    {name: 'rawMarkdown', type: 'text', title: 'Raw Markdown'},
    {name: 'metaTitle', type: 'string', title: 'Meta Title', validation: (Rule) => Rule.max(60)},
    {name: 'metaDescription', type: 'string', title: 'Meta Description', validation: (Rule) => Rule.max(160)},
    {name: 'schemaMarkup', type: 'text', title: 'Schema Markup (JSON-LD)'},
    {name: 'wordCount', type: 'number', title: 'Word Count'},
    {name: 'createdByAgent', type: 'string', title: 'Created By Agent'},
    {name: 'reviewedBy', type: 'string', title: 'Reviewed By'},
    {name: 'reviewNotes', type: 'text', title: 'Review Notes'},
    {name: 'publishedAt', type: 'datetime', title: 'Published At'},
  ],
}

const auditReport = {
  name: 'auditReport',
  type: 'document',
  title: 'SEO Audit Report',
  fields: [
    {name: 'title', type: 'string', title: 'Title', validation: (Rule) => Rule.required()},
    {name: 'shop', type: 'reference', title: 'Shop', to: [{type: 'shop'}], validation: (Rule) => Rule.required()},
    {name: 'auditType', type: 'string', title: 'Audit Type', options: {list: ['full', 'technical', 'content_gaps', 'competitor_comparison']}},
    {name: 'reportMarkdown', type: 'text', title: 'Report (Markdown)'},
    {name: 'findingsCount', type: 'number', title: 'Findings Count'},
    {name: 'highPriorityCount', type: 'number', title: 'High Priority Count'},
    {name: 'createdByAgent', type: 'string', title: 'Created By Agent', initialValue: 'bsm-seo-auditor'},
  ],
}

const researchBrief = {
  name: 'researchBrief',
  type: 'document',
  title: 'Market Research Brief',
  fields: [
    {name: 'title', type: 'string', title: 'Title', validation: (Rule) => Rule.required()},
    {name: 'shop', type: 'reference', title: 'Shop', to: [{type: 'shop'}], validation: (Rule) => Rule.required()},
    {name: 'researchType', type: 'string', title: 'Research Type', options: {list: ['full', 'content_opportunities', 'competitor_analysis', 'sentiment_trends', 'keyword_gaps']}},
    {name: 'briefMarkdown', type: 'text', title: 'Brief (Markdown)'},
    {name: 'opportunityCount', type: 'number', title: 'Content Opportunities Count'},
    {name: 'createdByAgent', type: 'string', title: 'Created By Agent', initialValue: 'bsm-market-researcher'},
  ],
}

// Production mail-merge template (v1.3 / PSG-42). One document per product, per
// shop (omit `shop` for the brand-aligned global default). The psg-hub render
// pipeline (apps/psg-hub/src/lib/production/templates.ts) maps these fields onto
// its `MailTemplate` shape, substitutes `{{ merge.field }}` tokens against the
// customer / company / company_programs.customizations_jsonb data, and emits the
// HTML that feeds MailDocument.front/back/file. Visual/brand design is Nick-owned
// (board Decision D63) — these fields hold the markup he designs against.
const productionMailTemplate = {
  name: 'productionMailTemplate',
  type: 'document',
  title: 'Production Mail Template',
  fields: [
    {name: 'name', type: 'string', title: 'Template Name', validation: (Rule) => Rule.required()},
    {name: 'slug', type: 'slug', title: 'Slug', options: {source: 'name'}},
    {
      name: 'product',
      type: 'string',
      title: 'Product',
      description: 'Which PSG production piece this template renders.',
      options: {list: ['thank_you', 'warranty', 'envelope', 'service_recovery', 'self_mailer']},
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'pieceType',
      type: 'string',
      title: 'Piece Type',
      description: 'Postcard (front + back HTML) or letter/self-mailer (body HTML). Drives which fields render.',
      options: {list: ['postcard', 'letter', 'self_mailer']},
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'shop',
      type: 'reference',
      title: 'Shop',
      description: 'Per-shop override. Leave empty for the global brand-aligned default.',
      to: [{type: 'shop'}],
    },
    {
      name: 'frontHtml',
      type: 'text',
      title: 'Postcard Front (HTML)',
      description: 'Self-contained HTML with {{ merge.field }} tokens. Postcards only.',
      rows: 12,
    },
    {
      name: 'backHtml',
      type: 'text',
      title: 'Postcard Back (HTML)',
      description: 'Self-contained HTML with {{ merge.field }} tokens. Postcards only.',
      rows: 12,
    },
    {
      name: 'bodyHtml',
      type: 'text',
      title: 'Letter Body (HTML)',
      description: 'Self-contained HTML with {{ merge.field }} tokens. Letters and self-mailers.',
      rows: 16,
    },
    {
      name: 'size',
      type: 'string',
      title: 'Mail Size',
      description: 'Lob postcard sizes, plus 8.5x11 for letters/self-mailers.',
      options: {list: ['4x6', '6x9', '6x11', '8.5x11']},
      initialValue: '4x6',
    },
    {name: 'color', type: 'boolean', title: 'Color Print (letters/self-mailers)', initialValue: true},
    {name: 'active', type: 'boolean', title: 'Active', initialValue: true},
    {
      name: 'mergeFieldNotes',
      type: 'text',
      title: 'Available Merge Fields',
      description:
        'Reference for authors. Supported tokens: ' +
        '{{customer.firstName}} {{customer.lastName}} {{customer.fullName}} {{customer.vehicle}} {{customer.serviceDate}} ' +
        '{{company.name}} {{company.phone}} {{company.email}} {{company.websiteUrl}} {{company.city}} {{company.state}} ' +
        '{{program.greeting}} {{program.header}} {{program.footer}} {{program.logo}}.',
      readOnly: true,
    },
  ],
  preview: {
    select: {title: 'name', subtitle: 'product', shop: 'shop.name'},
    prepare({title, subtitle, shop}) {
      return {title, subtitle: shop ? `${subtitle} · ${shop}` : `${subtitle} · default`}
    },
  },
}

export const schemaTypes = [shop, contentItem, auditReport, researchBrief, productionMailTemplate]
