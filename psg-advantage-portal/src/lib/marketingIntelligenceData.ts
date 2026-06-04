export const marketingIntelligenceData = {
  "metadata": {
    "source": "yuvidhepe/us-accidents-updated",
    "split": "default/train",
    "rowCount": 7728394,
    "expectedRowCount": 7728394,
    "weatherRelatedCount": 350139,
    "severeAccidentRate": 10.1,
    "weatherRelatedRate": 12.3,
    "averageDistanceMiles": 0.7
  },
  "metrics": {
    "targetableAccidentDemand": 30556,
    "coverageGap": 50,
    "bestNextChannel": "Paid search"
  },
  "opportunityByZip": [
    {
      "zip": "33186",
      "accidents": 7958,
      "repairDemand": 100,
      "shopCoverage": 40,
      "paidSearch": 89
    },
    {
      "zip": "91761",
      "accidents": 6286,
      "repairDemand": 86,
      "shopCoverage": 49,
      "paidSearch": 76
    },
    {
      "zip": "32819",
      "accidents": 5705,
      "repairDemand": 82,
      "shopCoverage": 52,
      "paidSearch": 72
    },
    {
      "zip": "33155",
      "accidents": 5502,
      "repairDemand": 80,
      "shopCoverage": 53,
      "paidSearch": 71
    },
    {
      "zip": "33169",
      "accidents": 5105,
      "repairDemand": 77,
      "shopCoverage": 55,
      "paidSearch": 68
    }
  ],
  "daypartDemand": [
    {
      "time": "12a",
      "claims": 42,
      "search": 38
    },
    {
      "time": "3a",
      "claims": 42,
      "search": 38
    },
    {
      "time": "6a",
      "claims": 67,
      "search": 60
    },
    {
      "time": "9a",
      "claims": 60,
      "search": 54
    },
    {
      "time": "12p",
      "claims": 81,
      "search": 73
    },
    {
      "time": "3p",
      "claims": 100,
      "search": 90
    },
    {
      "time": "6p",
      "claims": 67,
      "search": 60
    },
    {
      "time": "9p",
      "claims": 50,
      "search": 45
    }
  ],
  "marketMix": [
    {
      "channel": "Paid search",
      "score": 89
    },
    {
      "channel": "Tow partner",
      "score": 76
    },
    {
      "channel": "Geofenced display",
      "score": 64
    },
    {
      "channel": "Local service ads",
      "score": 69
    },
    {
      "channel": "Weather trigger",
      "score": 70
    }
  ],
  "customerSignals": [
    {
      "signal": "Accident density",
      "current": 78,
      "target": 90
    },
    {
      "signal": "Shop coverage",
      "current": 40,
      "target": 80
    },
    {
      "signal": "Severity mix",
      "current": 66,
      "target": 75
    },
    {
      "signal": "Weather risk",
      "current": 70,
      "target": 72
    },
    {
      "signal": "Coverage gap",
      "current": 60,
      "target": 68
    }
  ],
  "segments": [
    {
      "name": "High-intent collision searches",
      "audience": "Drivers in the top accident ZIPs: 33186, 91761, 32819.",
      "action": "Increase paid search coverage during the highest accident dayparts.",
      "impact": "19,949 priority accidents"
    },
    {
      "name": "Tow and referral partner zones",
      "audience": "ZIPs with high accident volume and inferred shop coverage gaps.",
      "action": "Use the top ZIP list to prioritize tow, carrier, and DRP partner outreach.",
      "impact": "50% coverage gap"
    },
    {
      "name": "Weather-triggered outreach",
      "audience": "Markets where rain, snow, fog, or precipitation is present in accident records.",
      "action": "Launch same-day paid search and social bursts after severe weather alerts.",
      "impact": "350,139 weather-linked accidents"
    }
  ]
} as const
