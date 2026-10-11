"""
Nexora Agrotech - Smart Matching core logic.

This module is shared between TRAINING (offline) and INFERENCE (the live API),
so feature engineering is guaranteed to be identical in both places.

Core idea:
  - A "pair" = one listing (supply) + one demand (requirement) for the SAME crop.
  - We compute a handful of meaningful compatibility features per pair.
  - For TRAINING, we also compute a heuristic compatibility label (0-1) used as
    the supervised target, since no real outcome/transaction-linked label exists
    in the current schema (see project notes).
"""

import numpy as np
import pandas as pd
from datetime import datetime

GEO_LEVELS = ["village", "taluka", "district", "cluster"]


# ---------------------------------------------------------------------------
# PAIRWISE FEATURE ENGINEERING (used at both train time and inference time)
# ---------------------------------------------------------------------------

def geo_match_level(listing, demand):
    """Returns the finest geographic level at which listing and demand agree.
    0 = village, 1 = taluka, 2 = district, 3 = cluster, 4 = no match at any level."""
    for i, level in enumerate(GEO_LEVELS):
        if listing[level] == demand[level]:
            return i
    return 4


def build_features(listing, demand):
    """
    listing, demand: dict-like (pandas Series or plain dict) with the raw
    listings.csv / demand.csv columns for ONE listing and ONE demand record.
    Returns a dict of numeric features ready for the model.
    Assumes listing['crop'] == demand['crop'] (hard filter applied upstream).
    """
    price = float(listing["price_per_quintal"])
    max_price = float(demand["maximum_price_per_quintal"])
    listing_qty = float(listing["quantity_tonnes"])
    required_qty = float(demand["required_quantity_tons"])

    # --- price gap: negative = under budget (good), positive = over budget ---
    price_gap_ratio = (price - max_price) / max_price

    # --- quantity ratio, capped ---
    qty_ratio = listing_qty / required_qty if required_qty > 0 else 0.0
    qty_ratio_capped = min(qty_ratio, 2.0)  # cap extreme oversupply

    # --- geography ---
    geo_level = geo_match_level(listing, demand)  # 0=best .. 4=worst

    # --- variety ---
    demand_variety = str(demand["variety"]).strip()
    listing_variety = str(listing["variety"]).strip()
    variety_any = 1 if demand_variety.lower() == "not specified" else 0
    variety_exact = 1 if (not variety_any and listing_variety == demand_variety) else 0

    # --- timing: harvest_date vs required_by_date ---
    harvest = pd.to_datetime(listing["harvest_date"])
    required_by = pd.to_datetime(demand["required_by_date"])
    days_slack = (required_by - harvest).days  # positive = ready in time

    # --- listing freshness / demand freshness (how "new" each side is) ---
    listed_at = pd.to_datetime(listing["listed_at"])
    demand_date = pd.to_datetime(demand["demand_date"])
    posting_gap_days = (listed_at - demand_date).days

    return {
        "price_gap_ratio": price_gap_ratio,
        "qty_ratio_capped": qty_ratio_capped,
        "geo_level": geo_level,
        "variety_any": variety_any,
        "variety_exact": variety_exact,
        "days_slack": days_slack,
        "posting_gap_days": posting_gap_days,
    }


FEATURE_COLUMNS = [
    "price_gap_ratio",
    "qty_ratio_capped",
    "geo_level",
    "variety_any",
    "variety_exact",
    "days_slack",
    "posting_gap_days",
]


# ---------------------------------------------------------------------------
# HEURISTIC COMPATIBILITY LABEL (training-time only; NOT used at inference)
# ---------------------------------------------------------------------------

def _price_score(price_gap_ratio):
    if price_gap_ratio <= 0:
        # within budget: 0.8 base + up to 0.2 bonus for being well under budget
        return min(1.0, 0.8 + 0.2 * min(-price_gap_ratio, 1.0))
    # over budget: penalize, floor at 0
    return max(0.0, 0.8 - price_gap_ratio)


def _qty_score(qty_ratio_capped):
    # soft partial-fulfillment credit; sqrt rewards partial matches
    return float(min(1.0, np.sqrt(min(qty_ratio_capped, 1.0))))


def _geo_score(geo_level):
    return {0: 1.0, 1: 0.8, 2: 0.6, 3: 0.4, 4: 0.1}[geo_level]


def _variety_score(variety_any, variety_exact):
    if variety_any or variety_exact:
        return 1.0
    return 0.3


def _timing_score(days_slack):
    if days_slack >= 0:
        return 1.0
    # late by N days: lose 1/30 of score per day late, floor 0
    return max(0.0, 1.0 + days_slack / 30.0)


def heuristic_label(features, weight_noise_std=0.0, rng=None):
    """
    Computes the compatibility label in [0,1] from engineered features.

    weight_noise_std > 0 perturbs the component weights slightly to simulate
    that different buyers/queries implicitly value factors differently
    (e.g., some prioritize price, others prioritize distance). This is used
    ONLY when generating TRAINING labels, so the model learns a general
    compatibility pattern rather than one fixed arithmetic formula.
    """
    base_weights = np.array([0.30, 0.25, 0.20, 0.15, 0.10])  # price, geo, qty, variety, timing
    if weight_noise_std > 0:
        rng = rng or np.random.default_rng()
        noise = rng.normal(0, weight_noise_std, size=5)
        w = np.clip(base_weights + noise, 0.02, None)
        w = w / w.sum()
    else:
        w = base_weights

    scores = np.array([
        _price_score(features["price_gap_ratio"]),
        _geo_score(features["geo_level"]),
        _qty_score(features["qty_ratio_capped"]),
        _variety_score(features["variety_any"], features["variety_exact"]),
        _timing_score(features["days_slack"]),
    ])
    return float(np.dot(w, scores))
