# GPX Report

A personal, self-hosted platform for analyzing and visualizing your athletic activity data from GPX files. Built with React and powered by a PostgreSQL backend with PostGIS.

## Problem Statement

The goal is to create a private, self-hosted alternative to services like Strava, giving you full ownership of your location and activity data. This platform will allow you to import GPX files from various activities (running, hiking, cycling, skiing, paragliding, etc.) and analyze them through an intuitive web interface.

## Key Features (v1)

*   **Data Ingestion & Analysis:** Automatically processes GPX files upon import, extracting key metrics and storing them efficiently.
*   **Dashboard Overview:** A central dashboard displaying aggregate statistics across all your activities and trends over time.
*   **Individual Activity Analysis:** Detailed views for each activity, including:
    *   Key metrics (distance, duration, pace, elevation, etc.).
    *   Map visualization of the route.
    *   Elevation profile graph plotted against distance.
*   **Data Ownership:** All your data is stored locally, giving you complete control.
*   **Customizable Re-analysis:** Ability to trigger re-analysis of data from the settings page (e.g., last week, last month, all time).
*   **Technology Stack:**
    *   Frontend: React
    *   Backend API: GraphQL
    *   Database: PostgreSQL with PostGIS
*   **Self-Hosted:** Designed to be run on your own infrastructure.

## Getting Started

```
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000
- GraphQL API: http://localhost:4000/graphql
- Drop `.gpx` files into `data/gpx/` — they're picked up automatically and ingested.

See `docs/SETUP.md` for details.

## Future Considerations (Post v1)

*   More advanced geospatial analysis.
*   Support for other data formats.
*   Social features (if desired, though the focus is personal ownership).
*   Integration with other fitness devices.

## Contributing

(Details on how others can contribute, if applicable)

