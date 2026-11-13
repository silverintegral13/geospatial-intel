# Model card: Area collateral-quality score (3a)

> **SYNTHETIC DATA.** This model was trained on generated data. The metrics show that the pipeline runs and can recover a signal that was built into the generator. They say nothing about accuracy on real Indian collateral.

**Purpose.** Rank districts, villages and H3 cells by how well collateral there is likely to hold up.

**Training data.** District-year panel, 33 districts x 7 years of NPA ratios (stand-in for SLBC Gujarat / RBI BSR tables).

**Method.** Ridge regression on standardised features after removing the state-wide year effect. Village and cell scores are the Ahmadabad district score shifted by fixed points per standard deviation of four features.

## Metrics (hold-out)

| Metric | Value |
| --- | --- |
| R2, districts held out | 0.828 |
| Spearman, districts held out | 0.900 |
| MAE (NPA % points) | 0.779 |
| Spearman, last year held out | 0.924 |

## Known limits

- Small sample: 33 districts. Treat the district score as a prior, not a prediction.
- An all-India district panel would be needed for a stable model.
- The village rule is a documented judgement, not a fitted model; fit it on auction outcomes once real listings exist.
- Gujarat has 34 districts since 2025; Vav-Tharad is still inside Banas Kantha here.

## Fairness

Features are land, infrastructure, hazard and activity only. No population or demographic field enters the score.
