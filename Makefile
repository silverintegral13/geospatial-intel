PY ?= python
.PHONY: all data features train report site app test lint hooks assets scan

all: data features train report assets site test

data:      ## ingest every source (live when reachable, labelled synthetic fallback otherwise)
	$(PY) -m bhoomipulse.ingest.run_all
features:  ## build the feature store (H3 cell, village, district, plot)
	$(PY) -m bhoomipulse.features.build
train:     ## train models, write metrics.json and model cards; build NBFC lab outputs
	$(PY) -m bhoomipulse.models.train_all
report:    ## collateral reports (JSON + HTML + PDF) and validation report
	$(PY) -m bhoomipulse.report.build
assets:    ## charts and tables for the deck
	$(PY) -m bhoomipulse.site.assets
site:      ## static demo site for GitHub Pages
	$(PY) -m bhoomipulse.site.build
app:
	streamlit run app/main.py
test:
	$(PY) -m pytest -q
lint:
	ruff check .
hooks:     ## install the pre-commit guard (large files, secrets, restricted data)
	cp scripts/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
scan:      ## scan the full git history for secrets / restricted files
	$(PY) scripts/precommit_guard.py --history
