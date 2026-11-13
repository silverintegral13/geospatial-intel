# Model card: Valuation range (3c)

> **SYNTHETIC DATA.** This model was trained on generated data. The metrics show that the pipeline runs and can recover a signal that was built into the generator. They say nothing about accuracy on real Indian collateral.

**Purpose.** Estimate a value per sq m as a median and an 80 % interval, and compare it with the jantri rate.

**Training data.** 4,499 auction listings (first reserve price per sq m, set by a bank valuer). Train 2,863, calibration 931, test 705 listings in 7 unseen districts.

**Method.** LightGBM on log price per sq m; split-conformal interval from calibration-district residuals (implemented directly).

## Metrics (hold-out)

| Metric | Value |
| --- | --- |
| MAPE | 0.180 |
| Median APE | 0.145 |
| 80 % interval coverage | 0.813 |
| Interval half-width (x/÷) | 1.349 |
| Median value / jantri | 2.193 |

## Known limits

- Reserve prices are bank valuations of distressed assets, not sale prices of ordinary transactions.
- Conformal coverage assumes test data resemble calibration data; across districts it can drift.
- Rural intervals are wide by design; the product reports a range, never a point.
- Jantri is a feature, not a target, because registered values are understated.

## Fairness

No demographic variables are used. Error by asset type is in metrics.json (by_asset_type).
