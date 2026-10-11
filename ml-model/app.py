"""
Nexora Agrotech - Smart Matching API.

Loads listings.csv, demand.csv, and the trained model ONCE at startup and
keeps everything in memory for the life of the process (important for
Render free tier: no retraining, no per-request disk I/O).

Endpoints:
  GET  /health                 - trivial liveness check, no model access
  POST /match/buyer-to-farmer  - buyer requirement -> ranked farmer listings
  POST /match/farmer-to-buyer  - farmer listing -> ranked buyer demands

Run locally:  uvicorn app:app --host 0.0.0.0 --port 8000
"""

import json
import os
from typing import Optional

import joblib
import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel

from matching_core import build_features, FEATURE_COLUMNS

# ---------------------------------------------------------------------------
# Loaded ONCE at process startup - not per request.
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

MODEL = joblib.load(os.path.join(BASE_DIR, "models", "model.pkl"))
FEATURE_COLS = json.load(open(os.path.join(BASE_DIR, "models", "feature_columns.json")))

# NOTE: these CSVs are the ML service's own in-memory copy for candidate
# retrieval + scoring. They will drift from MongoDB Atlas if new listings/
# demands are added after this process starts. Acceptable for the hackathon
# demo; the fix later is either a periodic refresh job or having this
# service query MongoDB directly instead of static CSVs.
LISTINGS = pd.read_csv(os.path.join(BASE_DIR, "listings.csv"))
DEMAND = pd.read_csv(os.path.join(BASE_DIR, "demand.csv"))

app = FastAPI(title="Nexora Smart Matching API")


# ---------------------------------------------------------------------------
# Request/response schemas
# ---------------------------------------------------------------------------

class BuyerQuery(BaseModel):
    crop: str
    variety: Optional[str] = "Not Specified"
    required_quantity_tons: float
    maximum_price_per_quintal: float
    required_by_date: str          # "YYYY-MM-DD"
    demand_date: Optional[str] = None
    cluster: str
    district: str
    taluka: str
    village: str
    top_k: int = 20


class FarmerQuery(BaseModel):
    crop: str
    variety: str
    quantity_tonnes: float
    price_per_quintal: float
    harvest_date: str
    listed_at: Optional[str] = None
    cluster: str
    district: str
    taluka: str
    village: str
    top_k: int = 20


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    """Trivial - does not touch the model or data. Used to keep the free
    Render instance awake, and to check the process is up."""
    return {"status": "ok"}


@app.post("/match/buyer-to-farmer")
def match_buyer_to_farmer(query: BuyerQuery):
    """Buyer requirement -> ranked candidate farmer listings."""
    demand_row = {
        "crop": query.crop,
        "variety": query.variety or "Not Specified",
        "required_quantity_tons": query.required_quantity_tons,
        "maximum_price_per_quintal": query.maximum_price_per_quintal,
        "required_by_date": query.required_by_date,
        "demand_date": query.demand_date or query.required_by_date,
        "cluster": query.cluster,
        "district": query.district,
        "taluka": query.taluka,
        "village": query.village,
    }

    candidates = LISTINGS[LISTINGS["crop"] == query.crop]
    if len(candidates) == 0:
        return {"results": [], "note": f"No listings found for crop '{query.crop}'."}

    feats = [build_features(listing, demand_row) for _, listing in candidates.iterrows()]
    X = pd.DataFrame(feats)[FEATURE_COLS]
    scores = MODEL.predict(X)

    out = candidates.copy()
    out["compatibility_score"] = (scores * 100).round(1)
    out = out.sort_values("compatibility_score", ascending=False).head(query.top_k)

    return {
        "results": out.to_dict(orient="records"),
        "count": len(out),
        "note": "compatibility_score is a model-estimated compatibility score "
                "(0-100), not a probability of an actual future transaction.",
    }


@app.post("/match/farmer-to-buyer")
def match_farmer_to_buyer(query: FarmerQuery):
    """Farmer listing -> ranked candidate buyer demands."""
    listing_row = {
        "crop": query.crop,
        "variety": query.variety,
        "quantity_tonnes": query.quantity_tonnes,
        "price_per_quintal": query.price_per_quintal,
        "harvest_date": query.harvest_date,
        "listed_at": query.listed_at or query.harvest_date,
        "cluster": query.cluster,
        "district": query.district,
        "taluka": query.taluka,
        "village": query.village,
    }

    candidates = DEMAND[DEMAND["crop"] == query.crop]
    if len(candidates) == 0:
        return {"results": [], "note": f"No demand found for crop '{query.crop}'."}

    feats = [build_features(listing_row, dem) for _, dem in candidates.iterrows()]
    X = pd.DataFrame(feats)[FEATURE_COLS]
    scores = MODEL.predict(X)

    out = candidates.copy()
    out["compatibility_score"] = (scores * 100).round(1)
    out = out.sort_values("compatibility_score", ascending=False).head(query.top_k)

    return {
        "results": out.to_dict(orient="records"),
        "count": len(out),
        "note": "compatibility_score is a model-estimated compatibility score "
                "(0-100), not a probability of an actual future transaction.",
    }
