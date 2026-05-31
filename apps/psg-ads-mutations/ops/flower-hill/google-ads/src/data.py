"""
Flower Hill Auto Body — Campaign data.
Fill in CUSTOMER_IDS before running.
"""

CUSTOMER_IDS = {
    "huntington": "5509988313",
    "glen_cove":  "5509988313",
    "roslyn":     "5509988313",
}

LOCATIONS = {
    "huntington": {
        "code": "HTN",
        "phone": "16312700033",
        "address": "15 W Stepar Pl, Huntington Station, NY 11746",
        "website": "https://www.flowerhillautobody.com/huntington",
        "lat": 40.8448,
        "lng": -73.3954,
        "radius_miles": 12,
        # Monthly Google Search budget: $1,000 (priority months 1-3)
        "budgets": {
            "general":  14_000_000,  # $14/day (~$420/mo)
            "ev":        4_330_000,  # $4.33/day (~$130/mo)
            "exotic":    5_000_000,  # $5/day (~$150/mo)
            "brand":     3_330_000,  # $3.33/day (~$100/mo)
        },
    },
    "glen_cove": {
        "code": "GC",
        "phone": "15167591737",
        "address": "36 Morris Ave, Glen Cove, NY 11542",
        "website": "https://www.flowerhillautobody.com/glen-cove",
        "lat": 40.8651,
        "lng": -73.6279,
        "radius_miles": 12,
        # Monthly Google Search budget: $700
        "budgets": {
            "general":  9_670_000,  # $9.67/day (~$290/mo)
            "ev":       3_000_000,  # $3/day (~$90/mo)
            "exotic":   4_000_000,  # $4/day (~$120/mo)
            "brand":    2_330_000,  # $2.33/day (~$70/mo)
        },
    },
    "roslyn": {
        "code": "ROS",
        "phone": "15166273913",
        "address": "12 Middle Neck Road, Roslyn, NY 11576",
        "website": "https://www.flowerhillautobody.com/roslyn",
        "lat": 40.7993,
        "lng": -73.6477,
        "radius_miles": 12,
        "budgets": {
            "general":  9_670_000,
            "ev":       3_000_000,
            "exotic":   4_000_000,
            "brand":    2_330_000,
        },
    },
}

NEGATIVE_KEYWORDS = [
    "diy", "how to fix", "training", "school", "jobs", "salary", "careers",
    "hiring", "cheap", "junkyard", "salvage", "parts only", "used parts",
    "wrecking yard", "how much does it cost",
]

# Ad groups and keywords per campaign tier
AD_GROUPS = {
    "general": [
        {
            "name": "Near Me — General",
            "keywords": [
                ("body shop near me", "PHRASE"),
                ("body shops near me", "PHRASE"),
                ("collision repair near me", "PHRASE"),
                ("auto body shop near me", "PHRASE"),
                ("car body shop near me", "PHRASE"),
                ("auto body near me", "PHRASE"),
                ("collision center near me", "EXACT"),
                ("body repair shops near me", "PHRASE"),
            ],
        },
        {
            "name": "Insurance Claims",
            "keywords": [
                ("insurance collision repair", "PHRASE"),
                ("accident repair shop near me", "PHRASE"),
                ("certified collision center", "EXACT"),
                ("certified collision repair", "EXACT"),
            ],
        },
        {
            "name": "Dent & Paint",
            "keywords": [
                ("dent repair near me", "PHRASE"),
                ("auto paint shop near me", "PHRASE"),
                ("auto body repair near me", "PHRASE"),
            ],
        },
    ],
    "general_huntington": [
        {
            "name": "Huntington-Specific",
            "keywords": [
                ("huntington auto body", "EXACT"),
                ("huntington collision center", "EXACT"),
                ("huntington auto body and paint", "EXACT"),
                ("auto body shop huntington ny", "EXACT"),
            ],
        },
    ],
    "ev": [
        {
            "name": "Rivian",
            "keywords": [
                ("rivian certified collision center", "EXACT"),
                ("rivian body shop", "EXACT"),
                ("rivian collision repair", "PHRASE"),
                ("rivian fleet certified collision", "EXACT"),
            ],
        },
        {
            "name": "Lucid & EV General",
            "keywords": [
                ("lucid collision repair", "EXACT"),
                ("electric vehicle collision repair", "EXACT"),
                ("ev body shop", "PHRASE"),
                ("ev collision repair long island", "EXACT"),
            ],
        },
        {
            "name": "Tesla & Other EV",
            "keywords": [
                ("tesla body shop long island", "EXACT"),
                ("tesla collision repair near me", "EXACT"),
                ("polestar collision repair", "PHRASE"),
            ],
        },
    ],
    "exotic": [
        {
            "name": "Aston Martin",
            "keywords": [
                ("aston martin body shop", "EXACT"),
                ("aston martin repair near me", "EXACT"),
                ("aston martin long island", "PHRASE"),
                ("aston martin certified repair", "EXACT"),
            ],
        },
        {
            "name": "Exotic Certifications",
            "keywords": [
                ("ferrari repair near me", "EXACT"),
                ("lamborghini certified repair", "EXACT"),
                ("mclaren collision repair", "EXACT"),
                ("exotic car body shop long island", "EXACT"),
            ],
        },
        {
            "name": "Luxury German",
            "keywords": [
                ("audi body shop near me", "EXACT"),
                ("audi certified collision repair", "EXACT"),
                ("porsche body shop", "EXACT"),
                ("porsche collision repair long island", "EXACT"),
                ("bmw collision repair long island", "EXACT"),
            ],
        },
        {
            "name": "OEM Certified Broad",
            "keywords": [
                ("oem certified collision repair", "EXACT"),
                ("manufacturer certified body shop", "PHRASE"),
                ("factory authorized collision repair long island", "EXACT"),
            ],
        },
    ],
    "brand": [
        {
            "name": "Brand",
            "keywords": [
                ("flower hill auto body", "EXACT"),
                ("flower hill auto body long island", "EXACT"),
                ("flower hill collision", "PHRASE"),
            ],
        },
    ],
}

# RSA ad copy — all headlines ≤30 chars, all descriptions ≤90 chars (API-validated)
AD_COPY = {
    "general": {
        "headlines": [
            "Free Collision Repair Estimate",   # 30
            "All Insurance Accepted",           # 22
            "North Shore Trusted Body Shop",    # 29
            "3 North Shore Locations",          # 23
            "Certified Collision Center",       # 25
            "OEM Parts. Factory Standards.",    # 29
            "75 Years. Family Standard.",       # 26
            "Family-Owned. OEM Certified.",     # 28
            "We Handle the Insurance Claim",    # 29
            "627 Five-Star Reviews",            # 21
            "4 Generations. One Standard.",     # 28
            "Auto Body. Huntington Station.",   # 30
            "I-CAR Gold Class Technicians",     # 28
            "25+ OEM Certifications",           # 22
            "Book Your Damage Assessment",      # 27
        ],
        "descriptions": [
            "Certified technicians restore your vehicle to pre-accident condition. Free estimates.",  # 89
            "75 years on the North Shore. Huntington, Glen Cove & Roslyn. All insurance accepted.",  # 83
            "We handle the insurance claim. Expert collision repair that looks like it never happened.",  # 89
            "OEM-certified. Manufacturer-approved parts. Safety, value, and appearance restored.",  # 81
        ],
        "final_url": "https://www.flowerhillautobody.com",
        "display_path": ["Auto-Body", "Free-Estimate"],
    },
    "ev": {
        "headlines": [
            "Only EV Shop on Long Island",      # 27
            "Rivian Certified Repair",          # 22
            "Lucid Certified. Long Island.",    # 29
            "Stop Driving to NYC for EVs",      # 27
            "Your Warranty Stays Intact",       # 26
            "25+ OEM Certs. EV Certified.",     # 28
            "ADAS Calibration Included",        # 25
            "Battery-Safe EV Repairs",          # 23
            "Lucid 2026 Shop of the Year",      # 27
            "Certified Rivian Repairs on LI",   # 30
            "EV Repair. Stay on Long Island",   # 30
            "OEM Parts. Factory Methods.",      # 26
            "I-CAR Gold Class. EV Certified",   # 30
            "Lucid. Rivian. Both Certified.",   # 29
            "Skip NYC. Book EV Estimate.",      # 27
        ],
        "descriptions": [
            "Long Island's only Rivian and Lucid certified shop. OEM parts. Warranty safe.",  # 76
            "Lucid 2026 Shop of the Year. ADAS calibration. Stop driving to NYC. We're here.",  # 82
            "Stop driving to NYC or NJ. Rivian and Lucid certified repairs on Long Island.",  # 76
            "I-CAR Gold Class. 25+ OEM certifications. Your EV repaired right — battery to body.",  # 85
        ],
        "final_url": "https://www.flowerhillautobody.com",
        "display_path": ["EV-Certified", "Rivian-Lucid"],
    },
    "exotic": {
        "headlines": [
            "Aston Martin Certified on LI",    # 28
            "McLaren Certified. Long Island",   # 29
            "Long Island's Only Exotic Shop",   # 30
            "OEM Certified Exotic Repair",      # 27
            "Aston. McLaren. Lamborghini.",     # 28
            "No NYC Trip for Exotic Repairs",   # 30
            "Manufacturer-Approved Repairs",    # 28
            "Ferrari Owners Trust This Shop",   # 30
            "Concierge Repair. Certified.",     # 28
            "Protect Your Exotic's Value",      # 27
            "Certified. Not Just Equipped.",    # 29
            "OEM Parts. Factory Standards.",    # 29
            "Request a Concierge Estimate",     # 28
            "I-CAR Gold Class Technicians",     # 28
            "25+ Certs. One Island. Yours.",    # 29
        ],
        "descriptions": [
            "Long Island's only certified Aston Martin, McLaren & Lamborghini shop. OEM parts.",  # 83
            "Trained, tooled, and approved by the manufacturer. Not just equipped.",  # 68
            "75 years of precision on Long Island's rarest vehicles. Zero shortcuts.",  # 70
            "Carbon fiber, composite repair. OEM parts. Concierge process. No city detour.",  # 77
        ],
        "final_url": "https://www.flowerhillautobody.com",
        "display_path": ["Aston-Martin", "Exotic-Repair"],
    },
    "brand": {
        "headlines": [
            "Flower Hill Auto Body",            # 21
            "Official Site — Book Estimate",    # 29
            "75 Years. North Shore Trusted.",   # 29
            "3 Locations. OEM Certified.",      # 27
            "LI's Only Aston Martin Shop",      # 27
            "Lucid 2026 Shop of the Year",      # 27
            "Free Damage Assessment",           # 22
            "Call or Book Online Today",        # 25
            "I-CAR Gold Class Facility",        # 25
            "Family-Owned Since 1949",          # 23
        ],
        "descriptions": [
            "75 years. 4 generations. 25+ OEM certifications. Three North Shore locations.",  # 76
            "Aston Martin and Lucid certified. The only shop on Long Island. Free assessment.",  # 80
        ],
        "final_url": "https://www.flowerhillautobody.com",
        "display_path": ["Official-Site", "Book-Estimate"],
    },
}

SITELINKS = [
    {
        "text": "Our Services",
        "description_1": "Collision, dent & paint repair",
        "description_2": "All makes and models welcome",
        "final_url": "https://www.flowerhillautobody.com/services",
    },
    {
        "text": "About Us",
        "description_1": "75 years. Picciano family.",
        "description_2": "North Shore institution since 1949",
        "final_url": "https://www.flowerhillautobody.com/about",
    },
    {
        "text": "Exotic Certifications",
        "description_1": "Aston Martin, McLaren, Lamborghini",
        "description_2": "Long Island's only certified center",
        "final_url": "https://www.flowerhillautobody.com/certifications",
    },
    {
        "text": "EV Collision Repair",
        "description_1": "Rivian Fleet & Lucid Certified",
        "description_2": "Only certified EV shop on LI",
        "final_url": "https://www.flowerhillautobody.com/ev-repair",
    },
    {
        "text": "Get a Free Estimate",
        "description_1": "Online or in-person estimates",
        "description_2": "All insurance accepted",
        "final_url": "https://www.flowerhillautobody.com/estimate",
    },
]

CALLOUTS = [
    "Free Estimates",
    "All Insurance Accepted",
    "OEM Certified",
    "75 Years Experience",
    "I-CAR Gold Class",
    "Enterprise Rental On-Site",
    "ADAS Calibration",
    "3 North Shore Locations",
]
