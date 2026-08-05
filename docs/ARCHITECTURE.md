# Architecture Overview

This document outlines the architecture of [Your Project Name], a self-hosted platform for analyzing GPX activity data.

## 1. Frontend (React)

*   **Purpose:** Provides the user interface for viewing, analyzing, and managing activity data.
*   **Key Components:**
    *   **Dashboard:** Displays aggregate statistics and a chronological list of activities.
    *   **Activity Detail Page:** Shows detailed metrics, map visualization, and elevation profile for a single activity.
    *   **Settings Page:** Allows users to manage their data, including triggering re-analysis.
*   **Data Interaction:** Communicates with the backend via a GraphQL API.
*   **Mapping:** Utilizes a React mapping library (e.g., `react-leaflet`, `mapbox-gl-js`) for route visualization.
*   **Charting:** Employs a charting library (e.g., `recharts`, `chart.js`) for elevation profiles and other data visualizations.

## 2. Backend API (GraphQL)

*   **Purpose:** Serves as the interface between the React frontend and the data storage/processing layers.
*   **Technology:** GraphQL.
*   **Key Operations:**
    *   **Queries:**
        *   Fetch individual activity details (`activity(id: ID!)`).
        *   Fetch aggregate statistics (`activitySummary`, `aggregatedStatsByType(startDate: String, endDate: String)`).
        *   Fetch paginated/filtered lists of activities (e.g., `activities(limit: Int, offset: Int, activityType: String)`). Returns data sorted reverse-chronologically by default.
    *   **Mutations:**
        *   Trigger re-analysis of data (`reanalyzeAllActivities`, `reanalyzeActivitiesByDateRange(startDate: String, endDate: String)`).
*   **Resolver Logic:** Each GraphQL field will have a resolver function that fetches data from the PostgreSQL database or triggers background processing.

## 3. Database (PostgreSQL with PostGIS)

*   **Purpose:** Stores all processed activity data and route information.
*   **Technology:** PostgreSQL, enhanced with the PostGIS extension for geospatial capabilities.
*   **Key Tables (Conceptual):**
    *   `activities`: Stores core metrics for each activity (ID, timestamps, distance, duration, type, etc.).
    *   `activity_routes`: Stores the geospatial route data for each activity (e.g., using PostGIS `LINESTRING` type).
    *   `activity_metrics`: Stores detailed metrics for each activity (e.g., elevation gain/loss, average/max speed, heart rate, cadence). This could be a separate table or individual columns in `activities` depending on normalization needs.
    *   `activity_summary`: Potentially a materialized view or table storing pre-computed aggregate statistics for quick dashboard loading.
*   **Geospatial Capabilities:** PostGIS will be used to store and efficiently query route geometries.

## 4. Data Ingestion & Processing Pipeline

*   **Purpose:** Handles the parsing of raw GPX files and populates the PostgreSQL database.
*   **Trigger:** This process is initiated when new GPX files are added to a designated directory (managed externally or by a simple file watcher).
*   **Components:**
    *   **GPX Parser:** A script (e.g., Python with `gpxpy`) that reads GPX files and extracts data points and route information.
    *   **Data Transformation:** Calculates metrics (distance, elevation change, speed, pace, etc.) from the raw track data.
    *   **Database Writer:** Inserts the processed data and route geometries into the PostgreSQL/PostGIS database.
*   **Re-analysis:** The `reanalyze` mutation triggers this pipeline to re-process specified data ranges or all data.

## Integration Flow

1.  User adds GPX files to a monitored directory.
2.  The **Data Ingestion Pipeline** detects new files, parses them, processes metrics, and stores data in **PostgreSQL**.
3.  The **React Frontend** makes GraphQL queries to the **Backend API**.
4.  The **Backend API** (GraphQL resolvers) queries the **PostgreSQL Database** for activity details, aggregate stats, or route geometries.
5.  For re-analysis, the **React Frontend** triggers a GraphQL mutation, which instructs the **Backend API** to re-run the **Data Ingestion Pipeline** for specific data ranges.
6.  Map and elevation data are rendered in the **React Frontend** using mapping and charting libraries.

