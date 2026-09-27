# GPX Report

A personal, self-hosted platform for recording, analyzing, and visualizing your personal activity data. It includes:

1. A react-native mobile phone app records GPS tracks in the background. It stores the data locally on the device and uploads it to your server whenever possible.
2. A web UI on your own server handles analysis and integration.

The goal is to be a privacy-focused, self-hosted alternative to apps and services that track your workout data. `gpx-report` ensures you retain full ownership of your location and activity data instead of giving it to a corporation. 

## Key Features

*   **Private Activity Recorder:** An iOS/Android app acts as your activity tracker and records your route with background GPS (screen locked), stores it on the phone, and uploads it to your server whenever it's reachable - great for those out-of-cell-range hikes!
*   **Dashboard Overview:** A central dashboard displaying aggregate statistics across all your activities and trends over time.
*   **Individual Activity Analysis:** Detailed views for each activity.
*   **Data Ownership:** All your data is stored locally, giving you complete control.
*   **Self-Hosted:** Designed to run on your own infrastructure (e.g. a Linux host running Docker, behind a reverse proxy on a private network).

## Getting Started

```
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000
- GraphQL API: http://localhost:3000/graphql (also directly on http://localhost:4000/graphql)
- Postgres/PostGIS: localhost:5432
- Phone app: build it from `frontend/` — see `docs/SETUP.md` §6.
- Drop `.gpx`, `.igc`, or `.skiz` files into `data/gpx/` — they're picked up automatically and ingested.

See `docs/SETUP.md` for full setup/deployment details, `.agents/docs/` for architecture and dev workflow notes.