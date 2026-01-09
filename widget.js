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
  root.style.maxWidth = "640px";
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
    if (pax <= 4) return ["AUTO","TURBOPROP","LIGHT_JET","MIDSIZE","SUPER_MID","HEAVY_JET"];
    if (pax <= 6) return ["AUTO","LIGHT_JET","MIDSIZE","SUPER_MID","HEAVY_JET"];
    if (pax <= 8) return ["AUTO","MIDSIZE","SUPER_MID","HEAVY_JET"];
    if (pax <= 10) return ["AUTO","SUPER_MID","HEAVY_JET"];
    return ["AUTO","HEAVY_JET"];
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
    // preserve selection if still allowed
    if (allowed.includes(currentValue)) clsSel.value = currentValue;
  }

  async function loadCities() {
    const r = await fetch(api + "/cities");
    if (!r.ok) throw new Error("Could not load cities");
    const data = await r.json();

    const { cities, homeBaseCityKey } = data;

    function fillSelect(sel) {
      sel.innerHTML = "";
      for (const c of cities) {
        const opt = document.createElement("option");
        opt.value = c.cityKey;
        opt.textContent = c.label;
        sel.appendChild(opt);
      }
    }

    fillSelect(fromSel);
    fillSelect(toSel);

    // Default FROM = Austin (home base)
    fromSel.value = homeBaseCityKey || "Austin, TX, US";

    // Default TO = Dallas (nice quick test), fallback to first non-Austin
    const firstNonFrom = cities.find(x => x.cityKey !== fromSel.value);
    if (firstNonFrom) toSel.value = firstNonFrom.cityKey;
  }

  tripTypeEl.addEventListener("change", () => {
    const isRT = tripTypeEl.value === "roundtrip";
    returnWrap.style.display = isRT ? "flex" : "none";
  });

  paxEl.addEventListener("input", () => {
    const pax = Number(paxEl.value || 1);
    renderClassOptions(pax, clsSel.value);
  });

  btn.addEventListener("click", async () => {
    out.innerHTML = `<div style="color:#666;font-size:14px;">Estimating…</div>`;

    const pax = Number(paxEl.value || 1);
    const departDateISO = String(departEl.value || "").trim();
    const isRoundTrip = tripTypeEl.value === "roundtrip";
    const returnDateISO = isRoundTrip ? String(returnEl.value || "").trim() || null : null;

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

      out.innerHTML = `
        <div style="padding:12px;border:1px solid #eee;border-radius:12px;background:#fafafa;">
          <div style="font-size:20px;font-weight:900;">
            ${money(data.estimate_low)}–${money(data.estimate_high)}
          </div>

          <div style="margin-top:6px;color:#333;font-size:13px;">
            Aircraft: <b>${String(data.input.resolvedClass).replaceAll("_"," ")}</b>
            • Home base: <b>Austin (KAUS)</b>
          </div>

          <details style="margin-top:10px;">
            <summary style="cursor:pointer;font-weight:800;">See breakdown</summary>
            <div style="margin-top:8px;font-size:13px;line-height:1.4;">
              <div>Trip hours (est): <b>${data.breakdown.trip_hours_est}</b></div>
              <div>Reposition hours (est): <b>${data.breakdown.reposition_hours_est}</b></div>
              ${data.breakdown.standby_days ? `<div>Standby days: <b>${data.breakdown.standby_days}</b> (modeled modestly)</div>` : ""}
              <div style="margin-top:8px;color:#666;">
                Range includes volatility buffer (±${Math.round(data.breakdown.volatility_multiplier * 100)}%).
              </div>
              <div style="margin-top:10px;">
                <div style="font-weight:800;">Assumptions</div>
                <ul style="margin:6px 0 0 18px;padding:0;">
                  ${(data.breakdown.assumptions || []).map(x => `<li>${x}</li>`).join("")}
                </ul>
              </div>
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

  // Init
  (async function init() {
    try {
      await loadCities();
      renderClassOptions(Number(paxEl.value || 1), "AUTO");
    } catch (e) {
      out.innerHTML = `<div style="color:#b00;">Could not load city list. Please try again later.</div>`;
    }
  })();
})();
