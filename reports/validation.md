# Validation and honesty report

> **Read this first.** In this build only the district and village boundaries (and one IBBI figure) are real. 13 of 21 sources fell back to SYNTHETIC data because their hosts could not be reached from the build environment. The models below were trained and tested on that synthetic data. The metrics prove the pipeline runs end to end and that the evaluation design is sound. They are **not** evidence of accuracy on real Indian collateral.

## Data status

| Mode | Sources |
| --- | --- |
| Live (real) | 2 |
| Manual (real, hand-transcribed) | 1 |
| Synthetic fallback | 13 |
| Template only (not collected) | 5 |

## Metrics

| Model | Hold-out design | Metric | Value | Reading |
| --- | --- | --- | --- | --- |
| Liquidity: sold within 180 days | listed before / after 2025-10-01 (time hold-out) | AUC | 0.633 | Modest ranking power; base rate 42% |
| Liquidity: haircut | same | MAE | 0.127 | **Weak**: no better than predicting the mean (0.128) |
| Liquidity: days to sale | same | C-index | 0.631 | Modest (0.5 = chance) |
| Valuation | geographic hold-out: 7 whole districts unseen in training | MAPE | 18.0% | Median error 14.5% |
| Valuation interval | same | 80% interval coverage | 81.3% | Range is x/÷ 1.35 around the median |
| Area score | 5-fold with whole districts held out; plus last year held out | Spearman | 0.90 | Flattering: the synthetic target follows a simple formula; only 33 districts |
| NBFC PD: champion | out-of-time: trained on loans originated before 2024-05-19, tested after | Gini | 0.347 | Existing score |
| NBFC PD: refit, lender fields only | same | Gini | 0.377 | Newer algorithm, same data |
| NBFC PD: challenger | same | Gini | 0.451 | Lift is built into the synthetic book |
| NBFC LGD | resolved defaults in test | MAE | 0.092 | vs 0.126 for a flat LGD |

## Known biases and how a pilot would handle them

- **Circularity of synthetic data.** Outcomes were generated from the same kinds of features the models see. Real data will be noisier and may show no signal for some features.
- **Auction selection bias.** Auction listings contain only assets that defaulted and that a bank chose to sell. Pilot fix: weight by the lender's full collateral population and track a sample of rejected applications.
- **Understated jantri.** Registered and jantri values run below market, so jantri is used as a feature and a floor, never as the target.
- **Bank valuations as labels.** The valuation model learns first reserve prices, which are valuer opinions on distressed assets.
- **Small district sample.** 33 districts cannot support a stable model; an all-India district panel is needed.
- **Censoring.** Unsold listings show a haircut 'so far'. The time-to-sale model handles censoring; the haircut model does not yet.
- **Assumed default probabilities** per asset type drive expected loss and the LTV band until a partner book replaces them.
- **Placeholder plots.** The three plots are points inside real villages, not surveyed parcels.

## Fairness

- No caste, religion, community or other demographic variable is a model feature; a unit test enforces the list.
- Forbidden features found in the NBFC challenger: none.
- Approval rate, default rate and LTV band by region (NBFC lab, challenger at 80% approval):

| Region | Loans | Approval rate | Default rate | Median LTV band | Approval ratio vs best |
| --- | --- | --- | --- | --- | --- |
| Central | 1,791 | 81.2% | 5.5% | 0.71 | 1.00 |
| Kutch | 87 | 78.2% | 6.9% | 0.70 | 0.96 |
| North | 759 | 80.2% | 6.7% | 0.71 | 0.99 |
| Saurashtra | 1,301 | 77.4% | 6.0% | 0.69 | 0.95 |
| South | 1,063 | 81.0% | 5.5% | 0.71 | 1.00 |

Region is a coarse proxy. A lender must repeat this on the protected attributes it holds, under legal guidance.

## Plot valuations vs outside evidence

No outside values supplied. Add listings or site-visit numbers to `data/manual/validation.csv` (template in `data/templates/`).

## What a real pilot would change

1. Replace synthetic auction listings with real BAANKNET and SARFAESI records (hand-collected or via a data agreement).
2. Train the default model on the partner's loan book with an out-of-time hold-out, then run a threshold or randomised pilot to measure recovery lift, not just accuracy.
3. Connect land records through a lender's ULI access, with borrower consent, instead of portal lookups.
4. Have a registered valuer review a sample each month and feed disagreements back as labels.
