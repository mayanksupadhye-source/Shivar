"""
Nexora Agrotech - Price Estimate API (standalone service).

This is a SEPARATE service from the Smart Matching ml-model. It only
knows about price estimation. It does not touch matching, listings
scoring, or anything else — so it can never break the old service.

Endpoints:
  GET  /health          - liveness check
  POST /price-estimate  - crop/variety/district/quantity -> price estimate

Run locally:  uvicorn app:app --host 0.0.0.0 --port 8001
"""

import json
import os
from typing import Optional

import joblib
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from price_core import build_price_features, FEATURE_COLUMNS as PRICE_FEATURE_COLS

# ---------------------------------------------------------------------------
# Loaded ONCE at process startup - not per request.
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

PRICE_MODEL = joblib.load(os.path.join(BASE_DIR, "models", "price_model.pkl"))
PRICE_ENCODERS = joblib.load(os.path.join(BASE_DIR, "models", "price_encoders.pkl"))
PRICE_CROP_STATS = json.load(open(os.path.join(BASE_DIR, "models", "price_crop_stats.json")))

app = FastAPI(title="Nexora Price Estimate Service")

# ---------------------------------------------------------------------------
# Enable CORS so your frontend (Live Server, port 5500) can call this.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PriceEstimateQuery(BaseModel):
    crop: str
    variety: Optional[str] = "Not Specified"
    district: str
    quantity_tonnes: float
    target_date: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/price-estimate")
def price_estimate(query: PriceEstimateQuery):
    if query.crop not in PRICE_CROP_STATS:
        return {"error": f"No price data available for crop '{query.crop}'."}

    listing = {
        "crop": query.crop,
        "variety": query.variety or "Not Specified",
        "district": query.district,
        "quantity_tonnes": query.quantity_tonnes,
    }
    feats, has_unseen = build_price_features(listing, PRICE_ENCODERS)

    stats = PRICE_CROP_STATS[query.crop]
    baseline_estimate = stats["mean"]
    std = stats["std"] or 0.0
    low = round(baseline_estimate - std, 1)
    high = round(baseline_estimate + std, 1)

    if has_unseen:
        model_estimate = None
        confidence_note = ("LOW - variety or district was not seen during training, "
                            "so no model estimate is given; using the crop-average "
                            "baseline only. Date/time is not used regardless - no "
                            "seasonal or time trend was found in the underlying data.")
    else:
        X = pd.DataFrame([feats])[PRICE_FEATURE_COLS]
        model_estimate = round(float(PRICE_MODEL.predict(X)[0]), 1)
        confidence_note = ("LOW - variety, district, and quantity showed negligible "
                            "effect on price in the underlying data; treat the "
                            "'typical_price_range' as more reliable than the single "
                            "point estimate. Date/time is not used - no seasonal or "
                            "time trend was found in the data.")

    return {
        "crop": query.crop,
        "model_estimate_per_quintal": model_estimate,
        "baseline_crop_average_per_quintal": round(baseline_estimate, 1),
        "typical_price_range_per_quintal": {"low": low, "high": high},
        "sample_size_for_this_crop": int(stats["count"]),
        "confidence": confidence_note,
    }