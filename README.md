# GPX Report

A personal, self-hosted platform for analyzing and visualizing your athletic activity data from GPX, IGC, and Ski Tracks (`.skiz`) files. Built with React and powered by a PostgreSQL backend with PostGIS.

## Problem Statement

The goal is to create a private, self-hosted alternative to services like Strava, giving you full ownership of your location and activity data. This platform will allow you to import activity files (running, hiking, cycling, skiing, paragliding, etc.) and analyze them through an intuitive web interface.

## Key Features

*   **Data Ingestion & Analysis:** Automatically processes `.gpx`, `.igc`, and `.skiz` files on import (dropped in manually or synced via Syncthing), extracting key metrics and storing them efficiently. Re-processing the same file is idempotent, so it's safe to re-sync or re-run.
*   **Dashboard Overview:** A central dashboard displaying aggregate statistics across all your activities and trends over time.
*   **Individual Activity Analysis:** Detailed views for each activity, including:
    *   Key metrics (distance, duration, pace, elevation, etc.).
    *   Map visualization of the route (dark/light mode aware).
    *   Elevation profile graph plotted against distance.
    *   Title/activity-type/trim editing, re-written back to the source `.gpx`/`.skiz` file (not supported for `.igc`).
*   **Data Ownership:** All your data is stored locally, giving you complete control.
*   **Customizable Re-analysis:** Ability to trigger re-analysis of data from the settings page (e.g., last week, last month, all time).
*   **Responsive UI:** Usable on both desktop and mobile — the dashboard is designed to be checked from a phone.
*   **Dark/Light Mode:** Toggleable theme, synced to the embedded code-server editor as well.
*   **Technology Stack:**
    *   Frontend: React (Vite), `react-leaflet` for maps, `recharts` for elevation charts
    *   Backend API: GraphQL (Apollo Server), plain Node/ESM, no ORM
    *   Database: PostgreSQL with PostGIS
*   **Self-Hosted:** Designed to run on your own infrastructure (e.g. a Proxmox LXC behind Caddy); optional Syncthing service syncs GPX files from a phone automatically.

## Getting Started

```
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000
- GraphQL API: http://localhost:4000/graphql
- Postgres/PostGIS: localhost:5432
- Syncthing GUI (optional, for phone sync): `docker compose up -d syncthing` — http://localhost:8384
- Drop `.gpx`, `.igc`, or `.skiz` files into `data/gpx/` — they're picked up automatically and ingested.

See `docs/SETUP.md` for full setup/deployment details, `CLAUDE.md` for architecture and dev workflow notes.

## Future Considerations

*   More advanced geospatial analysis.
*   Support for other data formats.
