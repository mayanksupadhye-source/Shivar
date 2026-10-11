"""
Nexora Agrotech - Price Estimate model (Model 2).

IMPORTANT, READ THIS FIRST:
Investigation of the actual listings.csv data showed price_per_quintal has
NO meaningful relationship with time (week-of-posting), season (harvest
month), variety, district, or quantity. Correlation of price with time was
effectively zero (~0.0 to -0.1) for every major crop, and a full model using
crop+variety+district+quantity scored R2=0.9335 on held-out data vs
R2=0.9410 for simply predicting the crop's average price - i.e. the extra
features added NOTHING.

Conclusion: genuine price FORECASTING (predicting a future price from a
trend) is not supported by this data - there is no trend to forecast.
This module instead builds a low-confidence PRICE ESTIMATE: a model that is
allowed to use crop, variety, district, and quantity, but which is expected
-- and shown, explicitly, in its own output -- to perform barely better
than just returning the crop's historical average price.

Every prediction is returned ALONGSIDE the trivial crop-mean baseline and a
price range (not a false-precision single number), so nobody downstream
(including you, presenting this to judges) can accidentally overstate what
this does. Label this feature as "Price Estimate", never "Price Forecast",
in the frontend.
"""

import numpy as np
import pandas as pd

FEATURE_COLUMNS = ["crop_enc", "variety_enc", "district_enc", "quantity_tonnes"]


def build_price_features(listing, encoders):
    """listing: dict-like with crop, variety, district, quantity_tonnes.
    encoders: dict of fitted OrdinalEncoders keyed by 'crop','variety','district'.

    Returns (features_dict, has_unseen_category). A tree model was never
    shown an "unknown" code during training, so feeding it one produces an
    unreliable extrapolation (verified: this caused a 38% swing on a test
    case) rather than a graceful fallback. Callers MUST check
    has_unseen_category and fall back to the crop-average baseline when True
    - never trust the model's raw output in that case.
    """
    import pandas as pd

    has_unseen = False

    def safe_encode(col, enc, value):
        nonlocal has_unseen
        classes = list(enc.categories_[0])
        if value in classes:
            return float(enc.transform(pd.DataFrame({col: [value]}))[0][0])
        has_unseen = True
        return 0.0  # placeholder; caller must ignore model output if has_unseen

    features = {
        "crop_enc": safe_encode("crop", encoders["crop"], listing["crop"]),
        "variety_enc": safe_encode("variety", encoders["variety"], listing["variety"]),
        "district_enc": safe_encode("district", encoders["district"], listing["district"]),
        "quantity_tonnes": float(listing["quantity_tonnes"]),
    }
    return features, has_unseen
