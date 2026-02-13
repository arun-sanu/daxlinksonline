from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .adapters.mexc_ccxt import MexcCcxtAdapter
from .config import Settings
from .daxlinks_client import DaxLinksClient
from .engine import TradeExecutionEngine
from .logger import configure_logger, log_event
from .risk import RiskGuard
from .security import ip_allowed, verify_hmac_signature

app = FastAPI(title="trade-exec-bot", version="1.0.0")


@app.on_event("startup")
def startup() -> None:
    settings = Settings()
    logger = configure_logger()
    adapter = MexcCcxtAdapter(
        api_key=settings.mexc_api_key,
        api_secret=settings.mexc_api_secret,
        password=settings.mexc_api_password,
        sandbox=settings.mexc_sandbox,
    )
    daxlinks_client = DaxLinksClient(
        url=settings.daxlinks_internal_url,
        token=settings.daxlinks_internal_token,
        timeout_seconds=settings.http_timeout_seconds,
    )
    risk_guard = RiskGuard(
        cooldown_seconds=settings.cooldown_seconds,
        max_open_orders_per_symbol=settings.max_open_orders_per_symbol,
        daily_loss_cap_enabled=settings.daily_loss_cap_enabled,
    )
    app.state.settings = settings
    app.state.logger = logger
    app.state.engine = TradeExecutionEngine(
        settings=settings,
        adapter=adapter,
        daxlinks_client=daxlinks_client,
        risk_guard=risk_guard,
        logger=logger,
    )
    log_event(logger, logging.INFO, "service_started", app=settings.app_name, env=settings.app_env)


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {"ok": True}


@app.post("/webhook")
async def webhook(request: Request) -> JSONResponse:
    settings: Settings = app.state.settings
    logger = app.state.logger
    engine: TradeExecutionEngine = app.state.engine

    raw_body = await request.body()
    signature = request.headers.get("x-signature")
    if not verify_hmac_signature(settings.webhook_secret, raw_body, signature):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Signature")

    client_ip = (
        (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        or (request.client.host if request.client else None)
    )
    if not ip_allowed(client_ip, settings.allowlisted_ip_set):
        raise HTTPException(status_code=403, detail="Client IP is not allowlisted")

    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON payload: {exc}") from exc

    try:
        result = engine.process(payload)
    except Exception as exc:
        log_event(logger, logging.ERROR, "execution_failed", signal_id=payload.get("id"), error=str(exc))
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "signalId": payload.get("id"),
                "entryOrder": {},
                "protection": {"tp": None, "sl": None},
                "sizing": {},
                "errors": [str(exc)],
            },
        )

    signal_id = result.get("signalId")
    log_event(
        logger,
        logging.INFO,
        "execution_completed",
        signal_id=signal_id,
        ok=result.get("ok"),
        error_count=len(result.get("errors") or []),
    )
    return JSONResponse(status_code=200, content=result)
