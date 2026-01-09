(function () {
  const script = document.currentScript;
  const apiBase = (script && script.getAttribute("data-api")) || "";

  if (!apiBase) {
    console.error("Charter Calculator widget: missing data-api attribute.");
    return;
  }

  const mount = document.createElement("div");
  mount.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  mount.style.border = "1px solid #ddd";
  mount.style.borderRadius = "12px";
  mount.style.padding = "16px";
  mount.style.maxWidth = "560px";
  mount.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
  mount.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div style="font-weight:800;">Charter Cost Estimator</div>
      <div style="font-size:12px;color:#666;">Estimate • Not a quote</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        From (ICAO)
        <input id="from" placeholder="KTEB" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;">
      </label>

      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        To (ICAO)
        <input id="to" placeholder="KMIA" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;">
      </label>

      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        Depart date
        <input id="depart" type="date" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;">
      </label>

      <label style="display:flex;flex-direction:column;font-size:12px;color:#333;">
        Passengers
        <input id="pax" type="number" min="1" max="30" value="4" style="padding:10px;border:1px solid #ccc;border-radius:10px;font-size:14px;">
      </label>
    </div>

    <button id="btn" style="margin-top:12px;width:100%;padding:12px;border:0;border-radius:12px;font-weight:800;cursor:pointer;background:#111;color:#fff;">
      Estimate all-in cost
    </button>

    <div id="out" style="margin-top:12px;"></div>
  `;

  script.parentNode.insertBefore(mount, script.nextSibling);

  const fromEl = mount.querySelector("#from");
  const toEl = mount.querySelector("#to");
  const departEl = mount.querySelector("#depart");
  const paxEl = mount.querySelector("#pax");
  const btn = mount.querySelector("#btn");
  const out = mount.querySelector("#out");

  function money(n) {
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    });
  }

  btn.addEventListener("click", async () => {
    out.innerHTML = `<div style="color:#666;font-size:14px;">Estimating…</div>`;

    const body = {
      originIcao: String(fromEl.value || "").trim().toUpperCase(),
      destIcao: String(toEl.value || "").trim().toUpperCase(),
      departDateISO: departEl.value,
      isRoundTrip: false,
      returnDateISO: null,
      pax: Number(paxEl.value || 1),
      timeFlex: "flex",
      shortNoticeDays: 7
    };

    try {
      const resp = await fetch(apiBase.replace(/\/$/, "") + "/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

   if (!resp.ok) {
  let msg = `Request failed (HTTP ${resp.status}).`;

  try {
    const err = await resp.json();
    if (err?.error) msg += `\n${err.error}`;

    // Show exact field errors from Zod
    const fe = err?.details?.fieldErrors;
    if (fe && typeof fe === "object") {
      msg += "\n\nField errors:";
      for (const key of Object.keys(fe)) {
        const problems = fe[key];
        if (Array.isArray(problems) && problems.length) {
          msg += `\n- ${key}: ${problems.join(", ")}`;
        }
      }
    } else {
      // fallback
      msg += "\n\n(No field details returned.)";
    }
  } catch (e) {
    // If server returned text instead of JSON
    try {
      const t = await resp.text();
      msg += "\n" + t;
    } catch (_) {}
  }

  out.innerHTML = `<div style="color:#b00;font-size:13px;white-space:pre-wrap;">${msg}</div>`;
  return;
}

      const data = await resp.json();
      out.innerHTML = `
        <div style="padding:12px;border:1px solid #eee;border-radius:12px;background:#fafafa;">
          <div style="font-size:18px;font-weight:900;">
            ${money(data.estimate_low)}–${money(data.estimate_high)}
          </div>
          <div style="margin-top:6px;color:#333;font-size:13px;">
            Typical aircraft: <b>${String(data.aircraft).replaceAll("_"," ")}</b>
          </div>
          <div style="margin-top:8px;font-size:12px;color:#666;">
            Estimate only for budgeting. Not a quote.
          </div>
        </div>
      `;
    } catch (e) {
      out.innerHTML = `<div style="color:#b00;font-size:14px;">Network error.</div>`;
    }
  });
})();
