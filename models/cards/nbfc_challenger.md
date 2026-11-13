# Model card: NBFC challenger PD and collateral LGD

> **SYNTHETIC BOOK.** Collateral conditions were built into the default formula of the generated book, so the challenger's lift is an assumption of the generator, not evidence.

| | Gini | KS |
| --- | --- | --- |
| Champion (existing score) | 0.347 | 0.261 |
| Refit on lender fields only | 0.377 | 0.292 |
| Challenger (+ collateral features) | 0.451 | 0.385 |

Hold-out: out-of-time: trained on loans originated before 2024-05-19, tested after (14,999 train, 5,001 test).

## Mapping to RBI FREE-AI expectations

| Expectation | What this prototype provides | What the lender must add |
| --- | --- | --- |
| Board-approved AI policy | This card, the validation report and the data-source register as inputs | The policy itself and its approval |
| Model risk management | Out-of-time hold-out, champion-challenger comparison, calibration table, documented assumptions | Independent validation, periodic re-validation, model inventory entry |
| Explainability | Top three drivers per loan in plain words; global driver ranking | Adverse-action wording reviewed by compliance |
| Bias testing | No demographic variables; approval rate, default rate and LTV by region (approval ratio vs best region reported) | Tests on protected attributes the lender holds, under legal guidance |
| Drift monitoring | Population stability index, train vs test: 0.003 (under 0.10 is stable) | Monthly monitoring in production with alert thresholds |
| Human oversight | Scores are a second opinion; flagged cases go to a registered valuer and a credit officer | Escalation rules and sign-off limits |
| Data protection (DPDP Act) | Runs locally; loan ids pseudonymised on ingest; name and ID columns dropped | Consent records, retention policy, processor agreement |
