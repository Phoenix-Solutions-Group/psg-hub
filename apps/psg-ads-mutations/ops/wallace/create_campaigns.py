"""
Wallace Collision Center — Campaign Creation Script
Account: 604-861-1995 (customer_id: 6048611995)

Creates 5 Search campaigns in PAUSED status for client review before activation.

Campaigns:
  1. GOOG_WAL_SRCH_Brand_2026Q2           $7/day   Target IS 90% top-of-page
  2. GOOG_WAL_SRCH_LocalCollision_2026Q2  $40/day  Maximize Conversions
  3. GOOG_WAL_SRCH_ToyotaCertified_2026Q2 $13/day  Maximize Clicks ($8 max CPC)
  4. GOOG_WAL_SRCH_TeslaApproved_2026Q2   $5/day   Manual CPC ($20 max)
  5. GOOG_WAL_SRCH_JLRCertified_2026Q2    $3/day   Manual CPC ($25 max)

After running:
  - All campaigns appear in Google Ads UI under "Paused"
  - Review keywords, ads, targeting in UI
  - Enable each campaign when ready to go live

Usage:
  python create_campaigns.py --dry-run    # Preview all operations, no changes
  python create_campaigns.py              # Create campaigns (PAUSED)
  python create_campaigns.py --campaign toyota  # Create only Toyota campaign
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from googleads_psg.client import load_client

CUSTOMER_ID = "6048611995"

BASE_URL = "https://wallacecollisionrepair.com"

# Kingsport, TN — center point for radius targeting
KINGSPORT_LAT_MICROS = 36_548_400
KINGSPORT_LNG_MICROS = -82_561_800

MICROS = 1_000_000  # 1 USD = 1,000,000 micros


# ---------------------------------------------------------------------------
# Campaign definitions
# ---------------------------------------------------------------------------

CAMPAIGNS = {
    "brand": {
        "name": "GOOG_WAL_SRCH_Brand_2026Q2",
        "daily_budget_usd": 7,
        "bidding": "target_impression_share",
        "target_impression_share_location": "ABSOLUTE_TOP_OF_PAGE",
        "target_impression_share_fraction": 0.90,
        "geo_radius_miles": 40,
        "geo_radius_only_presence": True,
        "ad_groups": [
            {
                "name": "Brand Terms",
                "default_max_cpc_usd": 5.00,
                "keywords": [
                    ("[exact] wallace collision", "EXACT"),
                    ("[exact] wallace collision center", "EXACT"),
                    ('[phrase] "wallace body shop"', "PHRASE"),
                    ('[phrase] "wallace collision kingsport"', "PHRASE"),
                    ('[phrase] "wallace auto body"', "PHRASE"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/",
                    "headlines": [
                        "Wallace Collision Center",
                        "Kingsport's Trusted Body Shop",
                        "OEM Certified — Wallace Collision",
                        "Lifetime Warranty on Every Repair",
                        "All Major Insurance Accepted",
                        "Toyota · Tesla · JLR Certified",
                        "Free Estimates — Call Today",
                        "I-CAR Gold Class Technicians",
                        "Wallace Collision — Official Site",
                        "Serving Kingsport Since [YEAR]",
                        "Award-Winning Collision Repair",
                        "Schedule Your Free Estimate",
                        "Expert Paint & Body Repair",
                        "Rental Assistance Available",
                        "Collision Repair You Can Trust",
                    ],
                    "descriptions": [
                        "Wallace Collision Center — Kingsport's OEM-certified body shop. Toyota, Tesla, and JLR certified. All insurers accepted. Free estimates.",
                        "Expert collision repair with a lifetime warranty. I-CAR Gold Class technicians. Call or visit Wallace Collision Center today.",
                        "Serving the Tri-Cities for over [X] years. OEM parts, factory-trained techs, lifetime warranty, and all major insurers accepted.",
                        "Collision damage? We handle everything — insurance paperwork, rental assistance, and repairs done right. Free estimate available.",
                    ],
                },
            }
        ],
        "negative_keywords": [],
    },

    "local": {
        "name": "GOOG_WAL_SRCH_LocalCollision_2026Q2",
        "daily_budget_usd": 40,
        "bidding": "maximize_conversions",
        "geo_radius_miles": 40,
        "geo_radius_only_presence": True,
        "ad_groups": [
            {
                "name": "Collision Repair",
                "default_max_cpc_usd": None,
                "keywords": [
                    ('[phrase] "collision repair near me"', "PHRASE"),
                    ('[phrase] "collision repair kingsport"', "PHRASE"),
                    ('[exact] collision repair kingsport tn', "EXACT"),
                    ('[exact] auto collision repair near me', "EXACT"),
                    ('[phrase] "collision repair johnson city"', "PHRASE"),
                    ('[phrase] "collision repair bristol tn"', "PHRASE"),
                    ('[exact] car collision repair near me', "EXACT"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/collision-repair/",
                    "headlines": [
                        "Collision Repair in Kingsport, TN",
                        "OEM-Certified Collision Repair",
                        "All Major Insurance Carriers Accepted",
                        "Free Estimates — No Appointment Needed",
                        "Lifetime Warranty on Every Repair",
                        "I-CAR Gold Class Body Shop",
                        "Same-Day Estimates Available",
                        "Serving Kingsport & Tri-Cities",
                        "Insurance Claims Handled For You",
                        "Expert Paint & Collision Repair",
                        "Auto Body Estimates in 24 Hours",
                        "Get Back on the Road Faster",
                        "Rental Assistance Available",
                        "Toyota · Tesla · JLR Certified",
                        "Call for a Free Damage Assessment",
                    ],
                    "descriptions": [
                        "Expert collision repair with a lifetime warranty. All major insurers accepted. Free estimates — call or visit Wallace Collision Center today.",
                        "Kingsport's trusted auto body shop. I-CAR Gold Class technicians. Get your free estimate — no waiting, no runaround.",
                        "Collision damage? We handle everything from insurance paperwork to the final detail. Rental assistance available. Call us now.",
                        "OEM-certified repairs, lifetime warranty, all insurers accepted. Your car back to pre-accident condition — guaranteed. Wallace Collision.",
                    ],
                },
            },
            {
                "name": "Body Shop",
                "default_max_cpc_usd": None,
                "keywords": [
                    ('[phrase] "body shop near me"', "PHRASE"),
                    ('[phrase] "auto body shop near me"', "PHRASE"),
                    ('[phrase] "auto body shop kingsport"', "PHRASE"),
                    ('[exact] body shop kingsport tn', "EXACT"),
                    ('[exact] body shop estimates', "EXACT"),
                    ('[phrase] "body shop johnson city tn"', "PHRASE"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/collision-repair/",
                    "headlines": [
                        "Auto Body Shop in Kingsport, TN",
                        "Trusted Body Shop — Tri-Cities",
                        "Free Estimates — No Appointment",
                        "All Major Insurance Carriers",
                        "Lifetime Warranty on Repairs",
                        "OEM-Certified Body Shop",
                        "I-CAR Gold Class Technicians",
                        "Same-Day Damage Assessments",
                        "Serving Kingsport & Tri-Cities",
                        "Collision Repair You Can Trust",
                        "Expert Paint & Body Repair",
                        "Rental Assistance Available",
                        "Insurance Paperwork Handled",
                        "Call Wallace Collision Today",
                        "Get a Free Body Shop Estimate",
                    ],
                    "descriptions": [
                        "Expert collision repair with a lifetime warranty. All major insurers accepted. Free estimates — call or visit Wallace Collision Center today.",
                        "Kingsport's trusted auto body shop for over [X] years. I-CAR Gold Class technicians. Free estimate — no waiting, no runaround.",
                        "OEM-certified repairs, lifetime warranty, all insurers accepted. Your car back to pre-accident condition — guaranteed.",
                        "Collision damage? We handle everything from insurance paperwork to the final detail. Rental assistance available. Call us now.",
                    ],
                },
            },
            {
                "name": "Paint and Dent",
                "default_max_cpc_usd": None,
                "keywords": [
                    ('[phrase] "auto paint shop near me"', "PHRASE"),
                    ('[phrase] "paintless dent repair near me"', "PHRASE"),
                    ('[phrase] "dent repair kingsport"', "PHRASE"),
                    ('[exact] car dent repair near me', "EXACT"),
                    ('[exact] bumper repair near me', "EXACT"),
                    ('[phrase] "car paint repair near me"', "PHRASE"),
                    ('[phrase] "fender repair near me"', "PHRASE"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/collision-repair/",
                    "headlines": [
                        "Paintless Dent Repair Near You",
                        "Auto Paint Shop — Kingsport, TN",
                        "Dent & Scratch Repair Experts",
                        "OEM Paint — Factory Match",
                        "Bumper Repair Specialists",
                        "Free Estimate — Paint & Dent",
                        "All Insurance Carriers Accepted",
                        "Lifetime Warranty on Paint Work",
                        "Same-Day Dent Assessments",
                        "I-CAR Gold Class Paint Shop",
                        "Fender & Panel Repair Near You",
                        "Serving Kingsport & Tri-Cities",
                        "Professional Auto Paint Repair",
                        "Dent Repair Without Repainting",
                        "Call Wallace for a Free Estimate",
                    ],
                    "descriptions": [
                        "Expert paintless dent repair and auto paint services. OEM color match, lifetime warranty. Free estimate — call Wallace Collision.",
                        "From minor dents to full collision paint work. I-CAR Gold Class technicians, all insurers accepted. Serving Kingsport and Tri-Cities.",
                        "Paintless dent repair, bumper fix, full paint refinish — all under one roof. Free estimate. All insurers. Lifetime warranty.",
                        "Get your car looking new again. Factory-matched paint, OEM-certified technicians, and a lifetime warranty on every repair.",
                    ],
                },
            },
            {
                "name": "Estimate and Insurance",
                "default_max_cpc_usd": None,
                "keywords": [
                    ('[phrase] "free auto body estimate"', "PHRASE"),
                    ('[phrase] "collision estimate near me"', "PHRASE"),
                    ('[exact] insurance body shop near me', "EXACT"),
                    ('[exact] auto body estimate near me', "EXACT"),
                    ('[phrase] "car accident repair near me"', "PHRASE"),
                    ('[phrase] "auto body insurance claim"', "PHRASE"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/collision-repair/",
                    "headlines": [
                        "Free Collision Estimate Near You",
                        "All Major Insurance Accepted",
                        "No-Wait Auto Body Estimates",
                        "Insurance Claims Made Easy",
                        "Free Estimate — Same Day",
                        "Car Accident Repair Specialists",
                        "OEM-Certified Collision Shop",
                        "We Handle Your Insurance Claim",
                        "Rental Assistance Available",
                        "Lifetime Warranty — All Repairs",
                        "In-Network With All Insurers",
                        "Estimate in 24 Hours or Less",
                        "Trusted Body Shop — Kingsport",
                        "I-CAR Gold Class Technicians",
                        "Call Wallace for a Free Quote",
                    ],
                    "descriptions": [
                        "Free collision estimate with no appointment needed. We work with all major insurance carriers. Call Wallace Collision Center today.",
                        "Car accident? We handle the insurance claim from start to finish. Free estimate, rental assistance, lifetime warranty on repairs.",
                        "All major insurers accepted. Free estimates. No runaround — we work directly with your insurance company. Call now.",
                        "Serving the Tri-Cities. OEM-certified repairs, lifetime warranty, and full insurance coordination. Get your free estimate today.",
                    ],
                },
            },
            {
                "name": "Competitor Conquest",
                "default_max_cpc_usd": 4.00,
                "keywords": [
                    ('[exact] caliber collision kingsport', "EXACT"),
                    ('[exact] joe hudsons collision kingsport', "EXACT"),
                    ('[phrase] "crash champions near me"', "PHRASE"),
                    ('[exact] gerber collision kingsport', "EXACT"),
                    ('[phrase] "body shop kingsport"', "PHRASE"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/collision-repair/",
                    "headlines": [
                        "Local Alternative — OEM Certified",
                        "Independent. Certified. Guaranteed.",
                        "Toyota · Tesla · JLR Certified Shop",
                        "Lifetime Warranty — All Repairs",
                        "All Major Insurance Accepted",
                        "I-CAR Gold Class Technicians",
                        "Free Estimate — Compare Us First",
                        "Trusted Kingsport Body Shop",
                        "OEM Parts. Factory Standards.",
                        "Family-Owned Collision Center",
                        "No Franchise. Just Quality Work.",
                        "Compare Before You Decide",
                        "Kingsport's Certified Body Shop",
                        "Serving Tri-Cities Since [YEAR]",
                        "Get a Second Opinion — Free",
                    ],
                    "descriptions": [
                        "Looking for an alternative? Wallace Collision is OEM-certified, I-CAR Gold Class, and independently owned. Free estimate — compare us.",
                        "Triple OEM certified: Toyota, Tesla, and JLR. Lifetime warranty. All insurers. Local, independent — no franchise overhead.",
                        "Before you decide, get a free second estimate from Wallace Collision Center. OEM-certified repairs with a lifetime guarantee.",
                        "Independent, locally owned, and triple OEM certified. No franchise markup. Just quality collision repair with a lifetime warranty.",
                    ],
                },
            },
        ],
        "negative_keywords": [
            "jobs", "career", "hiring", "training", "school", "course",
            "diy", "how to", "tutorial", "youtube", "reddit",
            "mechanic", "engine", "transmission", "oil change", "tire", "alignment",
            "brake", "smog", "inspection", "exhaust",
            "parts", "for sale", "buy", "cheap", "wholesale", "ebay",
            "review", "vs", "compare", "specs", "price", "msrp", "lease",
        ],
    },

    "toyota": {
        "name": "GOOG_WAL_SRCH_ToyotaCertified_2026Q2",
        "daily_budget_usd": 13,
        "bidding": "maximize_clicks",
        "max_cpc_usd": 8.00,
        "geo_radius_miles": 75,
        "geo_radius_only_presence": True,
        "ad_groups": [
            {
                "name": "Toyota Certified Collision",
                "default_max_cpc_usd": 8.00,
                "keywords": [
                    ('[phrase] "toyota body shop near me"', "PHRASE"),
                    ('[phrase] "toyota certified collision center"', "PHRASE"),
                    ('[phrase] "toyota certified body shop"', "PHRASE"),
                    ('[phrase] "toyota certified collision repair"', "PHRASE"),
                    ('[exact] toyota certified repair near me', "EXACT"),
                    ('[phrase] "toyota approved body shop"', "PHRASE"),
                    ('[exact] toyota collision care center', "EXACT"),
                    ('[phrase] "toyota certified repair shop"', "PHRASE"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/toyota-certified/",
                    "headlines": [
                        "Toyota Certified Collision Repair",
                        "Wallace Collision — Toyota Certified",
                        "Tri-Cities Toyota Certified Body Shop",
                        "Toyota Certified — Kingsport & Bristol",
                        "OEM Toyota Parts. Certified Techs.",
                        "Toyota Collision Care Certified Shop",
                        "Free Estimate — Toyota Certified Repair",
                        "All Insurers Accepted — Toyota Certified",
                        "Lifetime Warranty on Toyota Repairs",
                        "Not the Dealer. Better Than the Dealer.",
                        "Independent. Certified. Toyota Approved.",
                        "Factory-Trained Toyota Repair Specialists",
                        "Toyota Certified Without the Dealer Price",
                        "Same Day Toyota Damage Assessment",
                        "Your Toyota. Our Certification.",
                    ],
                    "descriptions": [
                        "Wallace Collision is Toyota Collision Care Certified — OEM parts, factory-trained techs, lifetime warranty. All major insurers accepted. Free estimate.",
                        "Don't assume the dealership is your only option. Wallace Collision is also Toyota Certified — no dealer markup, all insurers accepted.",
                        "Toyota Collision Care Certified. OEM genuine parts. Factory specs. Lifetime warranty. Serving Bristol, Kingsport, Johnson City. Free estimate.",
                        "Certified Toyota collision repair from an independent shop — no dealer pressure, all insurers, lifetime warranty on every repair. Call Wallace.",
                    ],
                },
            },
            {
                "name": "Toyota Model Specific",
                "default_max_cpc_usd": 6.00,
                "keywords": [
                    ('[phrase] "toyota tacoma body shop near me"', "PHRASE"),
                    ('[phrase] "toyota rav4 collision repair near me"', "PHRASE"),
                    ('[phrase] "toyota tundra body shop near me"', "PHRASE"),
                    ('[phrase] "toyota 4runner body shop"', "PHRASE"),
                    ('[phrase] "toyota highlander collision repair"', "PHRASE"),
                    ('[phrase] "toyota camry body shop near me"', "PHRASE"),
                    ('[phrase] "toyota tacoma collision repair"', "PHRASE"),
                    ('[phrase] "toyota rav4 body shop"', "PHRASE"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/toyota-certified/",
                    "headlines": [
                        "Toyota Tacoma Collision Specialists",
                        "Certified Toyota RAV4 Body Shop",
                        "Toyota Camry Collision Repair",
                        "Toyota Tundra Body Shop — Certified",
                        "Toyota Highlander Collision Shop",
                        "OEM Parts for Your Toyota Repair",
                        "Toyota 4Runner Repair Specialists",
                        "Toyota Certified Repair — Free Estimate",
                        "Factory Specs for Your Toyota Model",
                        "Independent Toyota Certified Shop",
                        "Lifetime Warranty on Toyota Repairs",
                        "All Insurers Accepted — OEM Parts",
                        "Toyota Collision Care Certified",
                        "Serving Kingsport & Tri-Cities",
                        "Your Toyota. Fixed Right.",
                    ],
                    "descriptions": [
                        "Toyota Collision Care Certified body shop serving the Tri-Cities. OEM genuine parts, factory-trained technicians, lifetime warranty.",
                        "Whether you drive a Tacoma, RAV4, or Tundra — Wallace Collision is Toyota Certified to restore it to factory specs. Free estimate.",
                        "OEM parts, certified techs, lifetime warranty. Your Toyota repaired right — without the dealer price. All insurers accepted.",
                        "Certified Toyota repair for every model. Tacoma, RAV4, Tundra, 4Runner, Highlander, Camry — we're equipped and certified. Free estimate.",
                    ],
                },
            },
            {
                "name": "Toyota Dealer Conquest",
                "default_max_cpc_usd": 5.00,
                "keywords": [
                    ('[exact] toyota of kingsport collision', "EXACT"),
                    ('[phrase] "toyota of kingsport body shop"', "PHRASE"),
                    ('[exact] toyota of bristol collision', "EXACT"),
                    ('[phrase] "toyota dealer body shop"', "PHRASE"),
                    ('[phrase] "toyota dealership collision repair"', "PHRASE"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/toyota-certified/",
                    "headlines": [
                        "Toyota Certified — Not Just Dealers",
                        "Also Toyota Certified — Wallace",
                        "Independent Toyota Certified Shop",
                        "All Insurers vs. Dealer Collision",
                        "Toyota Collision Care — No Dealer",
                        "Toyota Certified. No Dealer Price.",
                        "Certified Repair Without Dealer Markup",
                        "OEM Parts. Independent Shop. Free Est.",
                        "Wallace: Toyota Certified & Independent",
                        "Compare Before Going to the Dealer",
                        "No Dealer Pressure — Just Certification",
                        "All Major Insurers — Free Estimate",
                        "Lifetime Warranty on Toyota Repairs",
                        "Toyota Certified Body Shop Nearby",
                        "Serving Kingsport & Bristol, TN",
                    ],
                    "descriptions": [
                        "Toyota of Kingsport isn't your only option. Wallace Collision is also Toyota Certified — no dealer markup, all insurers accepted.",
                        "Certified Toyota collision repair without the dealership experience. Independent, OEM-certified, lifetime warranty. Free estimate.",
                        "Both Toyota Certified. But only one is independent — no dealer pressure, no upsells, all insurers accepted. That's Wallace Collision.",
                        "Toyota Collision Care Certified. Free estimate. All major insurers. Lifetime warranty. No dealership required.",
                    ],
                },
            },
        ],
        "negative_keywords": [
            "toyota for sale", "toyota dealership", "toyota price", "toyota lease",
            "toyota finance", "toyota service", "toyota oil change", "toyota maintenance",
            "toyota recall", "toyota warranty", "toyota parts", "used toyota",
            "toyota review", "toyota specs", "toyota mpg", "toyota accessories",
            "toyota tires", "toyota battery", "how to", "diy", "toyota manual",
            "toyota app", "toyota roadside", "toyota navigation", "toyota dealer",
            "toyota news", "toyota stock", "toyota camry price", "toyota rav4 review",
            "toyota tacoma parts", "toyota knoxville", "toyota nashville",
            "jobs", "career", "hiring", "mechanic", "engine", "transmission",
        ],
    },

    "tesla": {
        "name": "GOOG_WAL_SRCH_TeslaApproved_2026Q2",
        "daily_budget_usd": 5,
        "bidding": "manual_cpc",
        "geo_radius_miles": 75,
        "geo_radius_only_presence": True,
        "ad_groups": [
            {
                "name": "Tesla Approved Collision",
                "default_max_cpc_usd": 20.00,
                "keywords": [
                    ('[exact] tesla approved body shop', "EXACT"),
                    ('[exact] tesla certified collision repair', "EXACT"),
                    ('[phrase] "tesla approved body shop near me"', "PHRASE"),
                    ('[phrase] "tesla collision repair near me"', "PHRASE"),
                    ('[phrase] "tesla body shop"', "PHRASE"),
                    ('[phrase] "tesla approved collision center"', "PHRASE"),
                    ('[exact] tesla approved repair shop', "EXACT"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/tesla-approved/",
                    "headlines": [
                        "Tesla Approved Collision Repair",
                        "Certified Tesla Body Shop Near You",
                        "Tesla-Approved Repairs — Kingsport",
                        "OEM Parts. Certified Technicians.",
                        "Only Certified Tesla Shop in Region",
                        "Tesla Structural Repair Specialists",
                        "High Voltage Safe — Tesla Certified",
                        "Free Tesla Damage Assessment",
                        "Your Tesla Deserves Certified Repair",
                        "Wallace Collision — Tesla Approved",
                        "Tesla OEM Parts & Factory Specs",
                        "All Insurers — Tesla Approved Shop",
                        "Lifetime Warranty on Tesla Repairs",
                        "Tesla Approved — Serving Tri-Cities",
                        "Rare Certification. Real Expertise.",
                    ],
                    "descriptions": [
                        "Wallace Collision is Tesla Approved — one of the few certified shops in the region. OEM parts, certified technicians, and a lifetime warranty.",
                        "Don't risk your Tesla at a non-certified shop. Wallace Collision is Tesla Approved and equipped for structural and high-voltage repairs.",
                        "Tesla Approved collision repair — OEM parts, factory specs, high-voltage safety certified. All insurers accepted. Free estimate.",
                        "One of the only Tesla Approved shops within 200 miles. Certified techs, OEM parts, lifetime warranty. Serving Kingsport and Tri-Cities.",
                    ],
                },
            }
        ],
        "negative_keywords": [
            "tesla dealership", "tesla service center", "tesla customer service",
            "tesla battery", "tesla charger", "tesla supercharger", "tesla roadside",
            "tesla warranty", "tesla model s", "tesla model 3", "tesla model x",
            "tesla model y", "tesla cybertruck", "tesla semi", "tesla stock",
            "tesla news", "tesla recall", "used tesla", "tesla for sale",
            "tesla owner", "tesla app", "tesla autopilot", "tesla fsd",
            "tesla software", "new tesla", "tesla price", "tesla tax credit",
            "tesla delivery", "tesla knoxville", "tesla nashville", "tesla charlotte",
            "jobs", "career", "diy", "how to", "mechanic", "engine",
            "parts", "review", "specs", "mpg", "lease", "finance",
        ],
    },

    "jlr": {
        "name": "GOOG_WAL_SRCH_JLRCertified_2026Q2",
        "daily_budget_usd": 3,
        "bidding": "manual_cpc",
        "geo_radius_miles": 75,
        "geo_radius_only_presence": True,
        "ad_groups": [
            {
                "name": "JLR Certified Collision",
                "default_max_cpc_usd": 25.00,
                "keywords": [
                    ('[exact] jaguar certified collision', "EXACT"),
                    ('[exact] land rover certified body shop', "EXACT"),
                    ('[phrase] "jaguar certified collision repair"', "PHRASE"),
                    ('[phrase] "land rover collision center near me"', "PHRASE"),
                    ('[phrase] "range rover approved repairer"', "PHRASE"),
                    ('[phrase] "range rover body shop near me"', "PHRASE"),
                    ('[phrase] "jaguar land rover certified body shop"', "PHRASE"),
                    ('[exact] jlr certified collision center', "EXACT"),
                ],
                "rsa": {
                    "final_url": f"{BASE_URL}/jaguar-land-rover-certified/",
                    "headlines": [
                        "Jaguar Land Rover Certified Shop",
                        "JLR Certified Collision Repair",
                        "Range Rover Certified Repair Near You",
                        "OEM Parts & JLR-Trained Technicians",
                        "Certified Land Rover Collision Center",
                        "Jaguar Approved Collision Repair",
                        "Free Estimate for Your Land Rover",
                        "JLR Certified — Serving Tri-Cities",
                        "Wallace Collision — JLR Certified",
                        "Range Rover & Jaguar Specialists",
                        "Lifetime Warranty — JLR Repairs",
                        "All Insurers — JLR Certified Shop",
                        "Rare JLR Certification in Region",
                        "Factory-Spec JLR Collision Repair",
                        "Jaguar / Land Rover Repair Expert",
                    ],
                    "descriptions": [
                        "Wallace Collision is Jaguar Land Rover Certified — OEM parts, factory-trained technicians, and lifetime warranty. One of the few certified shops nearby.",
                        "Your Range Rover or Jaguar deserves certified repair. Wallace Collision Center: JLR-certified technicians, OEM parts, all insurers accepted.",
                        "JLR Certified collision repair for Jaguar, Land Rover, and Range Rover owners. OEM specs, lifetime warranty, all insurers. Free estimate.",
                        "One of the only JLR Certified body shops in the Tri-Cities region. Factory-trained techs, OEM parts, comprehensive insurance coverage.",
                    ],
                },
            }
        ],
        "negative_keywords": [
            "jaguar dealership", "jaguar for sale", "jaguar price", "jaguar lease",
            "jaguar parts", "jaguar service", "jaguar maintenance",
            "land rover dealership", "land rover for sale", "range rover for sale",
            "range rover price", "used land rover", "used range rover",
            "land rover parts", "land rover service",
            "jaguar f-pace", "jaguar e-pace", "jaguar xe", "jaguar xf", "jaguar i-pace",
            "range rover sport", "range rover velar", "discovery sport",
            "defender", "land rover dealer",
            "jobs", "career", "diy", "how to", "mechanic", "engine",
            "review", "specs", "price", "lease", "finance",
        ],
    },
}


# ---------------------------------------------------------------------------
# Helper: micros conversion
# ---------------------------------------------------------------------------

def to_micros(usd: float) -> int:
    return int(usd * MICROS)


# ---------------------------------------------------------------------------
# Match type mapping
# ---------------------------------------------------------------------------

MATCH_TYPE_MAP = {
    "EXACT": "EXACT",
    "PHRASE": "PHRASE",
    "BROAD": "BROAD",
}


def _clean_keyword_text(kw_str: str) -> str:
    """Strip [exact] or "phrase" syntax markers — return raw keyword text."""
    text = kw_str.strip()
    if text.startswith("[") and "]" in text:
        text = text[text.index("]") + 1:].strip()
    elif text.startswith('"') and text.endswith('"'):
        text = text[1:-1]
    # Remove square brackets around the keyword itself
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    return text


# ---------------------------------------------------------------------------
# Create budget
# ---------------------------------------------------------------------------

def create_budget(client, customer_id: str, name: str, daily_usd: float, dry_run: bool) -> Optional[str]:
    if dry_run:
        print(f"  [BUDGET] '{name}' — ${daily_usd:.2f}/day")
        return f"customers/{customer_id}/campaignBudgets/-1"

    budget_service = client.get_service("CampaignBudgetService")
    op = client.get_type("CampaignBudgetOperation")
    budget = op.create
    budget.name = name
    budget.amount_micros = to_micros(daily_usd)
    budget.delivery_method = client.enums.BudgetDeliveryMethodEnum.STANDARD
    budget.explicitly_shared = False

    resp = budget_service.mutate_campaign_budgets(customer_id=customer_id, operations=[op])
    resource_name = resp.results[0].resource_name
    print(f"  [OK] Budget: {resource_name}")
    return resource_name


# ---------------------------------------------------------------------------
# Create campaign
# ---------------------------------------------------------------------------

def create_campaign(client, customer_id: str, cfg: dict, budget_resource: str, dry_run: bool) -> Optional[str]:
    name = cfg["name"]
    bidding = cfg["bidding"]

    if dry_run:
        print(f"  [CAMPAIGN] '{name}' — bidding={bidding} — PAUSED")
        return f"customers/{customer_id}/campaigns/-1"

    campaign_service = client.get_service("CampaignService")
    op = client.get_type("CampaignOperation")
    campaign = op.create

    campaign.name = name
    campaign.status = client.enums.CampaignStatusEnum.PAUSED
    campaign.advertising_channel_type = client.enums.AdvertisingChannelTypeEnum.SEARCH
    campaign.campaign_budget = budget_resource
    campaign.contains_eu_political_advertising = (
        client.enums.EuPoliticalAdvertisingStatusEnum.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING
    )

    # Network settings — Search only (no Search Partners for precision)
    campaign.network_settings.target_google_search = True
    campaign.network_settings.target_search_network = False
    campaign.network_settings.target_content_network = False

    # LOP only — user must be physically present in geo (not just interested in area)
    campaign.geo_target_type_setting.positive_geo_target_type = (
        client.enums.PositiveGeoTargetTypeEnum.PRESENCE
    )

    # Bidding strategy
    if bidding == "maximize_conversions":
        campaign.maximize_conversions.target_cpa_micros = 0  # uncapped until learning done
    elif bidding == "maximize_clicks":
        max_cpc = cfg.get("max_cpc_usd", 8.0)
        campaign.target_spend.cpc_bid_ceiling_micros = to_micros(max_cpc)
    elif bidding == "manual_cpc":
        campaign.manual_cpc.enhanced_cpc_enabled = False
    elif bidding == "target_impression_share":
        location = cfg.get("target_impression_share_location", "ABSOLUTE_TOP_OF_PAGE")
        fraction = cfg.get("target_impression_share_fraction", 0.90)
        tis = campaign.target_impression_share
        tis.location = client.enums.TargetImpressionShareLocationEnum[location]
        tis.location_fraction_micros = int(fraction * MICROS)
        tis.cpc_bid_ceiling_micros = to_micros(10.0)  # $10 max CPC safety cap

    resp = campaign_service.mutate_campaigns(customer_id=customer_id, operations=[op])
    resource_name = resp.results[0].resource_name
    print(f"  [OK] Campaign: {resource_name}")
    return resource_name


# ---------------------------------------------------------------------------
# Add geo targeting — radius around Kingsport TN
# ---------------------------------------------------------------------------

def add_geo_targeting(client, customer_id: str, campaign_resource: str,
                      radius_miles: int, lop_only: bool, dry_run: bool) -> None:
    if dry_run:
        lop_str = "LOP only" if lop_only else "LOP + AOI"
        print(f"  [GEO] {radius_miles}-mile radius Kingsport TN — {lop_str}")
        return

    criterion_service = client.get_service("CampaignCriterionService")
    op = client.get_type("CampaignCriterionOperation")
    criterion = op.create

    criterion.campaign = campaign_resource
    criterion.proximity.geo_point.longitude_in_micro_degrees = KINGSPORT_LNG_MICROS
    criterion.proximity.geo_point.latitude_in_micro_degrees = KINGSPORT_LAT_MICROS
    criterion.proximity.radius = radius_miles
    criterion.proximity.radius_units = client.enums.ProximityRadiusUnitsEnum.MILES

    resp = criterion_service.mutate_campaign_criteria(customer_id=customer_id, operations=[op])
    print(f"  [OK] Geo: {resp.results[0].resource_name}")


# ---------------------------------------------------------------------------
# Create ad group
# ---------------------------------------------------------------------------

def create_ad_group(client, customer_id: str, campaign_resource: str,
                    ag_cfg: dict, dry_run: bool) -> Optional[str]:
    name = ag_cfg["name"]
    max_cpc = ag_cfg.get("default_max_cpc_usd")

    if dry_run:
        cpc_str = f"${max_cpc:.2f}" if max_cpc else "campaign default"
        print(f"    [AD GROUP] '{name}' — max CPC {cpc_str}")
        return f"customers/{customer_id}/adGroups/-1"

    ag_service = client.get_service("AdGroupService")
    op = client.get_type("AdGroupOperation")
    ag = op.create

    ag.name = name
    ag.campaign = campaign_resource
    ag.status = client.enums.AdGroupStatusEnum.ENABLED

    if max_cpc is not None:
        ag.cpc_bid_micros = to_micros(max_cpc)

    resp = ag_service.mutate_ad_groups(customer_id=customer_id, operations=[op])
    resource_name = resp.results[0].resource_name
    print(f"    [OK] Ad Group: {resource_name}")
    return resource_name


# ---------------------------------------------------------------------------
# Add keywords
# ---------------------------------------------------------------------------

def add_keywords(client, customer_id: str, ad_group_resource: str,
                 keywords: list, dry_run: bool) -> None:
    ops = []

    for kw_raw, match_type_str in keywords:
        kw_text = _clean_keyword_text(kw_raw)
        match_enum = MATCH_TYPE_MAP.get(match_type_str, "PHRASE")

        if dry_run:
            print(f"      [KW] [{match_type_str}] {kw_text}")
            continue

        criterion_service = client.get_service("AdGroupCriterionService")
        op = client.get_type("AdGroupCriterionOperation")
        criterion = op.create
        criterion.ad_group = ad_group_resource
        criterion.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
        criterion.keyword.text = kw_text
        criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum[match_enum]
        ops.append(op)

    if not dry_run and ops:
        criterion_service = client.get_service("AdGroupCriterionService")
        resp = criterion_service.mutate_ad_group_criteria(customer_id=customer_id, operations=ops)
        print(f"      [OK] {len(resp.results)} keywords added")


# ---------------------------------------------------------------------------
# Add negative keywords (campaign level)
# ---------------------------------------------------------------------------

def add_campaign_negatives(client, customer_id: str, campaign_resource: str,
                           negatives: list, dry_run: bool) -> None:
    if not negatives:
        return

    if dry_run:
        print(f"  [NEGATIVES] {len(negatives)} campaign-level negative keywords")
        return

    ops = []
    criterion_service = client.get_service("CampaignCriterionService")

    for kw_text in negatives:
        op = client.get_type("CampaignCriterionOperation")
        criterion = op.create
        criterion.campaign = campaign_resource
        criterion.negative = True
        criterion.keyword.text = kw_text
        criterion.keyword.match_type = client.enums.KeywordMatchTypeEnum.BROAD
        ops.append(op)

    resp = criterion_service.mutate_campaign_criteria(customer_id=customer_id, operations=ops)
    print(f"  [OK] {len(resp.results)} campaign negative keywords added")


# ---------------------------------------------------------------------------
# Create RSA ad
# ---------------------------------------------------------------------------

def create_rsa(client, customer_id: str, ad_group_resource: str,
               rsa_cfg: dict, dry_run: bool) -> None:
    final_url = rsa_cfg["final_url"]
    headlines = rsa_cfg["headlines"]
    descriptions = rsa_cfg["descriptions"]

    if dry_run:
        print(f"      [RSA] {len(headlines)} headlines, {len(descriptions)} descriptions")
        print(f"             URL: {final_url}")
        return

    ad_group_ad_service = client.get_service("AdGroupAdService")
    op = client.get_type("AdGroupAdOperation")
    ad_group_ad = op.create

    ad_group_ad.ad_group = ad_group_resource
    ad_group_ad.status = client.enums.AdGroupAdStatusEnum.PAUSED  # start paused

    ad = ad_group_ad.ad
    ad.final_urls.append(final_url)

    rsa = ad.responsive_search_ad

    for h_text in headlines:
        h = client.get_type("AdTextAsset")
        h.text = h_text[:30]  # Google enforces 30-char limit
        rsa.headlines.append(h)

    for d_text in descriptions:
        d = client.get_type("AdTextAsset")
        d.text = d_text[:90]  # Google enforces 90-char limit
        rsa.descriptions.append(d)

    resp = ad_group_ad_service.mutate_ad_group_ads(customer_id=customer_id, operations=[op])
    print(f"      [OK] RSA ad: {resp.results[0].resource_name}")


# ---------------------------------------------------------------------------
# Build one campaign end-to-end
# ---------------------------------------------------------------------------

def build_campaign(client, customer_id: str, key: str, dry_run: bool) -> None:
    cfg = CAMPAIGNS[key]
    print(f"\n{'=' * 60}")
    print(f"Campaign: {cfg['name']}")
    print(f"{'=' * 60}")

    # Budget
    budget_resource = create_budget(
        client, customer_id,
        name=f"Budget — {cfg['name']}",
        daily_usd=cfg["daily_budget_usd"],
        dry_run=dry_run,
    )

    # Campaign
    campaign_resource = create_campaign(
        client, customer_id, cfg, budget_resource, dry_run=dry_run
    )

    # Geo targeting
    add_geo_targeting(
        client, customer_id, campaign_resource,
        radius_miles=cfg["geo_radius_miles"],
        lop_only=cfg.get("geo_radius_only_presence", True),
        dry_run=dry_run,
    )

    # Campaign-level negatives
    add_campaign_negatives(
        client, customer_id, campaign_resource,
        negatives=cfg.get("negative_keywords", []),
        dry_run=dry_run,
    )

    # Ad groups
    for ag_cfg in cfg["ad_groups"]:
        print(f"\n  Ad Group: {ag_cfg['name']}")
        ad_group_resource = create_ad_group(
            client, customer_id, campaign_resource, ag_cfg, dry_run=dry_run
        )

        add_keywords(
            client, customer_id, ad_group_resource,
            keywords=ag_cfg["keywords"],
            dry_run=dry_run,
        )

        if ag_cfg.get("rsa"):
            create_rsa(
                client, customer_id, ad_group_resource,
                rsa_cfg=ag_cfg["rsa"],
                dry_run=dry_run,
            )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create Wallace Collision Center Google Ads campaigns in PAUSED status"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview all operations without making changes",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip confirmation prompt",
    )
    parser.add_argument(
        "--campaign",
        choices=list(CAMPAIGNS.keys()) + ["all"],
        default="all",
        help="Which campaign to create (default: all)",
    )
    args = parser.parse_args()

    mode = "DRY RUN — no changes will be made" if args.dry_run else "LIVE — campaigns will be created PAUSED"
    print(f"\nWallace Collision Center — Campaign Creation")
    print(f"Account: {CUSTOMER_ID}")
    print(f"Mode: {mode}")
    print(f"Base URL: {BASE_URL}")

    if not args.dry_run and not args.yes:
        confirm = input("\nType 'yes' to proceed: ").strip().lower()
        if confirm != "yes":
            print("Aborted.")
            sys.exit(0)

    client = load_client()

    campaigns_to_build = list(CAMPAIGNS.keys()) if args.campaign == "all" else [args.campaign]

    for key in campaigns_to_build:
        build_campaign(client, CUSTOMER_ID, key, dry_run=args.dry_run)

    print(f"\n{'=' * 60}")
    if args.dry_run:
        print("DRY RUN complete. Re-run without --dry-run to create campaigns.")
    else:
        print("Campaign creation complete.")
        print("\nNext steps:")
        print("  1. Open Google Ads UI → Campaigns (filter: Paused)")
        print("  2. Review each campaign's keywords, ads, and targeting")
        print("  3. Update BASE_URL placeholders in final URLs if needed")
        print("  4. Update [YEAR] and [X] placeholders in ad copy")
        print("  5. Add call assets, location assets, and sitelink extensions manually")
        print("  6. Enable campaigns one at a time when ready to go live")
        print(f"\nAccount: https://ads.google.com/aw/campaigns?__e={CUSTOMER_ID}")


if __name__ == "__main__":
    main()
