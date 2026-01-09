import express from "express";
import cors from "cors";
import { z } from "zod";

/**
 * Charter Cost Estimator API (v1)
 * Scope: US + Canada + Mexico + Caribbean + Europe
 * Purpose: broad budget estimates (NOT quotes)
 */

const app = express();
app.use(cors()); // v1: open CORS. Later you can restrict to your Squarespace domain.
app.use(express.json());

/* ----------------------------- Country Lists ---------------------------- */

const CARIBBEAN_COUNTRIES = new Set([
  "Bahamas","Jamaica","Dominican Republic","Barbados","Saint Martin","Sint Maarten",
  "Antigua and Barbuda","Saint Lucia","Grenada","Trinidad and Tobago","Aruba",
  "Curaçao","Turks and Caicos Islands","Puerto Rico","U.S. Virgin Islands",
  "British Virgin Islands","Cayman Islands","Haiti","Guadeloupe","Martinique",
  "St. Kitts and Nevis","Saint Vincent and the Grenadines"
]);

const EUROPE_COUNTRIES = new Set([
  "United Kingdom","Ireland","France","Germany","Spain","Portugal","Italy","Switzerland",
  "Austria","Netherlands","Belgium","Luxembourg","Denmark","Norway","Sweden","Finland",
  "Iceland","Poland","Czechia","Slovakia","Hungary","Romania","Bulgaria","Greece",
  "Croatia","Slovenia","Serbia","Montenegro","Albania","North Macedonia","Bosnia and Herzegovina",
  "Estonia","Latvia","Lithuania","Ukraine","Moldova","Andorra","Monaco","San Marino","Liechtenstein",
  "Malta","Cyprus"
]);

/* ----------------------------- Rate Tables ------------------------------ */

const RATE_TABLE = {
  TURBOPROP: { low: 2200, high: 3200 },
  LIGHT_JET: { low: 3500, high: 5000 },
  MIDSIZE: { low: 5500, high: 7500 },
  SUPER_MID: { low: 7500, high: 10000 },
  HEAVY_JET: { low: 10000, high: 16000 },
};

const CRUISE_SPEED_KTS = {
  TURBOPROP: 280,
  LIGHT_JET: 420,
  MIDSIZE: 450,
  SUPER_MID: 470,
  HEAVY_JET: 500,
};

const US_FEE_PER_STOP = {
  TURBOPROP: { low: 400, high: 700 },
  LIGHT_JET: { low: 400, high: 700 },
  MIDSIZE: { low: 600, high: 1000 },
  SUPER_MID: { low: 800, high: 1300 },
  HEAVY_JET: { low: 1200, high: 2000 },
};

const CANADA_FEE_PER_STOP = { low: 500, high: 1200 };
const MEXICO_FEE_PER_STOP = { low: 1000, high: 2500 };
const CARIBBEAN_FEE_PER_STOP = { low: 1200, high: 3000 };
const EUROPE_FEE_PER_STOP = { low: 3000, high: 8000 };

const STANDARD_CREW_PER_NIGHT = { low: 1500, high: 3000 };
const EUROPE_CREW_PER_NIGHT = { low: 3000, high: 6000 };

const DAILY_MIN_HOURS = 2;

const VOLATILITY = {
  0: 0.10,
  1: 0.15,
  2: 0.20,
  3: 0.25,
  "4+": 0.35,
};

const MAJOR_AIRPORTS = new Set([
  "KTEB","KHPN","KLGA","KJFK","KEWR","KBOS","KIAD","KDCA","KATL","KMIA","KFLL",
  "KORD","KMDW","KDFW","KDAL","KDEN","KLAX","KSNA","KSFO","KOAK","KSEA","KPHX",
  "KLAS","KMSP","KDTW","KIAH","KHOU","KBWI"
]);

/* ---------------------------- Airport Dataset --------------------------- */
/**
 * Beginner version: small list. Expand later.
 */
const AIRPORTS = [
  { icao: "KTEB", name: "Teterboro", lat: 40.8501, lon: -74.0608, country: "United States" },
  { icao: "KJFK", name: "New York JFK", lat: 40.6413, lon: -73.7781, country: "United States" },
  { icao: "KLAX", name: "Los Angeles", lat: 33.9416, lon: -118.4085, country: "United States" },
  { icao: "KSFO", name: "San Francisco", lat: 37.6213, lon: -122.3790, country: "United States" },
  { icao: "KMIA", name: "Miami", lat: 25.7959, lon: -80.2870, country: "United States" },
  { icao: "KORD", name: "Chicago O'Hare", lat: 41.9742, lon: -87.9073, country: "United States" },
  { icao: "KDAL", name: "Dallas Love Field", lat: 32.8471, lon: -96.8517, country: "United States" },

  { icao: "CYYZ", name: "Toronto Pearson", lat: 43.6777, lon: -79.6248, country: "Canada" },
  { icao: "CYVR", name: "Vancouver", lat: 49.1967, lon: -123.1815, country: "Canada" },

  { icao: "MMUN", name: "Cancún", lat: 21.0365, lon: -86.8771, country: "Mexico" },
  { icao: "MMSD", name: "Los Cabos (SJD)", lat: 23.1518, lon: -109.7210, country: "Mexico" },

  { icao: "MYNN", name: "Nassau", lat: 25.0389, lon: -77.4662, country: "Bahamas" },
  { icao: "MKJP", name: "Montego Bay", lat: 18.5037, lon: -77.9134, country: "Jamaica" },
  { icao: "TJSJ", name: "San Juan", lat: 18.4394, lon: -66.0018, country: "Puerto Rico" },
  { icao: "MDPC", name: "Punta Cana", lat: 18.5674, lon: -68.3634, country: "Dominican Republic" },

  { icao: "EGLL", name: "London Heathrow", lat: 51.4700, lon: -0.4543, country: "United Kingdom" },
  { icao: "LFPB", name: "Paris Le Bourget", lat: 48.9694, lon: 2.4414, country: "France" },
  { icao: "EDDM", name: "Munich", lat: 48.3538, lon: 11.7861, country: "Germany" },
  { icao: "LEMD", name: "Madrid", lat: 40.4983, lon: -3.5676, country: "Spain" },
];

function findAirport(icao) {
  const key = String(icao || "").trim().toUpperCase();
  return AIRPORTS.find(a => a.icao === key);
}

/* ---------------------------- Math Helpers ------------------------------ */

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineNm(a, b) {
  const R_km = 6371;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));

  const distanceKm = R_km * c;
  const nmPerKm = 0.539957;
  return distanceKm * nmPerKm;
}

function roundDownTo(x, step = 1000) {
  return Math.floor(x / step) * step;
}

function roundUpTo(x, step = 1000) {
  return Math.ceil(x / step) * step;
}

function clampInt(n, min, max) {
  const v = Number.isFinite(n) ? Math.trunc(n) : min;
  return Math.max(min, Math.min(max, v));
}

/* -------------------------- Region + Estimation ------------------------- */

function classifyRegion(destinationCountry) {
  if (destinationCountry === "United States") return "US_DOMESTIC";
  if (destinationCountry === "Canada") return "CANADA";
  if (destinationCountry === "Mexico") return "MEXICO";
  if (CARIBBEAN_COUNTRIES.has(destinationCountry)) return "CARIBBEAN";
  if (EUROPE_COUNTRIES.has(destinationCountry)) return "EUROPE";
  return "UNSUPPORTED";
}

function suggestAircraftClass(pax, distanceNm, region) {
  if (region === "EUROPE" && distanceNm > 2500) return "HEAVY_JET";

  if (pax <= 4 && distanceNm < 500) return "TURBOPROP";
  if (pax <= 6 && distanceNm < 1200) return "LIGHT_JET";
  if (pax <= 8 && distanceNm < 1800) return "MIDSIZE";
  if (pax <= 10 && distanceNm < 2500) return "SUPER_MID";
  return "HEAVY_JET";
}

function estimateBlockHours(distanceNm, aircraft, region) {
  const speed = CRUISE_SPEED_KTS[aircraft];
  const flightHours = distanceNm / speed;

  let buffer = 0.4;
  if (region !== "US_DOMESTIC") buffer += 0.2;
  if (region === "EUROPE") buffer += 1.0;

  return flightHours + buffer;
}

function perStopAllowance(region, aircraft) {
  switch (region) {
    case "US_DOMESTIC": return US_FEE_PER_STOP[aircraft];
    case "CANADA": return CANADA_FEE_PER_STOP;
    case "MEXICO": return MEXICO_FEE_PER_STOP;
    case "CARIBBEAN": return CARIBBEAN_FEE_PER_STOP;
    case "EUROPE": return EUROPE_FEE_PER_STOP;
    default: return { low: 0, high: 0 };
  }
}

function estimateOvernightNights(isRoundTrip, departDateISO, returnDateISO, region) {
  if (!isRoundTrip) return 0;
  if (!returnDateISO) return 0;

  const dep = new Date(departDateISO);
  const ret = new Date(returnDateISO);
  const depDay = Date.UTC(dep.getUTCFullYear(), dep.getUTCMonth(), dep.getUTCDate());
  const retDay = Date.UTC(ret.getUTCFullYear(), ret.getUTCMonth(), ret.getUTCDate());
  const diffDays = Math.round((retDay - depDay) / (24 * 3600 * 1000));

  if (diffDays <= 0) return region === "EUROPE" ? 1 : 0;
  return diffDays;
}

function isWeekend(dateISO) {
  const d = new Date(dateISO);
  const day = d.getUTCDay();
  return day === 0 || day === 5 || day === 6; // Sun/Fri/Sat
}

function computeRiskScore({
  departDateISO,
  region,
  overnightNights,
  originIcao,
  destIcao,
  shortNoticeDays,
  timeFlex
}) {
  let risk = 0;
  if (shortNoticeDays <= 3) risk += 1;
  if (isWeekend(departDateISO)) risk += 1;
  if (overnightNights > 0) risk += 1;

  const originMajor = MAJOR_AIRPORTS.has(originIcao.toUpperCase());
  const destMajor = MAJOR_AIRPORTS.has(destIcao.toUpperCase());
  if (!originMajor || !destMajor) risk += 1;

  if (timeFlex === "tight") risk += 1;
  if (region === "MEXICO" || region === "CARIBBEAN") risk += 1;
  if (region === "EUROPE") risk += 2;

  return risk;
}

function riskToMultiplier(risk) {
  if (risk <= 0) return VOLATILITY[0];
  if (risk === 1) return VOLATILITY[1];
  if (risk === 2) return VOLATILITY[2];
  if (risk === 3) return VOLATILITY[3];
  return VOLATILITY["4+"];
}

function confidenceFromRegionAndRisk(region, risk) {
  if (region === "EUROPE") return "LOW";
  if (region === "MEXICO" || region === "CARIBBEAN") return risk >= 2 ? "LOW" : "MEDIUM";
  if (region === "CANADA") return risk >= 3 ? "MEDIUM" : "HIGH";
  return risk >= 3 ? "MEDIUM" : "HIGH";
}

function estimateTrip(input) {
  const origin = findAirport(input.originIcao);
  const dest = findAirport(input.destIcao);

  if (!origin || !dest) {
    return {
      region: "UNSUPPORTED",
      aircraft: "LIGHT_JET",
      estimate_low: 0,
      estimate_high: 0,
      confidence: "LOW",
      currency: "USD",
      breakdown: {
        assumptions: ["Unknown airport(s). Add them to the dataset."],
        may_change: ["Aircraft availability", "Airport fees", "Crew requirements"],
      },
    };
  }

  const region = classifyRegion(dest.country);

  const distanceNmOneWay = haversineNm(origin, dest);
  const legs = input.isRoundTrip ? 2 : 1;
  const distanceNmTotal = distanceNmOneWay * legs;

  const pax = clampInt(input.pax, 1, 30);
  const aircraft = suggestAircraftClass(pax, distanceNmOneWay, region);

  const blockPerLeg = estimateBlockHours(distanceNmOneWay, aircraft, region);
  const totalBlockHours = blockPerLeg * legs;
  const billableHours = Math.max(totalBlockHours, DAILY_MIN_HOURS);

  const rate = RATE_TABLE[aircraft];
  const baseCharter = {
    low: billableHours * rate.low,
    high: billableHours * rate.high,
  };

  const stops = input.isRoundTrip ? 2 : 1;
  const feePerStop = perStopAllowance(region, aircraft);
  const regionalFees = {
    low: stops * feePerStop.low,
    high: stops * feePerStop.high,
  };

  const overnightNights = estimateOvernightNights(
    input.isRoundTrip,
    input.departDateISO,
    input.returnDateISO,
    region
  );

  const crewRate = region === "EUROPE" ? EUROPE_CREW_PER_NIGHT : STANDARD_CREW_PER_NIGHT;
  const crew = overnightNights > 0
    ? { low: overnightNights * crewRate.low, high: overnightNights * crewRate.high }
    : { low: 0, high: 0 };

  const subtotal = {
    low: baseCharter.low + regionalFees.low + crew.low,
    high: baseCharter.high + regionalFees.high + crew.high,
  };

  const risk = computeRiskScore({
    departDateISO: input.departDateISO,
    region,
    overnightNights,
    originIcao: origin.icao,
    destIcao: dest.icao,
    shortNoticeDays: input.shortNoticeDays,
    timeFlex: input.timeFlex,
  });

  const multiplier = riskToMultiplier(risk);

  const displayLow = roundDownTo(subtotal.low * (1 - multiplier), 1000);
  const displayHigh = roundUpTo(subtotal.high * (1 + multiplier), 1000);

  const assumptions = [
    "Estimate only (not a quote).",
    "Includes broad allowances for handling/airport/government costs by region.",
    "Hourly rates reflect market bands and vary by aircraft, operator, and date.",
  ];
  if (region === "EUROPE") {
    assumptions.push("Europe estimates are intentionally broad due to fees, taxes/VAT, and availability variability.");
  }

  const mayChange = [
    "Aircraft availability & repositioning",
    "Airport handling/parking charges",
    "Crew duty/rest requirements",
    "Weather impacts (e.g., deicing) and irregular ops",
  ];

  const confidence = confidenceFromRegionAndRisk(region, risk);

  return {
    region,
    aircraft,
    estimate_low: Math.max(0, displayLow),
    estimate_high: Math.max(displayLow + 1000, displayHigh),
    confidence,
    currency: "USD",
    breakdown: {
      base_charter: baseCharter,
      regional_fees: regionalFees,
      crew,
      subtotal,
      volatility_multiplier: multiplier,
      distance_nm: Math.round(distanceNmTotal),
      billable_hours: Math.round(billableHours * 10) / 10,
      legs,
      overnight_nights: overnightNights,
      assumptions,
      may_change: mayChange,
    },
  };
}

/* --------------------------------- API --------------------------------- */

const EstimateRequestSchema = z.object({
  originIcao: z.string().min(3),
  destIcao: z.string().min(3),
  departDateISO: z.string().min(8), // YYYY-MM-DD
  isRoundTrip: z.boolean(),
  returnDateISO: z.string().nullable().optional(),
  pax: z.number().int().min(1).max(30),
  timeFlex: z.enum(["tight", "flex"]).default("flex"),
  shortNoticeDays: z.number().int().min(0).max(365).default(7),
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/airports", (_req, res) => {
  res.json(AIRPORTS.map(a => ({ icao: a.icao, name: a.name, country: a.country })));
});

app.post("/estimate", (req, res) => {
  const parsed = EstimateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const result = estimateTrip(parsed.data);
  return res.json(result);
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(PORT, () => {
  console.log(`Estimator API running on port ${PORT}`);
});
