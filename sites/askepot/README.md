# Askepot – opslagsværktøj (askepot.gokkehub.com)

Static, single-file tool for making social media posts (JPG) for Askepot Odense.
Not part of the npm workspaces / turbo build — it is deployed as-is by the
separate `.github/workflows/deploy-askepot.yml` workflow (deploy.yml ignores this folder) to the Cloudflare Pages
project `askepot`.

- `index.html` – the whole tool (logo embedded as a data URI)
- `askepot-logo-white.png` / `askepot-logo-black.png` – transparent logo files
