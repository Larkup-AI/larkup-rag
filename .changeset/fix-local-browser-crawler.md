---
'@larkup/scraper': patch
'@larkup/core': patch
'larkup': patch
---

Prefer the local Playwright crawler when Docker is available so JavaScript-protected pages can be scraped. Start it in the background with visible readiness and fallback status, retain the native fallback, and reject Anubis challenge pages.
