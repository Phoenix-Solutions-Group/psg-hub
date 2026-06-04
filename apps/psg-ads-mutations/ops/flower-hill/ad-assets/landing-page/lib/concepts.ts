export type ProofItem = { label: string; detail: string }
export type StatItem = { value: string; label: string }
export type TestimonialItem = { quote: string; author: string; vehicle: string }
export type FaqItem = { q: string; a: string }

export type ConceptData = {
  slug: string
  badge: string
  headline: string
  subhead: string
  heroImage: string
  heroVideo?: string
  proofItems: ProofItem[]
  stats: [StatItem, StatItem, StatItem]
  certBadges: string[]
  testimonials: [TestimonialItem, TestimonialItem]
  faqs: FaqItem[]
  phone: string
  email: string
  location: string
  ctaLabel: string
  metaTitle: string
  metaDescription: string
}

const sharedStats: [StatItem, StatItem, StatItem] = [
  { value: '25+', label: 'OEM Certifications' },
  { value: '75', label: 'Years in Business' },
  { value: '627', label: '5-Star Google Reviews' },
]

export const concepts: Record<string, ConceptData> = {
  'ev-certified': {
    slug: 'ev-certified',
    badge: 'EV CERTIFIED',
    headline: "Long Island's Only Certified Repair Center for Rivian, Lucid, and Tesla.",
    subhead:
      "Every other OEM-certified EV shop is in New York City or New Jersey. We're here, on Long Island — certified by the manufacturers who built your vehicle. Stop driving 90 minutes for a warranty-safe repair.",
    heroImage: '/images/hero-ev.png',
    heroVideo: '/videos/hero-ev-loop.mp4',
    stats: sharedStats,
    certBadges: [
      'Rivian Fleet Certified',
      'Lucid 2026 Shop of the Year',
      'Tesla Certified',
      'Polestar Certified',
      'I-CAR Gold Class',
      'ADAS Calibration Certified',
    ],
    proofItems: [
      {
        label: 'Rivian Fleet Certified',
        detail:
          "Flower Hill holds Rivian's Fleet Certified designation — one of fewer than 30 shops nationwide authorized to perform OEM warranty repairs on the R1S and R1T. Your battery, structure, and warranty stay intact.",
      },
      {
        label: 'Lucid 2026 Shop of the Year',
        detail:
          'Awarded by Lucid Motors in 2026 — the only such designation on Long Island. This certification confirms we meet every technical, tooling, and process standard Lucid requires for warranty-safe collision repair.',
      },
      {
        label: 'ADAS Calibration Certified',
        detail:
          'Advanced Driver Assistance Systems must be recalibrated to factory spec after every structural repair. Federal safety standards require it. We restore cameras, radar, and sensors precisely — not approximately.',
      },
    ],
    testimonials: [
      {
        quote:
          'I drove to a shop in New Jersey three times before finding Flower Hill. They are the only shop on Long Island certified to touch a Rivian. My warranty is intact and the car looks factory-new.',
        author: 'M. Farber',
        vehicle: '2024 Rivian R1S — Syosset, NY',
      },
      {
        quote:
          'They handled everything: the insurance claim, the ADAS recalibration, the battery diagnostic. I did not manage any of it. This is what certified EV service should look like.',
        author: 'D. Kessler',
        vehicle: '2024 Tesla Model Y — Jericho, NY',
      },
    ],
    faqs: [
      {
        q: 'Does a non-certified shop void my Rivian or Lucid warranty?',
        a: "Yes. Rivian and Lucid both require repairs be performed by an authorized certified collision center to maintain manufacturer warranty coverage. A non-certified shop using incorrect procedures can void your battery warranty, structural warranty, and ADAS recalibration certification. Flower Hill holds current Fleet Certified status from Rivian and was named Lucid 2026 Shop of the Year — both confirm we meet manufacturer standards.",
      },
      {
        q: 'What is ADAS calibration and why does my EV need it after a collision?',
        a: 'ADAS stands for Advanced Driver Assistance Systems — the sensors, cameras, and radar that power lane assist, emergency braking, and autopilot features. Any structural repair, even minor, can shift sensor alignment. Federal safety standards require recalibration to factory specification after a collision repair. We hold dedicated ADAS calibration certification and perform this step on every EV we repair.',
      },
      {
        q: 'How far do Long Island EV owners typically drive for certified repairs?',
        a: 'Before Flower Hill expanded to three Long Island locations, most Rivian and Lucid owners drove 40–90 minutes into New York City or New Jersey for manufacturer-certified repairs. With locations in Roslyn, Glen Cove, and Huntington Station, we eliminate that drive entirely.',
      },
      {
        q: 'What EV brands is Flower Hill Auto Body certified to repair?',
        a: 'Flower Hill holds OEM certifications for Rivian (Fleet Certified), Lucid (2026 Shop of the Year), Tesla, and Polestar. We also hold certifications for BMW iX/I4/I7, Mercedes-Benz EQS/EQE, Audi e-tron, and Porsche Taycan as part of our 25+ OEM certification network.',
      },
    ],
    phone: '516.627.3913',
    email: 'roslyninfo@flowerhillautobody.com',
    location: 'Roslyn',
    ctaLabel: 'Book Certified EV Estimate',
    metaTitle: 'EV Certified Collision Repair Long Island | Rivian · Lucid · Tesla | Flower Hill',
    metaDescription:
      "Long Island's only Rivian Fleet Certified and Lucid 2026 Shop of the Year. OEM parts, battery-safe repairs, ADAS calibration. Stop driving to NYC — we're here.",
  },

  exotic: {
    slug: 'exotic',
    badge: 'ASTON MARTIN CERTIFIED',
    headline: "Long Island's Only Certified Exotic Repair Center.",
    subhead:
      'We are the only shop on Long Island certified by Aston Martin. Certified by McLaren, Ferrari, and Lamborghini. If your vehicle is rare, we are the only shop on the island authorized to repair it without voiding the manufacturer warranty.',
    heroImage: '/images/hero-exotic.png',
    heroVideo: '/videos/hero-exotic-loop.mp4',
    stats: sharedStats,
    certBadges: [
      'Aston Martin Certified',
      'McLaren Certified',
      'Ferrari Certified',
      'Lamborghini Certified',
      'Porsche Certified',
      'Bentley Certified',
      'Carbon Fiber Certified',
    ],
    proofItems: [
      {
        label: "Aston Martin — Long Island's Only",
        detail:
          'Flower Hill holds the only Aston Martin Certified Repair designation on Long Island. This certification requires manufacturer-approved training, tooling, and process compliance — not simply a willingness to work on exotic vehicles.',
      },
      {
        label: 'McLaren · Ferrari · Lamborghini',
        detail:
          'OEM certification from these manufacturers means we have met their individual tooling, technician training, and process standards. Most shops decline these jobs. We are built for them — with carbon fiber and composite structural repair capability to factory specification.',
      },
      {
        label: 'Carbon Fiber & Composite Repair',
        detail:
          'Exotic and ultra-luxury vehicles rely on structural materials standard collision equipment cannot properly repair. We hold specific certification in carbon fiber and composite structural repair — required for any Aston Martin, McLaren, or Ferrari structural repair.',
      },
    ],
    testimonials: [
      {
        quote:
          'My Aston Martin DBX had $40,000 in structural damage. Three other shops said they could not touch it. Flower Hill was the only certified option on Long Island. The repair is perfect — documented, warranted, zero compromise.',
        author: 'R. Goldstein',
        vehicle: '2023 Aston Martin DBX — Old Westbury, NY',
      },
      {
        quote:
          'Getting my McLaren repaired meant finding a shop certified by McLaren directly. Flower Hill had the certification and the technical knowledge to handle the carbon fiber correctly. The car is exactly as it left the factory.',
        author: 'T. Bancroft',
        vehicle: '2022 McLaren GT — Manhasset, NY',
      },
    ],
    faqs: [
      {
        q: 'What does OEM certification mean for exotic car repairs?',
        a: 'OEM certification from a manufacturer like Aston Martin or McLaren means a shop has been evaluated, trained, and approved by the manufacturer itself. This is not a self-declared qualification. It requires factory tooling, manufacturer-specified repair procedures, and ongoing training compliance. Only OEM-certified shops can guarantee that repairs meet original factory specification — protecting your warranty, structural integrity, and resale value.',
      },
      {
        q: 'Can any body shop legally work on an Aston Martin?',
        a: "Any shop can attempt to work on an Aston Martin, but only a manufacturer-certified shop can guarantee the repair meets Aston Martin specifications. Non-certified repairs risk voiding your manufacturer warranty, compromising structural integrity, and reducing resale value. Flower Hill Auto Body is Long Island's only Aston Martin Certified Repair Center.",
      },
      {
        q: 'How does Flower Hill handle the logistics for exotic vehicles?',
        a: 'We coordinate vehicle pickup and delivery for exotic and ultra-luxury vehicles and provide enterprise rental car service on-site during the repair period. Our concierge estimation process begins with a detailed in-person damage assessment — no photos, no online estimates. Every vehicle in our care is stored securely inside our 15,000 sq ft enclosed facility.',
      },
      {
        q: 'What is the repair process for carbon fiber structural damage on an exotic car?',
        a: 'Carbon fiber and composite structural repair requires manufacturer-specific equipment, materials, and procedures that differ significantly from steel or aluminum repair. We hold dedicated certification in carbon fiber repair and use only manufacturer-approved materials and bonding procedures. Every structural repair includes a dimensional verification to factory tolerance — confirming geometry before the vehicle leaves our facility.',
      },
    ],
    phone: '516.627.3913',
    email: 'roslyninfo@flowerhillautobody.com',
    location: 'Roslyn',
    ctaLabel: 'Request Concierge Estimate',
    metaTitle: 'Exotic Car Certified Collision Repair Long Island | Aston Martin · McLaren | Flower Hill',
    metaDescription:
      "Long Island's only Aston Martin, McLaren, Ferrari, and Lamborghini certified collision center. OEM-certified, carbon fiber repair, concierge process. No city drive.",
  },

  huntington: {
    slug: 'huntington',
    badge: '75 YEARS · FOUR GENERATIONS',
    headline: 'The Same Family. The Same Standards. Now in Huntington Station.',
    subhead:
      "Flower Hill Auto Body has operated on Long Island's North Shore since 1950. Four Picciano family generations. One standard: factory specification, never approximation. The same shop that earned 627 five-star reviews in Roslyn — now five minutes from Huntington.",
    heroImage: '/images/hero-ev.png',
    heroVideo: '/videos/hero-huntington-loop.mp4',
    stats: sharedStats,
    certBadges: [
      'I-CAR Gold Class',
      '25+ OEM Certified',
      'Rivian Fleet Certified',
      'Lucid Certified',
      'Porsche Certified',
      'BMW Certified',
      'Audi Certified',
      'Mercedes-Benz Certified',
    ],
    proofItems: [
      {
        label: 'Picciano Family — Est. 1950',
        detail:
          "Four generations of the Picciano family have operated Flower Hill Auto Body on Long Island's North Shore since 1950. Seventy-five years of continuous craftsmanship — the institutional knowledge no chain operation can replicate.",
      },
      {
        label: '627 Five-Star Reviews in Roslyn',
        detail:
          'Our Roslyn location holds 627 verified reviews at 4.9 stars. When you bring your vehicle to Huntington Station, the same Picciano family standards, the same certified technicians, and the same 25+ OEM certifications are behind every repair.',
      },
      {
        label: 'I-CAR Gold Class · 25+ OEM Certs',
        detail:
          'I-CAR Gold Class is held by fewer than 15% of collision centers in the United States. Combined with 25+ OEM certifications — including Aston Martin, McLaren, Rivian, Lucid, Porsche, BMW, Audi, and Mercedes-Benz — Flower Hill Huntington carries more manufacturer authority than any other shop in the area.',
      },
    ],
    testimonials: [
      {
        quote:
          "I have used Flower Hill in Roslyn for fifteen years. When they opened in Huntington Station, I drove my daughter's car straight there. Same process, same quality. The new location is exactly what this area needed.",
        author: 'P. Marchetti',
        vehicle: '2023 BMW 5 Series — Jericho, NY',
      },
      {
        quote:
          'DePalo is a fine shop but they are not OEM certified for my Porsche. When Flower Hill opened in Huntington, that solved it. They handled the entire Porsche claim including ADAS recalibration. My dealership confirmed the repair.',
        author: 'S. Weiss',
        vehicle: '2024 Porsche Cayenne — Huntington, NY',
      },
    ],
    faqs: [
      {
        q: 'Is the Huntington Station location as experienced as the Roslyn shop?',
        a: "Yes. The Huntington Station location operates under the same Picciano family ownership, the same 25+ OEM certifications, the same I-CAR Gold Class technical standard, and the same staff training as Flower Hill's Roslyn location — which has operated since 1950 and holds 627 five-star reviews. Huntington is a new address, not a new company.",
      },
      {
        q: 'Does Flower Hill Huntington work with all insurance companies?',
        a: 'Yes. Flower Hill Auto Body works with all major insurance companies at every location. Our Huntington Station team handles the claim process directly with your insurer — you do not need to manage the paperwork or negotiate with adjusters. We can also arrange enterprise rental car service on-site during the repair period.',
      },
      {
        q: 'How does Flower Hill compare to other Huntington collision shops?',
        a: "Flower Hill Huntington offers capabilities no other Huntington collision center can match: 25+ OEM certifications including Aston Martin, McLaren, Rivian, Lucid, Porsche, and BMW; I-CAR Gold Class status; 75 years of family-owned operation on Long Island's North Shore; and a 4.9-star reputation built across 627 verified reviews. For certified-brand vehicles, Flower Hill is the only certified option in Huntington.",
      },
      {
        q: 'What is the address and hours for the Huntington Station location?',
        a: 'Flower Hill Auto Body Huntington Station is located at 755 New York Ave, Huntington Station, NY 11746. Phone: 631.270.0033. Hours: Monday through Friday, 8am to 5pm. Saturday appointments available upon request.',
      },
    ],
    phone: '631.270.0033',
    email: 'huntingtoninfo@flowerhillautobody.com',
    location: 'Huntington Station',
    ctaLabel: 'Schedule My Assessment',
    metaTitle: 'Collision Repair Huntington Station NY | 75 Years · OEM Certified | Flower Hill Auto Body',
    metaDescription:
      'Flower Hill Auto Body now in Huntington Station. Same Picciano family, same 25+ OEM certifications, same I-CAR Gold Class standard since 1950. 627 five-star reviews.',
  },

  'german-oem': {
    slug: 'german-oem',
    badge: 'OEM CERTIFIED',
    headline:
      "OEM-Certified. Manufacturer-Approved. We're More Than Just Equipped.",
    subhead:
      'Hundreds of shops on Long Island will work on your German vehicle. Only one has been trained, tooled, and certified by Audi, Porsche, BMW, and Mercedes-Benz directly. The difference determines whether your warranty, ADAS calibration, and resale value survive the repair.',
    heroImage: '/images/hero-german-oem.png',
    heroVideo: '/videos/hero-german-oem-loop.mp4',
    stats: sharedStats,
    certBadges: [
      'Audi Certified',
      'Porsche Certified',
      'BMW Certified',
      'Mercedes-Benz Certified',
      'VW Certified',
      'I-CAR Gold Class',
      'ADAS Calibration Certified',
    ],
    proofItems: [
      {
        label: 'Porsche · BMW · Audi · Mercedes',
        detail:
          'Each certification is awarded by the manufacturer after independent verification of our repair procedures, technician training, tooling, and facilities. A shop cannot self-certify — it must be evaluated and approved by the OEM directly.',
      },
      {
        label: 'I-CAR Gold Class',
        detail:
          "I-CAR Gold Class is held by fewer than 15% of collision centers in the United States. It is the industry's highest ongoing technical training standard — required by most OEM certification programs. We have maintained Gold Class status for over a decade.",
      },
      {
        label: 'Non-OEM Repair Voids Coverage',
        detail:
          "BMW, Audi, Porsche, and Mercedes-Benz all require repairs be performed by a certified center to maintain warranty coverage. A single non-OEM repair — even a minor one — can void your vehicle's structural warranty and ADAS recalibration certification.",
      },
    ],
    testimonials: [
      {
        quote:
          'My Audi dealer told me to bring my RS7 specifically here after my accident. Flower Hill is Audi OEM certified. The repair was documented, warranted, and my ADAS was recalibrated to factory spec. My dealership confirmed it.',
        author: 'C. Eisenberg',
        vehicle: '2023 Audi RS7 — Syosset, NY',
      },
      {
        quote:
          'After my accident, my Porsche dealership gave me one referral for an OEM-certified shop on Long Island: Flower Hill. The repair was technically perfect. They understand what Porsche certification actually requires.',
        author: 'A. Nakamura',
        vehicle: '2023 Porsche 911 Carrera S — Manhasset, NY',
      },
    ],
    faqs: [
      {
        q: 'What happens to my BMW or Audi warranty if a non-certified shop repairs it?',
        a: 'BMW and Audi both require collision repairs be performed by an OEM-certified facility using approved parts and procedures to maintain warranty coverage. A non-certified repair — even one using genuine parts — can void your structural warranty, your ADAS recalibration certification, and in some cases your entire manufacturer warranty. Flower Hill Auto Body is OEM certified by both BMW and Audi, and we document every repair for warranty compliance.',
      },
      {
        q: 'Do you use OEM parts for German vehicle repairs?',
        a: 'Yes. As an OEM-certified shop, we use manufacturer-specified parts for every certified repair. For Porsche, BMW, Audi, and Mercedes-Benz vehicles, this means genuine OEM components — not aftermarket or refurbished parts — for any structural or certified repair. This is a condition of our certification agreements with each manufacturer.',
      },
      {
        q: 'How can I verify that Flower Hill is OEM certified for my German vehicle?',
        a: "Each manufacturer maintains a public online directory of certified collision centers. BMW's is at bmwusa.com, Audi's at audiusa.com, Porsche's at porsche.com, Mercedes-Benz's at mbusa.com. Search your ZIP code and verify Flower Hill's certification directly with the manufacturer before trusting any shop with your vehicle.",
      },
      {
        q: 'What is the difference between OEM certified and dealer authorized?',
        a: "OEM certification means the manufacturer has directly evaluated, approved, and listed a shop as meeting their technical repair standards. Dealer authorization is typically a referral relationship without the same technical oversight. Flower Hill's OEM certifications from Audi, Porsche, BMW, and Mercedes-Benz are independently verified by each manufacturer and listed in their respective certified repair center directories.",
      },
    ],
    phone: '516.627.3913',
    email: 'roslyninfo@flowerhillautobody.com',
    location: 'Roslyn',
    ctaLabel: 'Request OEM-Certified Estimate',
    metaTitle: 'German OEM Certified Collision Repair Long Island | Audi · Porsche · BMW · Mercedes | Flower Hill',
    metaDescription:
      'OEM-certified by Audi, Porsche, BMW, and Mercedes-Benz on Long Island. Manufacturer-trained, genuine OEM parts, ADAS calibration. Warranty protected. I-CAR Gold Class.',
  },
}
