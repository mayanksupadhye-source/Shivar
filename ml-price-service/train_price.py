"""
Nexora Agrotech - Price Estimate training script (Model 2).

Run offline: python3 train_price.py
Produces:
  models/price_model.pkl
  models/price_encoders.pkl
  models/price_crop_stats.json   (per-crop mean/std, used for baseline + bands)

READ price_core.py's module docstring first - this model is intentionally
labeled low-confidence because the underlying data has no strong signal
beyond crop identity. This script prints the honest comparison every time
it runs so that fact can never be quietly forgotten.
"""

import json
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.preprocessing import OrdinalEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error

from price_core import FEATURE_COLUMNS


def main():
    listings = pd.read_csv("listings.csv")

    # --- fit encoders on the full crop/variety/district vocabulary ---
    encoders = {}
    for col in ["crop", "variety", "district"]:
        enc = OrdinalEncoder()
        enc.fit(listings[[col]])
        encoders[col] = enc

    X = pd.DataFrame({
        "crop_enc": encoders["crop"].transform(listings[["crop"]]).ravel(),
        "variety_enc": encoders["variety"].transform(listings[["variety"]]).ravel(),
        "district_enc": encoders["district"].transform(listings[["district"]]).ravel(),
        "quantity_tonnes": listings["quantity_tonnes"].values,
    })
    y = listings["price_per_quintal"].values

    X_train, X_test, y_train, y_test, idx_train, idx_test = train_test_split(
        X, y, listings.index, test_size=0.2, random_state=42
    )

    # --- the model we're actually shipping ---
    model = HistGradientBoostingRegressor(max_depth=4, random_state=42)
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    # --- the trivial baseline it must be compared against, always ---
    train_crop_means = listings.iloc[idx_train].groupby("crop")["price_per_quintal"].mean()
    baseline_pred = listings.iloc[idx_test]["crop"].map(train_crop_means).values

    model_r2 = r2_score(y_test, pred)
    baseline_r2 = r2_score(y_test, baseline_pred)
    model_mae = mean_absolute_error(y_test, pred)
    baseline_mae = mean_absolute_error(y_test, baseline_pred)

    print("=== Price Estimate model vs trivial crop-average baseline (held-out data) ===")
    print(f"{'Model':30s} R2={model_r2:.4f}   MAE={model_mae:.1f} per quintal")
    print(f"{'Baseline (crop mean only)':30s} R2={baseline_r2:.4f}   MAE={baseline_mae:.1f} per quintal")
    improvement = model_r2 - baseline_r2
    print(f"\nImprovement over trivial baseline: {improvement:+.4f} R2")
    if improvement < 0.03:
        print("VERDICT: negligible improvement. This confirms price in this dataset "
              "is driven almost entirely by crop identity, not variety/district/quantity. "
              "Ship this as a clearly-labeled LOW-CONFIDENCE estimate, not a forecast.")
    else:
        print("VERDICT: some real improvement over baseline - still modest, present cautiously.")

    # --- per-crop stats for confidence bands (used at inference time) ---
    crop_stats = listings.groupby("crop")["price_per_quintal"].agg(["mean", "std", "count"]).round(1)
    crop_stats_dict = crop_stats.to_dict(orient="index")

    joblib.dump(model, "models/price_model.pkl")
    joblib.dump(encoders, "models/price_encoders.pkl")
    with open("models/price_crop_stats.json", "w") as f:
        json.dump(crop_stats_dict, f)

    print("\nSaved: models/price_model.pkl, models/price_encoders.pkl, "
          "models/price_crop_stats.json")


if __name__ == "__main__":
    main()
