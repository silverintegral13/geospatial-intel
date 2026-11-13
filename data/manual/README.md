# data/manual

Hand-collected records go here, one CSV per source, using the column layouts in
`data/templates/`. A filled CSV replaces the SYNTHETIC fallback for that source on
the next `make data`.

Only `ibbi_recovery.csv` (real, public aggregate figures) is committed. Everything
else in this folder is git-ignored: do not commit portal scrapes, land records,
or anything that names an owner or borrower.
