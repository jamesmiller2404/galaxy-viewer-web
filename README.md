# galaxy-viewer-web

## Jupiter backend (Node worker pool)

- Start the API server with `npm run dev:server` (listens on `http://localhost:8787`).
- Keep kernels under `data/spice` and update `data/spice/meta/jupiter.tm` if your path differs.
- Download kernels with `scripts/fetch-kernels.sh` (add `--include-irregular` for jup347).

The Vite dev server proxies `/api` to the local backend.
