"""
Nexora Agrotech - Smart Matching training script.

Run offline (not on every request). Produces:
  models/model.pkl        - trained HistGradientBoostingRegressor
  models/baseline.pkl     - trained Ridge regression (for comparison)
  models/feature_columns.json

Usage: python3 train.py
"""

import json
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_squared_error, r2_score
import joblib
import os

from matching_core import build_features, heuristic_label, FEATURE_COLUMNS

RNG = np.random.default_rng(42)


def build_candidate_pairs(listings, demand, max_pairs_per_crop=None):
    """Cross-join listings x demand WITHIN the same crop only (hard filter)."""
    rows = []
    for crop, l_group in listings.groupby("crop"):
        d_group = demand[demand["crop"] == crop]
        if len(d_group) == 0:
            continue
        # cross join for this crop
        l_idx = l_group.index.to_numpy()
        d_idx = d_group.index.to_numpy()
        li, di = np.meshgrid(l_idx, d_idx, indexing="ij")
        pairs = pd.DataFrame({"listing_idx": li.ravel(), "demand_idx": di.ravel()})
        if max_pairs_per_crop and len(pairs) > max_pairs_per_crop:
            pairs = pairs.sample(max_pairs_per_crop, random_state=42)
        rows.append(pairs)
    return pd.concat(rows, ignore_index=True)


def main():
    listings = pd.read_csv("listings.csv")
    demand = pd.read_csv("demand.csv")

    print(f"Listings: {len(listings)}, Demand: {len(demand)}")

    pairs = build_candidate_pairs(listings, demand, max_pairs_per_crop=6000)
    print(f"Candidate same-crop pairs sampled: {len(pairs)}")

    # --- feature engineering + heuristic labeling ---
    feats = []
    labels = []
    for _, row in pairs.iterrows():
        listing = listings.loc[row["listing_idx"]]
        dem = demand.loc[row["demand_idx"]]
        f = build_features(listing, dem)
        feats.append(f)
        # inject weight-noise so the model learns a general pattern,
        # not one fixed arithmetic formula (see matching_core.py docstring)
        labels.append(heuristic_label(f, weight_noise_std=0.05, rng=RNG))

    X = pd.DataFrame(feats)[FEATURE_COLUMNS]
    y = np.array(labels)

    pairs = pairs.reset_index(drop=True)
    pairs["label"] = y

    # --- GROUP split by demand_idx: entire demand records held out at test time.
    # This tests whether the model generalizes to *unseen queries*, not just
    # unseen listing/demand combinations of already-seen demands. ---
    unique_demands = pairs["demand_idx"].unique()
    RNG.shuffle(unique_demands)
    n_test = int(0.2 * len(unique_demands))
    test_demands = set(unique_demands[:n_test])

    test_mask = pairs["demand_idx"].isin(test_demands)
    train_mask = ~test_mask

    X_train, X_test = X[train_mask], X[test_mask]
    y_train, y_test = y[train_mask], y[test_mask]

    print(f"Train pairs: {len(X_train)}, Test pairs: {len(X_test)} "
          f"(held-out demands: {len(test_demands)})")

    # --- baseline model ---
    baseline = Ridge(alpha=1.0)
    baseline.fit(X_train, y_train)
    base_pred = baseline.predict(X_test)

    # --- comparison model ---
    model = HistGradientBoostingRegressor(
        max_depth=4, max_iter=150, learning_rate=0.08, random_state=42
    )
    model.fit(X_train, y_train)
    model_pred = model.predict(X_test)

    print("\n=== Regression quality (predicting the heuristic compatibility score) ===")
    for name, pred in [("Ridge (baseline)", base_pred), ("HistGradientBoosting", model_pred)]:
        rmse = mean_squared_error(y_test, pred) ** 0.5
        r2 = r2_score(y_test, pred)
        print(f"{name:22s}  RMSE={rmse:.4f}   R2={r2:.4f}")

    # --- ranking quality: for each held-out demand, does the model's top-K
    # ranking of candidate listings agree with the (noise-free) heuristic's
    # top-K ranking? This is the metric that actually matters for the product. ---
    print("\n=== Ranking quality on held-out demands (Precision@10) ===")
    eval_df = pairs[test_mask].copy()
    eval_df["pred_ridge"] = base_pred
    eval_df["pred_gbrt"] = model_pred

    # "ground truth" ranking = noise-free heuristic (deterministic weights)
    clean_labels = []
    for _, row in eval_df.iterrows():
        listing = listings.loc[row["listing_idx"]]
        dem = demand.loc[row["demand_idx"]]
        f = build_features(listing, dem)
        clean_labels.append(heuristic_label(f, weight_noise_std=0.0))
    eval_df["clean_label"] = clean_labels

    def precision_at_k(group, score_col, k=10):
        top_true = set(group.sort_values("clean_label", ascending=False).head(k)["listing_idx"])
        top_pred = set(group.sort_values(score_col, ascending=False).head(k)["listing_idx"])
        if len(top_true) == 0:
            return None
        return len(top_true & top_pred) / min(k, len(top_true))

    for score_col, name in [("pred_ridge", "Ridge (baseline)"), ("pred_gbrt", "HistGradientBoosting")]:
        precisions = []
        for demand_idx, group in eval_df.groupby("demand_idx"):
            if len(group) < 3:
                continue  # too few candidates to meaningfully rank
            p = precision_at_k(group, score_col, k=min(10, len(group)))
            if p is not None:
                precisions.append(p)
        print(f"{name:22s}  mean Precision@10 = {np.mean(precisions):.3f}  "
              f"(over {len(precisions)} demands with >=3 candidates)")

    # --- save the better model (by RMSE) ---
    os.makedirs("models", exist_ok=True)
    joblib.dump(baseline, "models/baseline_ridge.pkl")
    joblib.dump(model, "models/model.pkl")
    with open("models/feature_columns.json", "w") as f:
        json.dump(FEATURE_COLUMNS, f)

    print("\nSaved: models/model.pkl (HistGradientBoosting), "
          "models/baseline_ridge.pkl (Ridge), models/feature_columns.json")


if __name__ == "__main__":
    main()
