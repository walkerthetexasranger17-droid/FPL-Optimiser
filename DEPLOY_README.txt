FPL Optimiser v0.20.0 — GitHub Pages site bundle

Replace the contents of the GitHub Pages repository with the CONTENTS of this folder.
The root must contain index.html, app.js, styles.css, sw.js, manifest.webmanifest and the src folder.

The app points to the live Cloudflare Worker automatically.
No ADMIN_TOKEN or research key is included in this ZIP.

v0.20.0 changes the normal experience to a one-stop dashboard:
- saved team/research connection is recovered automatically where possible;
- technical research controls are hidden under Settings;
- one Optimise My Team button drives the main workflow;
- transfer advice is withheld if important player checks are still unresolved.

After pushing to GitHub Pages, refresh the site once. The v0.20 service worker uses a new cache key and network-first updates.
