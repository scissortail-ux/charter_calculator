import express from "express";
import cors from "cors";
import { z } from "zod";

/**
 * Charter Calculator API (v4)
 * - City list (alphabetical)
 * - City resolution: cityKey OR ICAO (robust)
 * - Home base: Austin (KAUS)
 * - Trip types: one-way, round-trip
 * - Aircraft classes + pax-based filtering
 * - Pricing model:
 *    - Trip hours + reposition (home repo when origin/end away from KAUS)
 *    - Expected market positioning in/out of Austin even when origin = KAUS (Avinode Pos reality)
 *    - Fees per stop + modest parking per wait day (no standby billing)
 *    - Volatility widens HIGH end only (does not discount low end)
 *    - Brokerage margin always
 *    - FET conditional: only if both endpoints are US and both are >200nm from a US border
 */

const app = express();
app.use(cors());
app.use(express.json());

/* ------------------------------ Config ------------------------------ */

const HOME_BASE_CITY_KEY = "Austin, TX, US";
const HOME_BASE_ICAO = "KAUS";

// Broker margin (always applied). Override with Render env var if you want.
const BROKER_MARGIN_PCT = Number(process.env.BROKER_MARGIN_PCT ?? "0.12"); // 12%

// US Federal Excise Tax rate
const FET_PCT = 0.075;

// Border threshold (nautical miles). 200nm ≈ 230 statute miles.
const FET_BORDER_THRESHOLD_NM = 200;

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
 * Wholesale-ish hourly bands (tuned toward Avinode wholesale behavior).
 * You’ll calibrate these over time with more Avinode samples.
 */
const RATE_TABLE = {
  TURBOPROP: { low: 2100, high: 3000 },
  LIGHT_JET: { low: 3200, high: 4300 },
  MIDSIZE: { low: 5200, high: 7200 },
  SUPER_MID: { low: 7200, high: 9800 },
  HEAVY_JET: { low: 9800, high: 15500 },
};

/**
 * Fees: broad per-stop allowances (landing/handling, etc.)
 */
const REGION_FEE_PER_STOP = {
  US: { low: 600, high: 1200 },
  MEXICO: { low: 1200, high: 2800 },
};

/**
 * Parking/handling per wait day on round trips (instead of standby flight hour billing)
 */
const PARKING_PER_DAY = {
  US: { low: 150, high: 450 },
  MEXICO: { low: 250, high: 650 },
};

/**
 * Tier friction (repo inefficiency)
 */
const CITY_TIER_REPO_HOURS = {
  major: 0.35,
  large: 0.55,
  mid: 0.75,
};

/**
 * Expected “market positioning” in/out of Austin even when origin = KAUS.
 * This captures Avinode “Pos.” time reality.
 */
const EXPECTED_POS_IN_HOURS = {
  TURBOPROP: 0.9,
  LIGHT_JET: 1.2,
  MIDSIZE: 1.1,
  SUPER_MID: 1.0,
  HEAVY_JET: 0.9,
};
const EXPECTED_POS_OUT_MULT = 0.5;

/**
 * Volatility widens high end only.
 */
const VOLATILITY = {
  0: 0.10,
  1: 0.15,
  2: 0.20,
  3: 0.25,
  "4+": 0.35,
};

/* ------------------------------ Cities ------------------------------ */
/**
 * City keys are what the UI sends; ICAO is the stable fallback identifier.
 * Add cities by appending entries here.
 */
const CITIES = [
  // --- Texas majors (home base + major metros) ---
  { cityKey: "Austin, TX, US", city: "Austin", region: "TX", country: "US", icao: "KAUS", lat: 30.2025, lon: -97.6664, tier: "major" },
  { cityKey: "Dallas, TX, US", city: "Dallas", region: "TX", country: "US", icao: "KDAL", lat: 32.8471, lon: -96.8517, tier: "major" },
  { cityKey: "Houston, TX, US", city: "Houston", region: "TX", country: "US", icao: "KHOU", lat: 29.6454, lon: -95.2789, tier: "major" },
  { cityKey: "San Antonio, TX, US", city: "San Antonio", region: "TX", country: "US", icao: "KSAT", lat: 29.5337, lon: -98.4698, tier: "major" },

  // --- Texas standalone / non-major metro markets ---
  { cityKey: "Abilene, TX, US", city: "Abilene", region: "TX", country: "US", icao: "KABI", lat: 32.4113, lon: -99.6819, tier: "mid" },
  { cityKey: "Amarillo, TX, US", city: "Amarillo", region: "TX", country: "US", icao: "KAMA", lat: 35.2194, lon: -101.7060, tier: "mid" },
  { cityKey: "Brownsville, TX, US", city: "Brownsville", region: "TX", country: "US", icao: "KBRO", lat: 25.9068, lon: -97.4259, tier: "mid" },
  { cityKey: "Corpus Christi, TX, US", city: "Corpus Christi", region: "TX", country: "US", icao: "KCRP", lat: 27.7704, lon: -97.5012, tier: "large" },
  { cityKey: "Laredo, TX, US", city: "Laredo", region: "TX", country: "US", icao: "KLRD", lat: 27.5438, lon: -99.4616, tier: "mid" },
  { cityKey: "Lubbock, TX, US", city: "Lubbock", region: "TX", country: "US", icao: "KLBB", lat: 33.6636, lon: -101.8228, tier: "mid" },
  { cityKey: "Midland / Odessa, TX, US", city: "Midland / Odessa", region: "TX", country: "US", icao: "KMAF", lat: 31.9425, lon: -102.2019, tier: "large" },
  { cityKey: "Tyler, TX, US", city: "Tyler", region: "TX", country: "US", icao: "KTYR", lat: 32.3541, lon: -95.4024, tier: "mid" },

  // --- Major US ---
  { cityKey: "Atlanta, GA, US", city: "Atlanta", region: "GA", country: "US", icao: "KATL", lat: 33.6407, lon: -84.4277, tier: "major" },
  { cityKey: "Boston, MA, US", city: "Boston", region: "MA", country: "US", icao: "KBOS", lat: 42.3656, lon: -71.0096, tier: "major" },
  { cityKey: "Chicago, IL, US", city: "Chicago", region: "IL", country: "US", icao: "KMDW", lat: 41.7868, lon: -87.7522, tier: "major" },
  { cityKey: "Denver, CO, US", city: "Denver", region: "CO", country: "US", icao: "KDEN", lat: 39.8561, lon: -104.6737, tier: "major" },
  { cityKey: "Detroit (City), MI, US", city: "Detroit (City)", region: "MI", country: "US", icao: "KDET", lat: 42.4092, lon: -83.0099, tier: "large" },
  { cityKey: "Los Angeles, CA, US", city: "Los Angeles", region: "CA", country: "US", icao: "KLAX", lat: 33.9416, lon: -118.4085, tier: "major" },
  { cityKey: "Miami, FL, US", city: "Miami", region: "FL", country: "US", icao: "KMIA", lat: 25.7959, lon: -80.2870, tier: "major" },
  { cityKey: "New York, NY, US", city: "New York", region: "NY", country: "US", icao: "KTEB", lat: 40.8501, lon: -74.0608, tier: "major" },
  { cityKey: "Phoenix, AZ, US", city: "Phoenix", region: "AZ", country: "US", icao: "KPHX", lat: 33.4342, lon: -112.0116, tier: "major" },
  { cityKey: "San Francisco, CA, US", city: "San Francisco", region: "CA", country: "US", icao: "KSFO", lat: 37.6213, lon: -122.3790, tier: "major" },
  { cityKey: "Seattle, WA, US", city: "Seattle", region: "WA", country: "US", icao: "KSEA", lat: 47.4502, lon: -122.3088, tier: "major" },

  // --- Mexico ---
  { cityKey: "Cancún, QR, MX", city: "Cancún", region: "QR", country: "MX", icao: "MMUN", lat: 21.0365, lon: -86.8771, tier: "major" },
  { cityKey: "Cabo / Los Cabos, BS, MX", city: "Cabo / Los Cabos", region: "BS", country: "MX", icao: "MMSD", lat: 23.1518, lon: -109.7210, tier: "major" },
  { cityKey: "Mexico City, MX, MX", city: "Mexico City", region: "MX", country: "MX", icao: "MMMX", lat: 19.4361, lon: -99.0719, tier: "major" },
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

  const distanceKm = R_km * c;
  return distanceKm * 0.539957; // km -> nm
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
function tripRegion(fromCity, toCity) {
  return (fromCity.country === "MX" || toCity.country === "MX") ? "MEXICO" : "US";
}

/* ------------------------------ FET Logic ------------------------------ */

// Rough proxy points on US borders (good enough for conditional FET gating)
const US_BORDER_PROXY_POINTS = [
  { lat: 25.9, lon: -97.5 },   // TX/MX (south TX)
  { lat: 32.5, lon: -117.1 },  // CA/MX (San Diego/Tijuana)
  { lat: 49.0, lon: -123.0 },  // WA/Canada
  { lat: 49.0, lon: -95.0 },   // ND/Canada
  { lat: 45.0, lon: -73.5 },   // NY/Canada
];

function distanceToUsBorderNm(city) {
  return Math.min(...US_BORDER_PROXY_POINTS.map(p => haversineNm(city, { lat: p.lat, lon: p.lon })));
}

function shouldApplyFET(fromCity, toCity) {
  // No US FET for international
  if (fromCity.country !== "US" || toCity.country !== "US") return false;

  const dFrom = distanceToUsBorderNm(fromCity);
  const dTo = distanceToUsBorderNm(toCity);

  // FET only when both are farther than threshold from border
  return dFrom > FET_BORDER_THRESHOLD_NM && dTo > FET_BORDER_THRESHOLD_NM;
}

/* ------------------------------ Business Logic ------------------------------ */

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

  let buffer = 0.42;
  if (distanceNm > 1200) buffer += 0.18;
  return flightHours + buffer;
}

function tierFrictionHours(city) {
  return CITY_TIER_REPO_HOURS[city.tier] ?? 0.6;
}

/**
 * Home-base repo: only when origin/end is not KAUS
 */
function estimateHomeBaseReposition(fromCity, toCity, aircraftClass, isRoundTrip) {
  const home = findCityByKey(HOME_BASE_CITY_KEY);
  if (!home) return { hours: 0, legs: [] };

  const legs = [];
  let hours = 0;

  if (fromCity.icao !== HOME_BASE_ICAO) {
    const d = haversineNm(home, fromCity);
    const h = estimateLegBlockHours(d, aircraftClass) + tierFrictionHours(fromCity);
    legs.push({ type: "HOME_REPO", from: home.cityKey, to: fromCity.cityKey, distance_nm: Math.round(d), hours: Math.round(h * 10) / 10 });
    hours += h;
  }

  const endCity = isRoundTrip ? fromCity : toCity;
  if (endCity.icao !== HOME_BASE_ICAO) {
    const d = haversineNm(endCity, home);
    const h = estimateLegBlockHours(d, aircraftClass) + tierFrictionHours(endCity);
    legs.push({ type: "HOME_REPO", from: endCity.cityKey, to: home.cityKey, distance_nm: Math.round(d), hours: Math.round(h * 10) / 10 });
    hours += h;
  }

  return { hours, legs };
}

/**
 * Market positioning: even if origin/end is KAUS, sourced aircraft often repositions in/out.
 */
function estimateExpectedMarketPositioningHours(fromCity, toCity, aircraftClass, isRoundTrip) {
  const legs = [];
  let hours = 0;

  const baseIn = EXPECTED_POS_IN_HOURS[aircraftClass] ?? 1.0;

  const tierScale = (city) => {
    if (city.tier === "major") return 1.0;
    if (city.tier === "large") return 1.15;
    return 1.3;
  };

  if (fromCity.icao === HOME_BASE_ICAO) {
    const hIn = baseIn * tierScale(fromCity);
    legs.push({ type: "MARKET_POS_IN", note: "Expected aircraft positioning into Austin market", hours: Math.round(hIn * 10) / 10 });
    hours += hIn;
  }

  const endsAt = isRoundTrip ? fromCity : toCity;
  if (endsAt.icao === HOME_BASE_ICAO) {
    const hOut = baseIn * EXPECTED_POS_OUT_MULT * tierScale(endsAt);
    legs.push({ type: "MARKET_POS_OUT", note: "Expected aircraft positioning out of Austin market", hours: Math.round(hOut * 10) / 10 });
    hours += hOut;
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

  const allowed = allowedClassesForPax(pax);

  let chosen = input.preferredClass === "AUTO" ? allowed[0] : input.preferredClass;

  if (!allowed.includes(chosen)) {
    return res.status(400).json({
      error: "Selected class not allowed for passenger count.",
      details: { allowedClasses: allowed },
    });
  }

  chosen = ensureRangeClass(chosen, oneWayDistanceNm);
  if (!allowed.includes(chosen)) {
    chosen = allowed.find((cls) => oneWayDistanceNm <= MAX_RANGE_NM[cls]) || "HEAVY_JET";
  }

  const tripLegs = input.isRoundTrip ? 2 : 1;
  const tripLegHours = estimateLegBlockHours(oneWayDistanceNm, chosen);
  const tripHours = tripLegHours * tripLegs;

  let waitDays = 0;
  if (input.isRoundTrip && input.returnDateISO) {
    waitDays = Math.max(0, dayDiffUTC(input.departDateISO, input.returnDateISO));
  }

  const homeRepo = estimateHomeBaseReposition(fromCity, toCity, chosen, input.isRoundTrip);
  const marketPos = estimateExpectedMarketPositioningHours(fromCity, toCity, chosen, input.isRoundTrip);
  const repoHours = homeRepo.hours + marketPos.hours;

  const stops = input.isRoundTrip ? 2 : 1;
  const feeBand = region === "MEXICO" ? REGION_FEE_PER_STOP.MEXICO : REGION_FEE_PER_STOP.US;
  const fees = { low: stops * feeBand.low, high: stops * feeBand.high };

  const parkBand = region === "MEXICO" ? PARKING_PER_DAY.MEXICO : PARKING_PER_DAY.US;
  const parking = { low: waitDays * parkBand.low, high: waitDays * parkBand.high };

  const rate = RATE_TABLE[chosen];
  const billableHours = tripHours + repoHours;

  const base = {
    low: billableHours * rate.low,
    high: billableHours * rate.high,
  };

  const subtotal = {
    low: base.low + fees.low + parking.low,
    high: base.high + fees.high + parking.high,
  };

  const risk = computeRiskScore({
    departDateISO: input.departDateISO,
    region,
    pax,
    oneWayDistanceNm,
    isRoundTrip: input.isRoundTrip,
    waitDays,
  });

  const vol = riskToMultiplier(risk);

  // Volatility widens high end only (no “discount” on low)
  let estimateLow = roundDownTo(subtotal.low, 1000);
  let estimateHigh = roundUpTo(subtotal.high * (1 + vol), 1000);

  // Broker margin always
  const margin = Math.max(0, Math.min(0.50, BROKER_MARGIN_PCT));
  estimateLow = roundDownTo(estimateLow * (1 + margin), 1000);
  estimateHigh = roundUpTo(estimateHigh * (1 + margin), 1000);

  // Conditional FET
  const fetApplies = shouldApplyFET(fromCity, toCity);
  if (fetApplies) {
    estimateLow = roundDownTo(estimateLow * (1 + FET_PCT), 1000);
    estimateHigh = roundUpTo(estimateHigh * (1 + FET_PCT), 1000);
  }

  return res.json({
    currency: "USD",
    home_base: { cityKey: HOME_BASE_CITY_KEY, icao: HOME_BASE_ICAO },
    estimate_low: Math.max(0, estimateLow),
    estimate_high: Math.max(estimateLow + 1000, estimateHigh),
    confidence: region === "MEXICO" ? "MEDIUM" : "HIGH",
    breakdown: {
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
      reposition_hours_est: Math.round(repoHours * 10) / 10,
      reposition_detail: {
        home_repo_legs: homeRepo.legs,
        market_positioning: marketPos.legs,
      },
      wait_days: waitDays,
      fees,
      parking,
      hourly_rate_band: rate,
      subtotal,
      volatility_multiplier: vol,
      inclusions: {
        broker_margin_pct: margin,
        fet_applied: fetApplies,
      },
      assumptions: [
        "Estimate only (not a quote).",
        "Pricing includes expected aircraft positioning (market) in/out of Austin, plus home-base reposition when trip starts/ends away from KAUS.",
        "Multi-day round-trips use modest parking/handling allowances (not standby flight-hour billing).",
        "Market pricing varies by availability, operator, and routing.",
      ],
    },
  });
});

/* ------------------------------ Boot ------------------------------ */

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(PORT, () => console.log(`Charter Calculator API (v4) running on port ${PORT}`));
