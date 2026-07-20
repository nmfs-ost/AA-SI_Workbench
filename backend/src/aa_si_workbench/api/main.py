"""FastAPI application for the AA-SI Workbench backend.

Run (from a venv that has `aalibrary` installed):

    pip install -e .            # installs fastapi/uvicorn/boto3 + this package
    uvicorn aa_si_workbench.api.main:app --reload --port 8000

Then the NCEI endpoints are under http://localhost:8000/api/ncei/... and the
frontend dev server proxies /api to this host (see frontend/vite.config.ts).
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .. import _paths
from .ncei import router as ncei_router


class _SPAStaticFiles(StaticFiles):
    """Serve the built UI, falling back to index.html for unknown paths."""

    async def get_response(self, path: str, scope):  # type: ignore[override]
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404:
                return await super().get_response("index.html", scope)
            raise


def _cors_origins() -> list[str]:
    raw = os.getenv(
        "AASI_CORS_ORIGINS",
        "http://localhost:5173,http://localhost:4173",
    )
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def create_app() -> FastAPI:
    app = FastAPI(title="AA-SI Workbench API", version="0.1.0")

    # Only needed when the frontend calls the API cross-origin (i.e. not through
    # the Vite dev proxy). Harmless otherwise.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins(),
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    app.include_router(ncei_router)

    @app.get("/health", tags=["meta"])
    def health() -> dict[str, str]:
        return {"status": "ok", "ncei_source": os.getenv("AASI_NCEI_SOURCE", "s3")}

    # Serve the compiled frontend (when built) from the same origin as the API,
    # so `aa-workbench serve` needs only one port and no proxy/CORS. Mounted
    # last so /api/*, /health, and /docs keep precedence.
    dist = _paths.frontend_dist_dir()
    if dist is not None:
        app.mount("/", _SPAStaticFiles(directory=str(dist), html=True), name="app")

    return app


app = create_app()
