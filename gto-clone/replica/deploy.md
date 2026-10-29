# Deploy: Spotwise

## Preflight (2026-10-29)
| check | result |
| --- | --- |
| tests (`tests.html`, the stand-in for Playwright since Node isn't installed) | **30/30 pass** |
| must-haves (parity.md, scored by hand) | **16/16**, feature score 92% |
| rebrand sweep (grep for every term and domain in brand.json, excluding replica/) | **clean** |
| store listing | n/a (web only) |
| production build | n/a (static files, no build step) |
| open S1/S2 bugs | **none** (B01 S2 fixed) |
| privacy / terms | no data leaves the browser (localStorage only, no cookies, no analytics), so no banner is needed. A one-line privacy note is enough for personal use |
| favicon / title | own mark and name, checked by eye |
| DB, env vars, Stripe, OAuth, email | n/a (no backend) |

## Host
The static files run anywhere that serves files.
- **Local (current):** `powershell -File serve.ps1 -Port 8844 -Root gto-clone`, then open http://localhost:8844
- **Public (live since 2026-10-29):** https://medapex55-coder.github.io/apex-demo/gto-clone/ (GitHub Pages, branch `master`, repo apex-demo). Tests on the live URL: 30/30.

## Watch
No server, so there's nothing to monitor. After any change, open `tests.html` on the live URL and check that it says 30/30.
