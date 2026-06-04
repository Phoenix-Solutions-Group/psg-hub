import { BrandCertPage } from '@/components/BrandCertPage'
import { JsonLd } from '@/components/JsonLd'

export const metadata = {
  title: 'Aston Martin Factory Authorized Body Shop | Flower Hill Auto Body',
  description:
    'Flower Hill Auto Body is a member of the Aston Martin Factory Authorized Collision Repair Program. Certified technicians, genuine parts, factory warranty protection on Long Island.',
}

export default function AstonMartinPage() {
  return (
    <>
      <JsonLd
        id="schema-local"
        data={{
          '@context': 'https://schema.org',
          '@type': 'AutoRepair',
          name: 'Flower Hill Auto Body — Aston Martin Certified',
          url: 'https://www.flowerhillautobody.com',
          telephone: '516.627.3913',
          description: metadata.description,
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: '4.9',
            reviewCount: '627',
          },
          hasCredential: ['Aston Martin Factory Authorized Collision Repair Program'],
          foundingDate: '1950',
          slogan: 'Factory specification, never approximation.',
        }}
      />
      <BrandCertPage />
    </>
  )
}
