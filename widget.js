(function () {
  const script = document.currentScript;
  const apiBase = script?.getAttribute("data-api");

  if (!apiBase) {
    console.error("Charter Calculator: missing data-api attribute");
    return;
  }

  // ---------- UI ----------
  const root = document.createElement("div");
  root.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  root.style.border = "1px solid #ddd";
  root.style.borderRadius = "12px";
  root.style.padding = "16px";
  root.style.maxWidth = "560px";
  root.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";

  root.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <strong>Charter Cost Estimator</strong>
      <span style="font-size:12px;color:#666;">Estimate • Not a quote</span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <input placeholder="From (ICAO)" />
      <input placeholder="To (ICAO)" />
      <input type="date" />
      <input type="number" min="1" max="30" value="4" />
    </div>

    <button style="margin-top:12px;width:100%;padding:12px;border:0;border-radius:10px;font-weight:700;cursor:pointer;background:#111;color:#fff;">
      Estimate all-in cost
    </button>

    <div style="margin-top:12px;" class="out"></div>
  `;

  script.parentNode.insertBefore(root, script.nextSibling);

  // ---------- State ----------
  const inputs = root.querySelectorAll("input");
  const fromInput = inputs[0];
  const toInput = inputs[1];
  const dateInput = inputs[2];
  const paxInput = inputs[3];
  const button = root.querySelector("button");
  const output = root.querySelector(".out");

  function money(n) {
    return n.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    });
  }

  // ---------- Action ----------
  button.onclick = async () => {
    const originIcao = fromInput.value.trim().toUpperCase();
    const destIcao = toInput.value.trim().toUpperCase();
    const departDateISO = dateInput.value;
    const pax = Number(paxInput.value || 1);

    if (originIcao.length < 3 || destIcao.length < 3) {
      output.innerHTML = `<div style="color:#b00;">Please enter valid ICAO codes (e.g. KTEB, KMIA).</div>`;
      return;
    }

    if (!departDateISO) {
      output.innerHTML = `<div style="color:#b00;">Please select a departure date.</div>`;
      return;
    }

    output.innerHTML = `<div style="color:#666;">Estimating…</div>`;

    try {
      const res = await fetch(apiBase.replace(/\/$/, "") + "/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originIcao,
          destIcao,
          departDateISO,
          isRoundTrip: false,
          returnDateISO: null,
          pax,
          timeFlex: "flex",
          shortNoticeDays: 7
        })
      });

      if (!res.ok) {
        const txt = await res.text();
        output.innerHTML = `<div style="color:#b00;">${txt}</div>`;
        return;
      }

      const data = await res.json();

      output.innerHTML = `
        <div style="padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa;">
          <div style="font-size:20px;font-weight:800;">
            ${money(data.estimate_low)}–${money(data.estimate_high)}
          </div>
          <div style="margin-top:6px;font-size:13px;">
            Typical aircraft: <b>${data.aircraft.replaceAll("_"," ")}</b>
          </div>
          <div style="margin-top:8px;font-size:12px;color:#666;">
            Budget estimate only. Final pricing depends on availability and routing.
          </div>
        </div>
      `;
    } catch (err) {
      output.innerHTML = `<div style="color:#b00;">Network error. Please try again.</div>`;
    }
  };
})();
