# Setup and Installation

This document provides instructions for setting up the development environment and running [Your Project Name].

## Prerequisites

*   **Node.js & npm/yarn:** For the React frontend.
*   **Docker & Docker Compose:** Recommended for managing the PostgreSQL database and potentially the backend API if it's containerized.
*   **Python 3:** For the GPX parsing and data processing scripts.
*   **Git:** For version control.

## 1. Project Structure

\`\`\`
your-project-root/
├── .git/
├── frontend/             # React application
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── graphql/        # GraphQL client setup and queries
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── styles/
│   │   └── App.js
│   └── package.json
├── backend/              # Backend API (e.g., Node.js with Apollo Server, Python with Flask/FastAPI)
│   ├── src/
│   │   ├── graphql/        # GraphQL schema definitions, resolvers
│   │   ├── models/         # Database models/ORM
│   │   ├── services/       # Business logic, GPX processing logic
│   │   └── index.js        # Server entry point
│   ├── docker-compose.yml  # Docker configuration for DB and potentially backend
│   ├── db/                 # Database scripts (schema definitions, migrations)
│   ├── gpx_processor/      # Python scripts for GPX parsing
│   │   ├── __init__.py
│   │   ├── parser.py
│   │   └── processor.py
│   └── package.json        # Backend dependencies
└── README.md
└── docs/
    ├── ARCHITECTURE.md
    ├── DATA_MODEL.md
    ├── FEATURES.md
    └── SETUP.md
\`\`\`

## 2. Database Setup (PostgreSQL with PostGIS)

1.  **Using Docker (Recommended):**
    *   Navigate to the `backend/` directory.
    *   Ensure you have a `docker-compose.yml` file configured for PostgreSQL with PostGIS. Example snippet:
        \`\`\`yaml
        version: '3.8'
        services:
          db:
            image: postgis/postgis:13-3.1 # Use a suitable PostGIS version
            container_name: your-project-db
            ports:
              - "5432:5432"
            environment:
              POSTGRES_USER: youruser
              POSTGRES_PASSWORD: yourpassword
              POSTGRES_DB: yourdbname
            volumes:
              - db_data:/var/lib/postgresql/data

        volumes:
          db_data:
        \`\`\`
    *   Run `docker-compose up -d` in the `backend/` directory.
    *   Connect to the database using a tool like `psql` or pgAdmin.

2.  **Local Installation:**
    *   Install PostgreSQL and the PostGIS extension following your operating system's instructions.
    *   Create a database, user, and grant necessary privileges.

3.  **Schema Initialization:**
    *   Apply the database schema defined in `docs/DATA_MODEL.md`. You may want to create SQL migration scripts within `backend/db/`.
    *   Ensure the PostGIS extension is enabled in your database: `CREATE EXTENSION IF NOT EXISTS postgis;`

## 3. Backend Setup

1.  **Install Dependencies:**
    *   Navigate to the `backend/` directory.
    *   Run `npm install` (or `yarn install`) for Node.js, or `pip install -r requirements.txt` for Python.
2.  **Configure Environment Variables:**
    *   Create a `.env` file in the `backend/` directory for database connection strings, API keys, etc.
    *   Example `.env` for PostgreSQL:
        \`\`\`
        DATABASE_URL=postgresql://youruser:***@localhost:5432/yourdbname
        GRAPHQL_PORT=4000
        GPX_FILES_DIRECTORY=/path/to/your/gpx/files # IMPORTANT: Set this to where you'll put GPX files
        \`\`\`
3.  **Start the Backend Server:**
    *   Run `npm start` (or `yarn start`) or `python index.py`.

## 4. Frontend Setup

1.  **Install Dependencies:**
    *   Navigate to the `frontend/` directory.
    *   Run `npm install` (or `yarn install`).
2.  **Configure API Endpoint:**
    *   Ensure your GraphQL client is configured to point to your backend API endpoint (e.g., `http://localhost:4000/graphql`). This is typically done in `frontend/src/graphql/client.js` or similar.
3.  **Start the Development Server:**
    *   Run `npm start` (or `yarn start`).
    *   The application will typically be available at `http://localhost:3000`.

## 5. Data Ingestion Setup

1.  **Configure GPX Directory:**
    *   Ensure the `GPX_FILES_DIRECTORY` environment variable in your backend `.env` file points to a directory where you will place your `.gpx` files for processing.
2.  **Run the GPX Processor:**
    *   The GPX processing logic (e.g., Python scripts in `backend/gpx_processor/`) should be configured to run periodically or be triggered by file system events (e.g., using libraries like `watchdog` in Python).
    *   You may need to adjust how this processor runs:
        *   **As a separate background service:** Recommended for reliable processing.
        *   **Triggered by API mutation:** The `reanalyze` mutation could explicitly call this script.
        *   **File watcher daemon:** Automatically watches the GPX directory.

## Running the Application

1.  Ensure the database is running.
2.  Start the backend server.
3.  Start the frontend development server.
4.  Place a few `.gpx` files in the configured `GPX_FILES_DIRECTORY`.
5.  Access the frontend in your browser and explore the dashboard. Use the Settings page to trigger re-analysis if needed.

