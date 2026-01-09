import express from "express";
import cors from "cors";
import { z } from "zod";

/**
 * Charter Calculator API (v2)
 * - Default home base: Austin (KAUS)
 * - City-based inputs (no airport codes in UI)
 * - Aircraft class dropdown + pax filtering
 * - Round trips
 * - Reposition legs (KAUS-based) instead of big overnight fees / daily mins
 */

const app = express();
app.use(cors());
app.use(express.json());

/* ------------------------------ Constants ------------------------------ */

const HOME_BASE_ICAO = "KAUS";
const HOME_BASE_CITY_KEY = "Austin, TX, US";

/** Aircraft classes (ordered) */
const AIRCRAFT_CLASSES = ["TURBOPROP", "LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"];

/** Typical cruise speeds (knots) */
const CRUISE_SPEED_KTS = {
  TURBOPROP: 280,
  LIGHT_JET: 420,
  MIDSIZE: 450,
  SUPER_MID: 470,
  HEAVY_JET: 500,
};

/** Typical max practical range (nautical miles) — conservative */
const MAX_RANGE_NM = {
  TURBOPROP: 900,
  LIGHT_JET: 1500,
  MIDSIZE: 2000,
  SUPER_MID: 2800,
  HEAVY_JET: 6000,
};

/** Hourly rate bands (USD / flight hour). Adjust to your market. */
const RATE_TABLE = {
  TURBOPROP: { low: 2200, high: 3200 },
  LIGHT_JET: { low: 3500, high: 5200 },
  MIDSIZE: { low: 5600, high: 7800 },
  SUPER_MID: { low: 7800, high: 10500 },
  HEAVY_JET: { low: 10500, high: 17000 },
};

/**
 * Regional per-landing allowance (very simplified).
 * These cover handling/landing-ish costs (broad).
 */
const REGION_FEE_PER_STOP = {
  US: { low: 600, high: 1200 },
  MEXICO: { low: 1200, high: 2800 },
};

/**
 * Reposition factor assumptions:
 * - You said “factor reposition legs rather than substantial overnight fees/daily mins”.
 * - We’ll model reposition as extra flight legs from/to HOME BASE depending on where the trip starts/ends.
 * - We also add a small “availability friction” buffer by city tier (major hub vs smaller city).
 */
const CITY_TIER_REPOSITION_HOURS = {
  major: 0.4, // additional hours (planning, ATC, reposition inefficiency)
  large: 0.6,
  mid: 0.8,
};

/** Volatility multipliers by risk score */
const VOLATILITY = {
  0: 0.10,
  1: 0.15,
  2: 0.20,
  3: 0.25,
  "4+": 0.35,
};

/* ------------------------------ City Data ------------------------------ */
/**
 * We use “city names” in UI, but compute from a representative airport per city.
 * This list is intentionally “major cities” in US + Mexico (expand anytime).
 * cityKey must be unique.
 */
const CITIES = [
  // --- Texas & nearby anchors ---
  { cityKey: "Austin, TX, US", city: "Austin", region: "TX", country: "US", icao: "KAUS", lat: 30.2025, lon: -97.6664, tier: "major" },
  { cityKey: "Dallas, TX, US", city: "Dallas", region: "TX", country: "US", icao: "KDAL", lat: 32.8471, lon: -96.8517, tier: "major" },
  { cityKey: "Houston, TX, US", city: "Houston", region: "TX", country: "US", icao: "KHOU", lat: 29.6454, lon: -95.2789, tier: "major" },
  { cityKey: "San Antonio, TX, US", city: "San Antonio", region: "TX", country: "US", icao: "KSAT", lat: 29.5337, lon: -98.4698, tier: "large" },

  // --- Major US cities ---
  { cityKey: "New York, NY, US", city: "New York", region: "NY", country: "US", icao: "KTEB", lat: 40.8501, lon: -74.0608, tier: "major" },
  { cityKey: "Los Angeles, CA, US", city: "Los Angeles", region: "CA", country: "US", icao: "KLAX", lat: 33.9416, lon: -118.4085, tier: "major" },
  { cityKey: "San Francisco, CA, US", city: "San Francisco", region: "CA", country: "US", icao: "KSFO", lat: 37.6213, lon: -122.3790, tier: "major" },
  { cityKey: "San Diego, CA, US", city: "San Diego", region: "CA", country: "US", icao: "KSAN", lat: 32.7338, lon: -117.1933, tier: "large" },
  { cityKey: "Seattle, WA, US", city: "Seattle", region: "WA", country: "US", icao: "KSEA", lat: 47.4502, lon: -122.3088, tier: "major" },
  { cityKey: "Chicago, IL, US", city: "Chicago", region: "IL", country: "US", icao: "KMDW", lat: 41.7868, lon: -87.7522, tier: "major" },
  { cityKey: "Miami, FL, US", city: "Miami", region: "FL", country: "US", icao: "KMIA", lat: 25.7959, lon: -80.2870, tier: "major" },
  { cityKey: "Fort Lauderdale, FL, US", city: "Fort Lauderdale", region: "FL", country: "US", icao: "KFLL", lat: 26.0726, lon: -80.1527, tier: "large" },
  { cityKey: "Orlando, FL, US", city: "Orlando", region: "FL", country: "US", icao: "KMCO", lat: 28.4312, lon: -81.3081, tier: "large" },
  { cityKey: "Atlanta, GA, US", city: "Atlanta", region: "GA", country: "US", icao: "KATL", lat: 33.6407, lon: -84.4277, tier: "major" },
  { cityKey: "Washington, DC, US", city: "Washington", region: "DC", country: "US", icao: "KDCA", lat: 38.8512, lon: -77.0402, tier: "major" },
  { cityKey: "Boston, MA, US", city: "Boston", region: "MA", country: "US", icao: "KBOS", lat: 42.3656, lon: -71.0096, tier: "major" },
  { cityKey: "Denver, CO, US", city: "Denver", region: "CO", country: "US", icao: "KDEN", lat: 39.8561, lon: -104.6737, tier: "major" },
  { cityKey: "Phoenix, AZ, US", city: "Phoenix", region: "AZ", country: "US", icao: "KPHX", lat: 33.4342, lon: -112.0116, tier: "major" },
  { cityKey: "Las Vegas, NV, US", city: "Las Vegas", region: "NV", country: "US", icao: "KLAS", lat: 36.0840, lon: -115.1537, tier: "major" },
  { cityKey: "Nashville, TN, US", city: "Nashville", region: "TN", country: "US", icao: "KBNA", lat: 36.1245, lon: -86.6782, tier: "large" },
  { cityKey: "Charlotte, NC, US", city: "Charlotte", region: "NC", country: "US", icao: "KCLT", lat: 35.2140, lon: -80.9431, tier: "large" },
  { cityKey: "Minneapolis, MN, US", city: "Minneapolis", region: "MN", country: "US", icao: "KMSP", lat: 44.8848, lon: -93.2223, tier: "major" },
  { cityKey: "Detroit, MI, US", city: "Detroit", region: "MI", country: "US", icao: "KDTW", lat: 42.2162, lon: -83.3554, tier: "large" },
  { cityKey: "New Orleans, LA, US", city: "New Orleans", region: "LA", country: "US", icao: "KMSY", lat: 29.9934, lon: -90.2580, tier: "large" },
  { cityKey: "Salt Lake City, UT, US", city: "Salt Lake City", region: "UT", country: "US", icao: "KSLC", lat: 40.7899, lon: -111.9791, tier: "large" },
  { cityKey: "Portland, OR, US", city: "Portland", region: "OR", country: "US", icao: "KPDX", lat: 45.5898, lon: -122.5951, tier: "large" },
  { cityKey: "Philadelphia, PA, US", city: "Philadelphia", region: "PA", country: "US", icao: "KPHL", lat: 39.8744, lon: -75.2424, tier: "large" },

  // --- Mexico major cities / resorts ---
  { cityKey: "Mexico City, MX, MX", city: "Mexico City", region: "MX", country: "MX", icao: "MMMX", lat: 19.4361, lon: -99.0719, tier: "major" },
  { cityKey: "Guadalajara, JA, MX", city: "Guadalajara", region: "JA", country: "MX", icao: "MMGL", lat: 20.5218, lon: -103.3112, tier: "large" },
  { cityKey: "Monterrey, NL, MX", city: "Monterrey", region: "NL", country: "MX", icao: "MMMY", lat: 25.7785, lon: -100.1070, tier: "large" },
  { cityKey: "Cancún, QR, MX", city: "Cancún", region: "QR", country: "MX", icao: "MMUN", lat: 21.0365, lon: -86.8771, tier: "major" },
  { cityKey: "Puerto Vallarta, JA, MX", city: "Puerto Vallarta", region: "JA", country: "MX", icao: "MMPR", lat: 20.6801, lon: -105.2542, tier: "large" },
  { cityKey: "Los Cabos, BS, MX", city: "Los Cabos", region: "BS", country: "MX", icao: "MMSD", lat: 23.1518, lon: -109.7210, tier: "major" },
  { cityKey: "Tijuana, BC, MX", city: "Tijuana", region: "BC", country: "MX", icao: "MMTJ", lat: 32.5411, lon: -116.9700, tier: "large" },
];

/* ------------------------------ Utilities ------------------------------ */

function findCity(cityKey) {
  return CITIES.find(c => c.cityKey === cityKey);
}

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

function isWeekend(dateISO) {
  const d = new Date(dateISO);
  const day = d.getUTCDay(); // 0 Sun ... 6 Sat
  return day === 0 || day === 5 || day === 6;
}

function dayDiffUTC(depISO, retISO) {
  const dep = new Date(depISO);
  const ret = new Date(retISO);
  const depDay = Date.UTC(dep.getUTCFullYear(), dep.getUTCMonth(), dep.getUTCDate());
  const retDay = Date.UTC(ret.getUTCFullYear(), ret.getUTCMonth(), ret.getUTCDate());
  return Math.round((retDay - depDay) / (24 * 3600 * 1000));
}

/* -------------------------- Business Logic ----------------------------- */

function regionOfTrip(fromCity, toCity) {
  // If either endpoint is Mexico, treat as Mexico ops for allowance
  if (fromCity.country === "MX" || toCity.country === "MX") return "MEXICO";
  return "US";
}

/**
 * Passenger-based allowed classes:
 * - Prevent light jets for 12 pax, etc.
 */
function allowedClassesForPax(pax) {
  if (pax <= 4) return ["TURBOPROP", "LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"];
  if (pax <= 6) return ["LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"];
  if (pax <= 8) return ["MIDSIZE", "SUPER_MID", "HEAVY_JET"];
  if (pax <= 10) return ["SUPER_MID", "HEAVY_JET"];
  return ["HEAVY_JET"]; // 11–30: force heavy
}

/**
 * If user picks a class that can’t fly the distance, upgrade automatically.
 */
function ensureRangeClass(requestedClass, distanceNm) {
  let idx = AIRCRAFT_CLASSES.indexOf(requestedClass);
  if (idx < 0) idx = 0;

  while (idx < AIRCRAFT_CLASSES.length) {
    const cls = AIRCRAFT_CLASSES[idx];
    if (distanceNm <= MAX_RANGE_NM[cls]) return cls;
    idx += 1;
  }
  return "HEAVY_JET";
}

function estimateLegBlockHours(distanceNm, aircraftClass) {
  const speed = CRUISE_SPEED_KTS[aircraftClass];
  const flightHours = distanceNm / speed;

  // Base buffer: taxi/climb/descent
  let buffer = 0.4;

  // Add a small extra buffer for longer legs
  if (distanceNm > 1200) buffer += 0.2;

  return flightHours + buffer;
}

/**
 * Reposition legs:
 * - If trip starts at KAUS: no pre-repo.
 * - If trip starts elsewhere: add KAUS -> origin repo.
 * - If one-way ending not KAUS: add destination -> KAUS repo.
 * - If round trip and origin not KAUS: still repo both ends (aircraft must get to/from start city).
 *
 * Also add tier friction (major/large/mid).
 */
function estimateRepositionHours(fromCity, toCity, aircraftClass, isRoundTrip) {
  const home = findCity(HOME_BASE_CITY_KEY);
  if (!home) return { hours: 0, legs: [] };

  const legs = [];
  let repoHours = 0;

  const tierFriction = (city) => CITY_TIER_REPOSITION_HOURS[city.tier] ?? 0.6;

  // Pre reposition to start
  if (fromCity.icao !== HOME_BASE_ICAO) {
    const d = haversineNm(home, fromCity);
    const h = estimateLegBlockHours(d, aircraftClass) + tierFriction(fromCity);
    legs.push({ from: home.cityKey, to: fromCity.cityKey, distance_nm: Math.round(d), hours: roundUpTo(h * 10, 1) / 10 });
    repoHours += h;
  }

  // Post reposition home (end state depends on trip type)
  // - One-way: ends at destination -> reposition dest -> home
  // - Round-trip: ends back at origin city, so reposition origin -> home if origin isn't home
  const endCity = isRoundTrip ? fromCity : toCity;
  if (endCity.icao !== HOME_BASE_ICAO) {
    const d = haversineNm(endCity, home);
    const h = estimateLegBlockHours(d, aircraftClass) + tierFriction(endCity);
    legs.push({ from: endCity.cityKey, to: home.cityKey, distance_nm: Math.round(d), hours: roundUpTo(h * 10, 1) / 10 });
    repoHours += h;
  }

  return { hours: repoHours, legs };
}

function computeRiskScore({ departDateISO, tripRegion, pax, distanceNm, isRoundTrip }) {
  let risk = 0;
  if (isWeekend(departDateISO)) risk += 1;
  if (tripRegion === "MEXICO") risk += 1;
  if (distanceNm > 1200) risk += 1;
  if (pax >= 10) risk += 1;
  if (isRoundTrip) risk += 1;
  return risk;
}

function riskToMultiplier(risk) {
  if (risk <= 0) return VOLATILITY[0];
  if (risk === 1) return VOLATILITY[1];
  if (risk === 2) return VOLATILITY[2];
  if (risk === 3) return VOLATILITY[3];
  return VOLATILITY["4+"];
}

/**
 * Optional “standby” cost for multi-day round trips (aircraft waits).
 * You requested “rather than substantial overnight fees/daily mins”.
 * We keep this modest and transparent:
 * - If return date > depart date: add 0.8–1.2 billable hours per “wait day”
 * This can be tuned later.
 */
function estimateStandbyHours(depISO, retISO) {
  if (!retISO) return { low: 0, high: 0, days: 0 };
  const diff = dayDiffUTC(depISO, retISO);
  if (diff <= 0) return { low: 0, high: 0, days: 0 };
  const days = diff; // e.g., depart 1/10 return 1/13 => 3 wait days
  return { low: days * 0.8, high: days * 1.2, days };
}

/* ------------------------------ API Types ------------------------------ */

const EstimateRequestSchema = z.object({
  fromCityKey: z.string().min(3),
  toCityKey: z.string().min(3),
  departDateISO: z.string().min(8), // YYYY-MM-DD from <input type="date">
  isRoundTrip: z.boolean(),
  returnDateISO: z.string().nullable().optional(),
  pax: z.number().int().min(1).max(30),
  preferredClass: z
    .enum(["AUTO", "TURBOPROP", "LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"])
    .default("AUTO"),
});

/* -------------------------------- Routes -------------------------------- */

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/cities", (_req, res) => {
  // send display-friendly items
  const list = CITIES.map(c => ({
    cityKey: c.cityKey,
    label: `${c.city}${c.region ? ", " + c.region : ""} (${c.country})`,
    country: c.country,
    icao: c.icao,
  }));
  res.json({
    homeBaseCityKey: HOME_BASE_CITY_KEY,
    homeBaseIcao: HOME_BASE_ICAO,
    cities: list,
  });
});

app.post("/estimate", (req, res) => {
  const parsed = EstimateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const input = parsed.data;
  const fromCity = findCity(input.fromCityKey);
  const toCity = findCity(input.toCityKey);
  if (!fromCity || !toCity) {
    return res.status(400).json({ error: "Unknown city selection. Please choose from the dropdown list." });
  }

  const pax = clampInt(input.pax, 1, 30);

  // Main trip distance (one-way)
  const tripDistanceNm = haversineNm(fromCity, toCity);

  // Determine allowed classes by pax
  const allowed = allowedClassesForPax(pax);

  // Determine requested class
  let chosen = input.preferredClass === "AUTO"
    ? allowed[0] // start at smallest allowed for pax
    : input.preferredClass;

  // If user chose an invalid class for pax, fail fast (UX is filtering too, but be safe)
  if (!allowed.includes(chosen)) {
    return res.status(400).json({
      error: "Selected aircraft class is not valid for the passenger count.",
      details: { allowedClasses: allowed },
    });
  }

  // Ensure range capability by upgrading class if needed
  const classAfterRange = ensureRangeClass(chosen, tripDistanceNm);
  if (!allowed.includes(classAfterRange)) {
    // If range forces an upgrade beyond pax-allowed list, go to the smallest pax-allowed that can do range
    const upgraded = allowed.find(cls => tripDistanceNm <= MAX_RANGE_NM[cls]) || "HEAVY_JET";
    chosen = upgraded;
  } else {
    chosen = classAfterRange;
  }

  const tripRegion = regionOfTrip(fromCity, toCity);

  // Legs: trip itself
  const tripLegs = input.isRoundTrip ? 2 : 1;
  const legBlock = estimateLegBlockHours(tripDistanceNm, chosen);
  const tripHours = legBlock * tripLegs;

  // Reposition hours/legs (KAUS-based)
  const repo = estimateRepositionHours(fromCity, toCity, chosen, input.isRoundTrip);

  // Standby hours for multi-day round trips (modest, not big daily minimums)
  const standby = input.isRoundTrip ? estimateStandbyHours(input.departDateISO, input.returnDateISO) : { low: 0, high: 0, days: 0 };

  // Fees (per landing)
  const stops = input.isRoundTrip ? 2 : 1;
  const feeBand = tripRegion === "MEXICO" ? REGION_FEE_PER_STOP.MEXICO : REGION_FEE_PER_STOP.US;
  const fees = { low: stops * feeBand.low, high: stops * feeBand.high };

  // Base charter
  const rate = RATE_TABLE[chosen];
  const billableHoursLow = tripHours + repo.hours + standby.low;
  const billableHoursHigh = tripHours + repo.hours + standby.high;

  const base = {
    low: billableHoursLow * rate.low,
    high: billableHoursHigh * rate.high,
  };

  const subtotal = {
    low: base.low + fees.low,
    high: base.high + fees.high,
  };

  const risk = computeRiskScore({
    departDateISO: input.departDateISO,
    tripRegion,
    pax,
    distanceNm: tripDistanceNm,
    isRoundTrip: input.isRoundTrip,
  });

  const mult = riskToMultiplier(risk);
  const estimateLow = roundDownTo(subtotal.low * (1 - mult), 1000);
  const estimateHigh = roundUpTo(subtotal.high * (1 + mult), 1000);

  return res.json({
    currency: "USD",
    home_base: { cityKey: HOME_BASE_CITY_KEY, icao: HOME_BASE_ICAO },
    input: { ...input, pax, resolvedClass: chosen },
    allowed_classes: allowed,
    trip: {
      from: fromCity.cityKey,
      to: toCity.cityKey,
      region: tripRegion,
      distance_nm_one_way: Math.round(tripDistanceNm),
      round_trip: input.isRoundTrip,
      legs: tripLegs,
    },
    estimate_low: Math.max(0, estimateLow),
    estimate_high: Math.max(estimateLow + 1000, estimateHigh),
    confidence: tripRegion === "MEXICO" ? "MEDIUM" : "HIGH",
    breakdown: {
      aircraft_class: chosen,
      hourly_rate_band: rate,
      trip_hours_est: Math.round(tripHours * 10) / 10,
      reposition_hours_est: Math.round(repo.hours * 10) / 10,
      reposition_legs: repo.legs,
      standby_days: standby.days,
      standby_hours_est: { low: Math.round(standby.low * 10) / 10, high: Math.round(standby.high * 10) / 10 },
      fees,
      subtotal,
      volatility_multiplier: mult,
      assumptions: [
        "Estimate only (not a quote).",
        `Home base assumed: Austin (KAUS). Reposition legs included when trip starts/ends away from KAUS.`,
        "Airport/handling/government costs are estimated via regional allowance.",
        "Standby (multi-day round trips) is modeled modestly as aircraft hold time (not hotel/crew per diems).",
      ],
      may_change: [
        "Aircraft availability and actual reposition routing",
        "Airport handling/parking fees (especially Mexico)",
        "Weather and ATC routing",
      ],
    },
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(PORT, () => console.log(`Charter Calculator API (v2) running on port ${PORT}`));
