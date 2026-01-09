(function () {
  const script = document.currentScript;
  const apiBase = script?.getAttribute("data-api");
  if (!apiBase) return;
  const api = apiBase.replace(/\/$/, "");

  const root = document.createElement("div");
  root.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  root.style.border = "1px solid #ddd";
  root.style.borderRadius = "12px";
  root.style.padding = "16px";
  root.style.maxWidth = "720px";
  root.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";

  root.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <strong>Charter Cost Estimator</strong>
      <span style="font-size:12px;color:#666;">Estimate • Not a quote</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        From (City)
        <select id="from" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;"></select>
      </label>

      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        To (City)
        <select id="to" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;"></select>
      </label>

      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        Depart date
        <input id="depart" type="date" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;">
      </label>

      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        Passengers
        <input id="pax" type="number" min="1" max="30" value="4" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;">
      </label>

      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        Aircraft class
        <select id="cls" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;"></select>
      </label>

      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        Trip type
        <select id="tripType" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;">
          <option value="oneway">One-way</option>
          <option value="roundtrip">Round-trip</option>
        </select>
      </label>

      <label id="returnWrap" style="display:none;flex-direction:column;font-size:12px;color:#333;">
        Return date
        <input id="return" type="date" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;">
      </label>
    </div>

    <button id="btn" style="margin-top:12px;width:100%;padding:12px;border:0;border-radius:12px;font-weight:800;cursor:pointer;background:#111;color:#fff;">
      Estimate all-in cost
    </button>

    <div id="out" style="margin-top:12px;"></div>
  `;

  script.parentNode.insertBefore(root, script.nextSibling);

  const fromSel = root.querySelector("#from");
  const toSel = root.querySelector("#to");
  const departEl = root.querySelector("#depart");
  const paxEl = root.querySelector("#pax");
  const clsSel = root.querySelector("#cls");
  const tripTypeEl = root.querySelector("#tripType");
  const returnWrap = root.querySelector("#returnWrap");
  const returnEl = root.querySelector("#return");
  const btn = root.querySelector("#btn");
  const out = root.querySelector("#out");

  const CLASS_LABELS = {
    AUTO: "Auto (recommended)",
    TURBOPROP: "Turboprop",
    LIGHT_JET: "Light Jet",
    MIDSIZE: "Midsize Jet",
    SUPER_MID: "Super-Mid Jet",
    HEAVY_JET: "Heavy Jet",
  };

  function money(n) {
    return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  }

  function allowedClassesForPax(pax) {
    if (pax <= 4) return ["AUTO", "TURBOPROP", "LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"];
    if (pax <= 6) return ["AUTO", "LIGHT_JET", "MIDSIZE", "SUPER_MID", "HEAVY_JET"];
    if (pax <= 8) return ["AUTO", "MIDSIZE", "SUPER_MID", "HEAVY_JET"];
    if (pax <= 10) return ["AUTO", "SUPER_MID", "HEAVY_JET"];
    return ["AUTO", "HEAVY_JET"];
  }

  function renderClassOptions(pax, currentValue) {
    const allowed = allowedClassesForPax(pax);
    clsSel.innerHTML = "";
    for (const v of allowed) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = CLASS_LABELS[v] || v;
      clsSel.appendChild(opt);
    }
    clsSel.value = allowed.includes(currentValue) ? currentValue : "AUTO";
  }

  tripTypeEl.addEventListener("change", () => {
    const isRT = tripTypeEl.value === "roundtrip";
    returnWrap.style.display = isRT ? "flex" : "none";
  });

  paxEl.addEventListener("input", () => {
    renderClassOptions(Number(paxEl.value || 1), clsSel.value);
  });

  async function loadCities() {
    const r = await fetch(api + "/cities");
    if (!r.ok) throw new Error("Could not load cities");
    const data = await r.json();
    const cities = data.cities || [];
    const homeBaseCityKey = data.homeBaseCityKey;

    function fill(sel) {
      sel.innerHTML = "";
      for (const c of cities) {
        const opt = document.createElement("option");
        opt.value = c.cityKey;
        opt.textContent = c.label;
        sel.appendChild(opt);
      }
    }

    fill(fromSel);
    fill(toSel);

    // Default FROM = Austin
    fromSel.value = homeBaseCityKey || "Austin, TX, US";

    // Default TO: first non-Austin
    const firstNon = cities.find((x) => x.cityKey !== fromSel.value);
    if (firstNon) toSel.value = firstNon.cityKey;
  }

  btn.addEventListener("click", async () => {
    out.innerHTML = `<div style="color:#666;font-size:14px;">Estimating…</div>`;

    const pax = Number(paxEl.value || 1);
    const departDateISO = String(departEl.value || "").trim();
    const isRoundTrip = tripTypeEl.value === "roundtrip";
    const returnDateISO = isRoundTrip ? (String(returnEl.value || "").trim() || null) : null;

    if (!departDateISO) {
      out.innerHTML = `<div style="color:#b00;">Please select a departure date.</div>`;
      return;
    }
    if (isRoundTrip && !returnDateISO) {
      out.innerHTML = `<div style="color:#b00;">Please select a return date.</div>`;
      return;
    }

    const body = {
      fromCityKey: fromSel.value,
      toCityKey: toSel.value,
      departDateISO,
      isRoundTrip,
      returnDateISO,
      pax,
      preferredClass: clsSel.value || "AUTO",
    };

    try {
      const resp = await fetch(api + "/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const txt = await resp.text();
        out.innerHTML = `<div style="color:#b00;white-space:pre-wrap;font-size:13px;">${txt}</div>`;
        return;
      }

      const data = await resp.json();
      const b = data.breakdown || {};
      const legs = Array.isArray(b.reposition_legs) ? b.reposition_legs : [];

      out.innerHTML = `
        <div style="padding:12px;border:1px solid #eee;border-radius:12px;background:#fafafa;">
          <div style="font-size:20px;font-weight:900;">
            ${money(data.estimate_low)}–${money(data.estimate_high)}
          </div>

          <div style="margin-top:6px;color:#333;font-size:13px;">
            Aircraft: <b>${String(b.aircraft_label || b.aircraft_class || "").replaceAll("_"," ")}</b>
            • Home base: <b>Austin (KAUS)</b>
          </div>

          <details style="margin-top:10px;">
            <summary style="cursor:pointer;font-weight:800;">See breakdown</summary>
            <div style="margin-top:8px;font-size:13px;line-height:1.45;color:#333;">
              <div>Trip hours (est): <b>${b.trip_hours_est ?? "-"}</b></div>
              <div>Reposition hours (est): <b>${b.reposition_hours_est ?? "-"}</b></div>
              <div>Wait days: <b>${b.wait_days ?? 0}</b></div>
              <div style="margin-top:6px;">Fees: <b>${money((b.fees?.low ?? 0))}–${money((b.fees?.high ?? 0))}</b></div>
              <div>Parking/handling: <b>${money((b.parking?.low ?? 0))}–${money((b.parking?.high ?? 0))}</b></div>
              <div style="margin-top:8px;color:#666;">
                Volatility buffer: ±${Math.round((b.volatility_multiplier ?? 0) * 100)}%
                ${b.mode ? ` • Mode: ${b.mode}` : ""}
              </div>

              ${legs.length ? `
                <div style="margin-top:10px;font-weight:800;">Reposition legs</div>
                <ul style="margin:6px 0 0 18px;padding:0;">
                  ${legs.map(l => `<li>${l.from} → ${l.to} (${l.distance_nm} nm, ~${l.hours}h)</li>`).join("")}
                </ul>
              ` : ""}

              <div style="margin-top:10px;font-weight:800;">Assumptions</div>
              <ul style="margin:6px 0 0 18px;padding:0;">
                ${(b.assumptions || []).map(x => `<li>${x}</li>`).join("")}
              </ul>
            </div>
          </details>

          <div style="margin-top:10px;font-size:12px;color:#666;">
            Budget estimate only. Final pricing depends on availability and routing.
          </div>
        </div>
      `;
    } catch (e) {
      out.innerHTML = `<div style="color:#b00;">Network error. Please try again.</div>`;
    }
  });

  (async function init() {
    try {
      await loadCities();
      renderClassOptions(Number(paxEl.value || 1), "AUTO");
    } catch (e) {
      out.innerHTML = `<div style="color:#b00;">Could not load city list.</div>`;
    }
  })();
})();
