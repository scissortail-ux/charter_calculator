# Charter Calculator (Budget Estimator)

Repo: https://github.com/scissortail-ux/charter_calculator

This project contains:
- `server.js` — API that calculates estimate ranges (deploy to Render)
- `widget.js` — embeddable widget for Squarespace (load via CDN)

## Deploy API on Render (beginner)
1) Render → New → Web Service
2) Connect this GitHub repo
3) Build Command: `npm install`
4) Start Command: `npm start`
5) After deploy, test:
   - `https://YOUR-RENDER-URL/health` → should return `{ "ok": true }`

## Squarespace Embed (using jsDelivr)
After `widget.js` exists in the repo, add a Squarespace Code Block:

```html
<script
  src="https://cdn.jsdelivr.net/gh/scissortail-ux/charter_calculator@main/widget.js"
  data-api="https://YOUR-RENDER-URL">
</script>
