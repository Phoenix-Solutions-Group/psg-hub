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

export const schemaTypes = [shop, contentItem, auditReport, researchBrief]
