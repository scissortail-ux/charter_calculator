import express from "express";
import cors from "cors";
import { z } from "zod";

/**
 * Charter Calculator API (v3.1)
 * - City dropdown list alphabetical
 * - Robust city resolution: accepts cityKey OR ICAO (prevents "Unknown city" due to label mismatch)
 * - Home base: Austin (KAUS) with reposition legs
 * - Round trip supported
 * - No standby/daily minimum billing; modest parking per wait day + volatility
 * - +20% markup (margin + FET) via MARKUP_PCT env var (defaults to 0.20)
 */

const app = express();
app.use(cors());
app.use(express.json());

/* ------------------------------ Config ------------------------------ */

const HOME_BASE_CITY_KEY = "Austin, TX, US";
const HOME_BASE_ICAO = "KAUS";

// 20% markup by default (margin + FET). Override in Render env vars.
const DEFAULT_MARKUP_PCT = Number(process.env.MARKUP_PCT ?? "0.20"); // 20% default

/* ------------------------------ Aircraft ------------------------------ */

const AIRCRAFT_CLASSES = ["TURBOPROP", "LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"];

const CLASS_LABELS = {
  TURBOPROP: "Turboprop",
  LIGHT_JET: "Light Jet",
  MIDSIZE: "Midsize Jet",
  SUPER_MID: "Super-Mid Jet",
  HEAVY_JET: "Heavy Jet",
};

const CRUISE_SPEED_KTS = {
  TURBOPROP: 280,
  LIGHT_JET: 420,
  MIDSIZE: 450,
  SUPER_MID: 470,
  HEAVY_JET: 500,
};

const MAX_RANGE_NM = {
  TURBOPROP: 900,
  LIGHT_JET: 1500,
  MIDSIZE: 2000,
  SUPER_MID: 2800,
  HEAVY_JET: 6000,
};

/**
 * Wholesale-ish hourly bands (tuned toward Avinode wholesale ranges).
 * You can calibrate over time with more sample routes.
 */
const RATE_TABLE = {
  TURBOPROP: { low: 2100, high: 3000 },
  LIGHT_JET: { low: 3200, high: 4300 },
  MIDSIZE: { low: 5200, high: 7200 },
  SUPER_MID: { low: 7200, high: 9800 },
  HEAVY_JET: { low: 9800, high: 15500 },
};

const REGION_FEE_PER_STOP = {
  US: { low: 600, high: 1200 },
  MEXICO: { low: 1200, high: 2800 },
};

const PARKING_PER_DAY = {
  US: { low: 150, high: 450 },
  MEXICO: { low: 250, high: 650 },
};

const CITY_TIER_REPO_HOURS = {
  major: 0.35,
  large: 0.55,
  mid: 0.75,
};

const VOLATILITY = {
  0: 0.10,
  1: 0.15,
  2: 0.20,
  3: 0.25,
  "4+": 0.35,
};

/* ------------------------------ Cities ------------------------------ */

const CITIES = [
  // --- Home base + Texas anchors ---
  { cityKey: "Austin, TX, US", city: "Austin", region: "TX", country: "US", icao: "KAUS", lat: 30.2025, lon: -97.6664, tier: "major" },
  { cityKey: "Dallas, TX, US", city: "Dallas", region: "TX", country: "US", icao: "KDAL", lat: 32.8471, lon: -96.8517, tier: "major" },
  { cityKey: "Houston, TX, US", city: "Houston", region: "TX", country: "US", icao: "KHOU", lat: 29.6454, lon: -95.2789, tier: "major" },
  { cityKey: "San Antonio, TX, US", city: "San Antonio", region: "TX", country: "US", icao: "KSAT", lat: 29.5337, lon: -98.4698, tier: "large" },

  // --- Major US ---
  { cityKey: "Atlanta, GA, US", city: "Atlanta", region: "GA", country: "US", icao: "KATL", lat: 33.6407, lon: -84.4277, tier: "major" },
  { cityKey: "Boston, MA, US", city: "Boston", region: "MA", country: "US", icao: "KBOS", lat: 42.3656, lon: -71.0096, tier: "major" },
  { cityKey: "Charlotte, NC, US", city: "Charlotte", region: "NC", country: "US", icao: "KCLT", lat: 35.2140, lon: -80.9431, tier: "large" },
  { cityKey: "Chicago, IL, US", city: "Chicago", region: "IL", country: "US", icao: "KMDW", lat: 41.7868, lon: -87.7522, tier: "major" },
  { cityKey: "Denver, CO, US", city: "Denver", region: "CO", country: "US", icao: "KDEN", lat: 39.8561, lon: -104.6737, tier: "major" },
  { cityKey: "Detroit (City), MI, US", city: "Detroit (City)", region: "MI", country: "US", icao: "KDET", lat: 42.4092, lon: -83.0099, tier: "large" },
  { cityKey: "Fort Lauderdale, FL, US", city: "Fort Lauderdale", region: "FL", country: "US", icao: "KFLL", lat: 26.0726, lon: -80.1527, tier: "large" },
  { cityKey: "Las Vegas, NV, US", city: "Las Vegas", region: "NV", country: "US", icao: "KLAS", lat: 36.0840, lon: -115.1537, tier: "major" },
  { cityKey: "Los Angeles, CA, US", city: "Los Angeles", region: "CA", country: "US", icao: "KLAX", lat: 33.9416, lon: -118.4085, tier: "major" },
  { cityKey: "Miami, FL, US", city: "Miami", region: "FL", country: "US", icao: "KMIA", lat: 25.7959, lon: -80.2870, tier: "major" },
  { cityKey: "Minneapolis, MN, US", city: "Minneapolis", region: "MN", country: "US", icao: "KMSP", lat: 44.8848, lon: -93.2223, tier: "major" },
  { cityKey: "Nashville, TN, US", city: "Nashville", region: "TN", country: "US", icao: "KBNA", lat: 36.1245, lon: -86.6782, tier: "large" },
  { cityKey: "New Orleans, LA, US", city: "New Orleans", region: "LA", country: "US", icao: "KMSY", lat: 29.9934, lon: -90.2580, tier: "large" },
  { cityKey: "New York, NY, US", city: "New York", region: "NY", country: "US", icao: "KTEB", lat: 40.8501, lon: -74.0608, tier: "major" },
  { cityKey: "Orlando, FL, US", city: "Orlando", region: "FL", country: "US", icao: "KMCO", lat: 28.4312, lon: -81.3081, tier: "large" },
  { cityKey: "Philadelphia, PA, US", city: "Philadelphia", region: "PA", country: "US", icao: "KPHL", lat: 39.8744, lon: -75.2424, tier: "large" },
  { cityKey: "Phoenix, AZ, US", city: "Phoenix", region: "AZ", country: "US", icao: "KPHX", lat: 33.4342, lon: -112.0116, tier: "major" },
  { cityKey: "San Diego, CA, US", city: "San Diego", region: "CA", country: "US", icao: "KSAN", lat: 32.7338, lon: -117.1933, tier: "large" },
  { cityKey: "San Francisco, CA, US", city: "San Francisco", region: "CA", country: "US", icao: "KSFO", lat: 37.6213, lon: -122.3790, tier: "major" },
  { cityKey: "Seattle, WA, US", city: "Seattle", region: "WA", country: "US", icao: "KSEA", lat: 47.4502, lon: -122.3088, tier: "major" },
  { cityKey: "Tampa, FL, US", city: "Tampa", region: "FL", country: "US", icao: "KTPA", lat: 27.9755, lon: -82.5332, tier: "large" },
  { cityKey: "Washington, DC, US", city: "Washington", region: "DC", country: "US", icao: "KDCA", lat: 38.8512, lon: -77.0402, tier: "major" },

  // --- Mexico ---
  { cityKey: "Cancún, QR, MX", city: "Cancún", region: "QR", country: "MX", icao: "MMUN", lat: 21.0365, lon: -86.8771, tier: "major" },
  { cityKey: "Guadalajara, JA, MX", city: "Guadalajara", region: "JA", country: "MX", icao: "MMGL", lat: 20.5218, lon: -103.3112, tier: "large" },
  { cityKey: "Los Cabos, BS, MX", city: "Los Cabos", region: "BS", country: "MX", icao: "MMSD", lat: 23.1518, lon: -109.7210, tier: "major" },
  { cityKey: "Mexico City, MX, MX", city: "Mexico City", region: "MX", country: "MX", icao: "MMMX", lat: 19.4361, lon: -99.0719, tier: "major" },
  { cityKey: "Monterrey, NL, MX", city: "Monterrey", region: "NL", country: "MX", icao: "MMMY", lat: 25.7785, lon: -100.1070, tier: "large" },
  { cityKey: "Puerto Vallarta, JA, MX", city: "Puerto Vallarta", region: "JA", country: "MX", icao: "MMPR", lat: 20.6801, lon: -105.2542, tier: "large" },
];

/* ------------------------------ Helpers ------------------------------ */

function findCityByKey(cityKey) {
  return CITIES.find((c) => c.cityKey === cityKey);
}

function findCityByIcao(icao) {
  const code = String(icao || "").trim().toUpperCase();
  return CITIES.find((c) => c.icao === code);
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

  return (R_km * c) * 0.539957;
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
  const day = d.getUTCDay();
  return day === 0 || day === 5 || day === 6;
}

function dayDiffUTC(depISO, retISO) {
  const dep = new Date(depISO);
  const ret = new Date(retISO);
  const depDay = Date.UTC(dep.getUTCFullYear(), dep.getUTCMonth(), dep.getUTCDate());
  const retDay = Date.UTC(ret.getUTCFullYear(), ret.getUTCMonth(), ret.getUTCDate());
  return Math.round((retDay - depDay) / (24 * 3600 * 1000));
}

/* ------------------------------ Business Logic ------------------------------ */

function tripRegion(fromCity, toCity) {
  return (fromCity.country === "MX" || toCity.country === "MX") ? "MEXICO" : "US";
}

function allowedClassesForPax(pax) {
  if (pax <= 4) return ["TURBOPROP", "LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"];
  if (pax <= 6) return ["LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"];
  if (pax <= 8) return ["MIDSIZE", "SUPER_MID", "HEAVY_JET"];
  if (pax <= 10) return ["SUPER_MID", "HEAVY_JET"];
  return ["HEAVY_JET"];
}

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

  // realistic fixed buffer, plus a touch for longer legs
  let buffer = 0.42;
  if (distanceNm > 1200) buffer += 0.18;

  return flightHours + buffer;
}

function tierFrictionHours(city) {
  return CITY_TIER_REPO_HOURS[city.tier] ?? 0.6;
}

function estimateReposition(fromCity, toCity, aircraftClass, isRoundTrip) {
  const home = findCityByKey(HOME_BASE_CITY_KEY);
  if (!home) return { hours: 0, legs: [] };

  const legs = [];
  let hours = 0;

  // Pre-repo to origin
  if (fromCity.icao !== HOME_BASE_ICAO) {
    const d = haversineNm(home, fromCity);
    const h = estimateLegBlockHours(d, aircraftClass) + tierFrictionHours(fromCity);
    legs.push({ from: home.cityKey, to: fromCity.cityKey, fromIcao: home.icao, toIcao: fromCity.icao, distance_nm: Math.round(d), hours: Math.round(h * 10) / 10 });
    hours += h;
  }

  // Post-repo back to home
  const endCity = isRoundTrip ? fromCity : toCity;
  if (endCity.icao !== HOME_BASE_ICAO) {
    const d = haversineNm(endCity, home);
    const h = estimateLegBlockHours(d, aircraftClass) + tierFrictionHours(endCity);
    legs.push({ from: endCity.cityKey, to: home.cityKey, fromIcao: endCity.icao, toIcao: home.icao, distance_nm: Math.round(d), hours: Math.round(h * 10) / 10 });
    hours += h;
  }

  return { hours, legs };
}

function computeRiskScore({ departDateISO, region, pax, oneWayDistanceNm, isRoundTrip, waitDays }) {
  let risk = 0;
  if (isWeekend(departDateISO)) risk += 1;
  if (region === "MEXICO") risk += 1;
  if (oneWayDistanceNm > 1200) risk += 1;
  if (pax >= 10) risk += 1;
  if (isRoundTrip) risk += 1;
  if (waitDays >= 2) risk += 1;
  return risk;
}

function riskToMultiplier(risk) {
  if (risk <= 0) return VOLATILITY[0];
  if (risk === 1) return VOLATILITY[1];
  if (risk === 2) return VOLATILITY[2];
  if (risk === 3) return VOLATILITY[3];
  return VOLATILITY["4+"];
}

/* ------------------------------ API Schema ------------------------------ */

const EstimateRequestSchema = z.object({
  // Prefer cityKey but also accept ICAO fallback so labels can change without breaking.
  fromCityKey: z.string().min(3).optional(),
  toCityKey: z.string().min(3).optional(),
  fromIcao: z.string().min(3).optional(),
  toIcao: z.string().min(3).optional(),

  departDateISO: z.string().min(8),
  isRoundTrip: z.boolean(),
  returnDateISO: z.string().nullable().optional(),
  pax: z.number().int().min(1).max(30),
  preferredClass: z.enum(["AUTO", "TURBOPROP", "LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"]).default("AUTO"),
}).refine(
  (v) => (!!v.fromCityKey && !!v.toCityKey) || (!!v.fromIcao && !!v.toIcao),
  { message: "Provide from/to as cityKey or ICAO." }
);

/* ------------------------------ Routes ------------------------------ */

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/cities", (_req, res) => {
  // ✅ Alphabetical by label
  const cities = CITIES
    .map((c) => ({
      cityKey: c.cityKey,
      icao: c.icao,
      label: `${c.city}${c.region ? ", " + c.region : ""} (${c.country})`,
      country: c.country,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  res.json({
    homeBaseCityKey: HOME_BASE_CITY_KEY,
    homeBaseIcao: HOME_BASE_ICAO,
    cities,
  });
});

app.post("/estimate", (req, res) => {
  const parsed = EstimateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  const input = parsed.data;

  // ✅ Robust resolution: cityKey first, then ICAO
  const fromCity =
    (input.fromCityKey ? findCityByKey(input.fromCityKey) : null) ||
    (input.fromIcao ? findCityByIcao(input.fromIcao) : null);

  const toCity =
    (input.toCityKey ? findCityByKey(input.toCityKey) : null) ||
    (input.toIcao ? findCityByIcao(input.toIcao) : null);

  if (!fromCity || !toCity) {
    return res.status(400).json({ error: "Unknown city. Please choose from the dropdown list." });
  }

  const pax = clampInt(input.pax, 1, 30);
  const oneWayDistanceNm = haversineNm(fromCity, toCity);
  const region = tripRegion(fromCity, toCity);

  // Allowed by pax
  const allowed = allowedClassesForPax(pax);

  // Choose class
  let chosen =
    input.preferredClass === "AUTO"
      ? allowed[0]
      : input.preferredClass;

  if (!allowed.includes(chosen)) {
    return res.status(400).json({
      error: "Selected class not allowed for passenger count.",
      details: { allowedClasses: allowed },
    });
  }

  // Ensure range capability (upgrade class if needed)
  chosen = ensureRangeClass(chosen, oneWayDistanceNm);

  // If upgrade pushes outside pax-allowed, bump to smallest pax-allowed class that can do range
  if (!allowed.includes(chosen)) {
    chosen = allowed.find((cls) => oneWayDistanceNm <= MAX_RANGE_NM[cls]) || "HEAVY_JET";
  }

  // Trip legs/hours
  const tripLegs = input.isRoundTrip ? 2 : 1;
  const tripLegHours = estimateLegBlockHours(oneWayDistanceNm, chosen);
  const tripHours = tripLegHours * tripLegs;

  // Wait days (parking allowance only)
  let waitDays = 0;
  if (input.isRoundTrip && input.returnDateISO) {
    waitDays = Math.max(0, dayDiffUTC(input.departDateISO, input.returnDateISO));
  }

  // Reposition from/to KAUS
  const repo = estimateReposition(fromCity, toCity, chosen, input.isRoundTrip);

  // Fees
  const stops = input.isRoundTrip ? 2 : 1;
  const feeBand = region === "MEXICO" ? REGION_FEE_PER_STOP.MEXICO : REGION_FEE_PER_STOP.US;
  const fees = { low: stops * feeBand.low, high: stops * feeBand.high };

  // Parking (modest)
  const parkBand = region === "MEXICO" ? PARKING_PER_DAY.MEXICO : PARKING_PER_DAY.US;
  const parking = { low: waitDays * parkBand.low, high: waitDays * parkBand.high };

  // Base charter (hours * hourly band)
  const rate = RATE_TABLE[chosen];
  const billableHours = tripHours + repo.hours;

  const base = {
    low: billableHours * rate.low,
    high: billableHours * rate.high,
  };

  const subtotal = {
    low: base.low + fees.low + parking.low,
    high: base.high + fees.high + parking.high,
  };

  // Volatility width
  const risk = computeRiskScore({
    departDateISO: input.departDateISO,
    region,
    pax,
    oneWayDistanceNm,
    isRoundTrip: input.isRoundTrip,
    waitDays,
  });

  const mult = riskToMultiplier(risk);

  let estimateLow = roundDownTo(subtotal.low * (1 - mult), 1000);
  let estimateHigh = roundUpTo(subtotal.high * (1 + mult), 1000);

  // ✅ Apply markup (margin + FET)
  const markup = Math.max(0, Math.min(0.50, DEFAULT_MARKUP_PCT));
  estimateLow = roundDownTo(estimateLow * (1 + markup), 1000);
  estimateHigh = roundUpTo(estimateHigh * (1 + markup), 1000);

  return res.json({
    currency: "USD",
    home_base: { cityKey: HOME_BASE_CITY_KEY, icao: HOME_BASE_ICAO },
    estimate_low: Math.max(0, estimateLow),
    estimate_high: Math.max(estimateLow + 1000, estimateHigh),
    confidence: region === "MEXICO" ? "MEDIUM" : "HIGH",
    breakdown: {
      mode: "CLIENT_ALL_IN",
      markup_pct: markup,
      region,
      from: fromCity.cityKey,
      to: toCity.cityKey,
      from_icao: fromCity.icao,
      to_icao: toCity.icao,
      pax,
      aircraft_class: chosen,
      aircraft_label: CLASS_LABELS[chosen],
      one_way_distance_nm: Math.round(oneWayDistanceNm),
      trip_legs: tripLegs,
      trip_hours_est: Math.round(tripHours * 10) / 10,
      reposition_hours_est: Math.round(repo.hours * 10) / 10,
      reposition_legs: repo.legs,
      wait_days: waitDays,
      fees,
      parking,
      hourly_rate_band: rate,
      subtotal,
      volatility_multiplier: mult,
      assumptions: [
        "Estimate only (not a quote).",
        "Reposition legs are modeled from/to Austin (KAUS) rather than billing large overnight/daily minimums.",
        "Multi-day round-trips use modest parking/handling allowances (not standby flight-hour billing).",
        "Market pricing varies by availability, operator, and routing.",
      ],
      may_change: [
        "Actual reposition routing & availability",
        "Handling/parking fees (especially Mexico)",
        "Weather/ATC routing and time-of-day constraints",
      ],
    },
  });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(PORT, () => console.log(`Charter Calculator API (v3.1) running on port ${PORT}`));
