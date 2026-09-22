/** Curated examples, generated using the builders' defaults on 2026-09-21.
 * Figures are recomputed from the bundled data by tests/demo-example-figures.test.ts.
 * Rates are displayed percentages, changes in percentage metrics are percentage points,
 * and relativeChange is a percentage (not a fraction).
 */
export const DEMO_MODEL_VERSION = 'v0o7';
export const DEMO_EVIDENCE_YEAR = 2011;
export const DEMO_EXAMPLE_SET_VERSION = 1;
export const DEMO_EXAMPLE_IDS = {
  policyRunId: 'Example Bank Rate raised by 1 pp v0o7',
  baselineRunId: 'Example 2024 policy, unchanged v0o7',
  sensitivityExperimentId: 'sensitivity-20260921T215211Z-f1c9432c'
} as const;
export const DEMO_EXAMPLE_TITLES = {
  policy: 'Example: Bank Rate raised by 1 pp',
  baseline: 'Example: 2024 policy, unchanged',
  sensitivity: 'Example: LTI threshold, 4× to 5×'
} as const;

export const DEMO_EXAMPLE_FIGURES = {
  "configuration": {
    "modelVersion": "v0o7",
    "evidenceYear": 2011,
    "basePolicy": "2024",
    "seeds": 8,
    "policyMonths": 3500,
    "sensitivityMonths": 2000,
    "analysisStartMonth": 500,
    "policyBankRate": 6.10833333,
    "referenceBankRate": 5.10833333,
    "policyBankRateRisePp": 1,
    "sensitivitySettings": [
      4,
      4.25,
      4.5,
      4.75,
      5
    ]
  },
  "policy": {
    "housePrice": {
      "selected": 156467.20875374842,
      "baseline": 161026.0220326556,
      "change": -4558.813278907182,
      "relativeChange": -2.831103458534589
    },
    "debtToIncome": {
      "selected": 87.25792727007685,
      "baseline": 91.29115558147281,
      "change": -4.033228311395959,
      "relativeChange": -4.417983632375541
    },
    "approvals": {
      "selected": 51015.469218593804,
      "baseline": 51672.61225424858,
      "change": -657.1430356547789,
      "relativeChange": -1.2717433994267395
    },
    "transactions": {
      "selected": 99655.85313228924,
      "baseline": 99701.8600883039,
      "change": -46.006956014665775,
      "relativeChange": -0.04614453127947498
    },
    "firstTimeBuyers": {
      "selected": 23337.407989003666,
      "baseline": 23338.16340386538,
      "change": -0.7554148617127794,
      "relativeChange": -0.003236822232496941
    },
    "homeMovers": {
      "selected": 19981.470593135622,
      "baseline": 19499.400824725093,
      "change": 482.0697684105289,
      "relativeChange": 2.472228622529099
    },
    "buyToLet": {
      "selected": 7696.590636454515,
      "baseline": 8835.048025658114,
      "change": -1138.4573892035987,
      "relativeChange": -12.88569553778737
    },
    "ownership": {
      "selected": 56.184550913156095,
      "baseline": 55.596793361810185,
      "change": 0.5877575513459092,
      "relativeChange": 1.057178869149752
    },
    "rentalYield": {
      "selected": 5.476923604631783,
      "baseline": 5.078676545318225,
      "change": 0.3982470593135581,
      "relativeChange": 7.841551942910834
    },
    "privateRenting": {
      "selected": 18.894581665650637,
      "baseline": 19.39377862877763,
      "change": -0.499196963126991,
      "relativeChange": -2.5740056782243212
    },
    "priceGrowthVolatility": {
      "selected": 0.9372595791563232,
      "baseline": 0.9314900995798657,
      "change": 0.005769479576457459,
      "relativeChange": 0.6193817388998223
    }
  },
  "sensitivity": {
    "successfulSeeds": 40,
    "expectedSeeds": 40,
    "initialSettingId": "point-4",
    "rows": [
      {
        "settingId": "point-4",
        "value": 4,
        "approvals": {
          "selected": 51451.249375347026,
          "baseline": 51251.1592171016,
          "change": 200.0901582454244,
          "relativeChange": 0.3904109903111379,
          "higher": 4,
          "lower": 4,
          "total": 8,
          "min": -787.7962243198199,
          "max": 1138.0460855080455
        },
        "debtToIncome": {
          "selected": 88.17105564269849,
          "baseline": 90.67007193225983,
          "change": -2.4990162895613395,
          "relativeChange": -2.75616445019297,
          "higher": 0,
          "lower": 8,
          "total": 8,
          "min": -3.548851193781033,
          "max": -1.2768067184897376
        },
        "priceToIncome": {
          "selected": 5.855111951693505,
          "baseline": 6.001242129372571,
          "change": -0.14613017767906555,
          "relativeChange": -2.434998864049224,
          "higher": 1,
          "lower": 7,
          "total": 8,
          "min": -0.260183675735707,
          "max": 0.04694791782344332
        },
        "firstTimeBuyers": {
          "selected": 23018.929830649642,
          "baseline": 23099.35868961688,
          "change": -80.42885896723965,
          "relativeChange": -0.34818654512426905,
          "higher": 4,
          "lower": 4,
          "total": 8,
          "min": -443.0455302609662,
          "max": 132.02998334258882
        }
      },
      {
        "settingId": "point-4.25",
        "value": 4.25,
        "approvals": {
          "selected": 51638.44752915048,
          "baseline": 51251.1592171016,
          "change": 387.28831204887683,
          "relativeChange": 0.7556674189715608,
          "higher": 6,
          "lower": 2,
          "total": 8,
          "min": -1245.951693503608,
          "max": 1143.606329816772
        },
        "debtToIncome": {
          "selected": 89.75977289700168,
          "baseline": 90.67007193225983,
          "change": -0.9102990352581486,
          "relativeChange": -1.0039685817589719,
          "higher": 2,
          "lower": 6,
          "total": 8,
          "min": -2.369641254858152,
          "max": 0.46465186007796433
        },
        "priceToIncome": {
          "selected": 5.898154851471402,
          "baseline": 6.001242129372571,
          "change": -0.10308727790116912,
          "relativeChange": -1.7177656838176412,
          "higher": 1,
          "lower": 7,
          "total": 8,
          "min": -0.20047723486951874,
          "max": 0.02207268184340183
        },
        "firstTimeBuyers": {
          "selected": 23212.674139367016,
          "baseline": 23099.35868961688,
          "change": 113.31544975013458,
          "relativeChange": 0.4905566915200536,
          "higher": 7,
          "lower": 1,
          "total": 8,
          "min": -301.5913381454775,
          "max": 347.9650194336464
        }
      },
      {
        "settingId": "point-4.5",
        "value": 4.5,
        "approvals": {
          "selected": 51251.1592171016,
          "baseline": 51251.1592171016,
          "change": 0,
          "relativeChange": 0,
          "higher": 0,
          "lower": 0,
          "total": 0,
          "min": 0,
          "max": 0
        },
        "debtToIncome": {
          "selected": 90.67007193225983,
          "baseline": 90.67007193225983,
          "change": 0,
          "relativeChange": 0,
          "higher": 0,
          "lower": 0,
          "total": 0,
          "min": 0,
          "max": 0
        },
        "priceToIncome": {
          "selected": 6.001242129372571,
          "baseline": 6.001242129372571,
          "change": 0,
          "relativeChange": 0,
          "higher": 0,
          "lower": 0,
          "total": 0,
          "min": 0,
          "max": 0
        },
        "firstTimeBuyers": {
          "selected": 23099.35868961688,
          "baseline": 23099.35868961688,
          "change": 0,
          "relativeChange": 0,
          "higher": 0,
          "lower": 0,
          "total": 0,
          "min": 0,
          "max": 0
        }
      },
      {
        "settingId": "point-4.75",
        "value": 4.75,
        "approvals": {
          "selected": 51060.53782620766,
          "baseline": 51251.1592171016,
          "change": -190.62139089393895,
          "relativeChange": -0.37193576458721733,
          "higher": 2,
          "lower": 6,
          "total": 8,
          "min": -722.8528595224852,
          "max": 1383.6091060521867
        },
        "debtToIncome": {
          "selected": 91.50747869239314,
          "baseline": 90.67007193225983,
          "change": 0.8374067601333053,
          "relativeChange": 0.9235757094787981,
          "higher": 5,
          "lower": 3,
          "total": 8,
          "min": -0.7273654081063796,
          "max": 3.2077498611882334
        },
        "priceToIncome": {
          "selected": 6.007057919211548,
          "baseline": 6.001242129372571,
          "change": 0.005815789838977459,
          "relativeChange": 0.0969097682380214,
          "higher": 4,
          "lower": 4,
          "total": 8,
          "min": -0.13012909494725022,
          "max": 0.13578406440865987
        },
        "firstTimeBuyers": {
          "selected": 23015.471474181013,
          "baseline": 23099.35868961688,
          "change": -83.88721543586871,
          "relativeChange": -0.3631582008966156,
          "higher": 3,
          "lower": 5,
          "total": 8,
          "min": -540.1116046640745,
          "max": 446.0882842865067
        }
      },
      {
        "settingId": "point-5",
        "value": 5,
        "approvals": {
          "selected": 51708.48105219322,
          "baseline": 51251.1592171016,
          "change": 457.3218350916213,
          "relativeChange": 0.8923151048240507,
          "higher": 5,
          "lower": 3,
          "total": 8,
          "min": -647.2459744586304,
          "max": 1374.5541365907848
        },
        "debtToIncome": {
          "selected": 92.18190691976685,
          "baseline": 90.67007193225983,
          "change": 1.5118349875070152,
          "relativeChange": 1.6674024353223371,
          "higher": 7,
          "lower": 1,
          "total": 8,
          "min": -1.1269120488614988,
          "max": 2.766388561910233
        },
        "priceToIncome": {
          "selected": 5.974370717656864,
          "baseline": 6.001242129372571,
          "change": -0.026871411715706728,
          "relativeChange": -0.447764165091538,
          "higher": 3,
          "lower": 5,
          "total": 8,
          "min": -0.12962987229316436,
          "max": 0.09158672959467573
        },
        "firstTimeBuyers": {
          "selected": 23193.662479178234,
          "baseline": 23099.35868961688,
          "change": 94.30378956135246,
          "relativeChange": 0.4082528473127777,
          "higher": 5,
          "lower": 3,
          "total": 8,
          "min": -179.8373126041115,
          "max": 301.40366463076134
        }
      }
    ]
  }
} as const;
