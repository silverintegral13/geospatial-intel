# Model card: PD x LGD method demo (3d)

> **SYNTHETIC DATA.** This model was trained on generated data. The metrics show that the pipeline runs and can recover a signal that was built into the generator. They say nothing about accuracy on real Indian collateral.

**Purpose.** Show how default probability and loss severity combine by LTV band and collateral type.

**Training data.** Synthetic NBFC book of 20,000 loans. The intended Freddie Mac / SBA data were not available.

**Method.** Logistic scorecard on LTV, bureau score and collateral type; realised LGD on resolved defaults by LTV band.

## Metrics (hold-out)

| Metric | Value |
| --- | --- |
| Gini, logistic scorecard | 0.413 |

## Known limits

- Not trained on Indian or any real loans.
- Freddie Mac loader is not written; the file cannot be redistributed in any case.

## Fairness

No demographic variables are used.
