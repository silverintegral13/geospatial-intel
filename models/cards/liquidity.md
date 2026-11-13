# Model card: Liquidity and haircut (3b)

> **SYNTHETIC DATA.** This model was trained on generated data. The metrics show that the pipeline runs and can recover a signal that was built into the generator. They say nothing about accuracy on real Indian collateral.

**Purpose.** For a pledged asset, estimate the chance it sells within 180 days of a bank auction listing, the expected cut from the first reserve price, and the days to sale.

**Training data.** 4,499 auction listings in Gujarat with re-listing history (stand-in for BAANKNET). Train: listed before 2025-10-01. Test: listed after.

**Method.** LightGBM classifier and regressor; Cox proportional-hazards model with unsold listings censored at the cut-off.

## Metrics (hold-out)

| Metric | Value |
| --- | --- |
| AUC, sold within 180 days | 0.633 |
| Base rate, sold within 180 days | 0.417 |
| Haircut MAE | 0.127 |
| Haircut MAE, naive mean | 0.128 |
| C-index, days to sale | 0.631 |
| Test listings | 1138 |

## Known limits

- Selection bias: auctions contain only assets that defaulted and that a bank chose to sell.
- Haircut is measured against the bank's first reserve price, not an independent market value.
- Unsold listings have a haircut 'so far', which understates their final discount.
- Plant and machinery is excluded (not tied to a location).
- Synthetic listings follow a formula the model can partly recover; real data will be noisier.

## Fairness

No demographic variables are used. Mean predictions by region are reported in metrics.json (by_region) so large regional gaps can be reviewed before use.
