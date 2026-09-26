# Ingestion

## Purpose

Ingestion turns source files into activities. It is the only path from a file to the database.

## Sources

- Files that people drop or sync into the data folder.
- Phone uploads, which the server writes as GPX files into the folder of the person who recorded them.
- The supported formats are GPX, IGC (paragliding), and Ski Tracks archives.

## Workflow

- A file watcher watches the data folder and the folder of each person. It ignores the backup copies that edits make.
- At startup, the watcher replays every file that already exists. Then it continues to watch for new files.
- The watcher processes one file at a time, in arrival order.
- Processing parses the file with the parser for its format, computes the statistics, and gets the owner from the folder of the file.
- Processing then writes the activity and its route in one transaction. The relative file path is the key, so processing the same file again is safe.
- Reanalysis runs the same processing again for all activities or for a date range, in small batches.

## Rules

- The activity type comes from the type value in the file. If there is none, it comes from a keyword in the filename. Otherwise it is "Unknown". IGC files are always paragliding. A heuristic suggestion appears later in the web app, not during parsing.
- When a GPX file has track-point extensions, ingestion reads the sensor values (heart rate, cadence, temperature) from them.
- Reverse geocoding gets a place name for the start point from Nominatim. Nominatim allows one request each second and blocks addresses that go over the limit. Only files that arrive after the startup replay request a place name. The replay and reanalysis do not. A lookup failure leaves the place name empty and does not stop ingestion.
- Every ingestion path must limit its concurrency, because the connection pool is small. Unlimited parallel processing uses all connections in the pool. Files then fail with "Connection terminated unexpectedly". That error is a concurrency problem, not a bad file.
