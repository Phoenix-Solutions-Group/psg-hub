import { LandingPage } from '@/components/LandingPage'
import { JsonLd } from '@/components/JsonLd'
import { concepts } from '@/lib/concepts'

const concept = concepts['huntington']

export const metadata = {
  title: concept.metaTitle,
  description: concept.metaDescription,
}

export default function Page() {
  return (
    <>
      <JsonLd
        id="schema-local"
        data={{
          '@context': 'https://schema.org',
          '@type': 'AutoRepair',
          name: 'Flower Hill Auto Body Huntington Station',
          url: 'https://www.flowerhillautobody.com',
          telephone: concept.phone,
          address: {
            '@type': 'PostalAddress',
            streetAddress: '755 New York Ave',
            addressLocality: 'Huntington Station',
            addressRegion: 'NY',
            postalCode: '11746',
            addressCountry: 'US',
          },
          description: concept.metaDescription,
          aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.9', reviewCount: '627' },
          hasCredential: concept.certBadges,
          foundingDate: '1950',
          slogan: 'Factory specification, never approximation.',
        }}
      />
      <JsonLd
        id="schema-faq"
        data={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: concept.faqs.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        }}
      />
      <LandingPage concept={concept} />
    </>
  )
}
