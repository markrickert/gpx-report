# Project Brief

## Purpose

GPX Report is a personal, self-hosted alternative to Strava. It records, stores, and analyzes GPS activities on a private server, so the people who use it keep full ownership of their location and activity data.

## Scope

- A phone app records GPS tracks in the background and uploads them to the server over the private network.
- The server imports GPX, IGC (paragliding), and Ski Tracks files that people drop or sync into its data folder.
- A web app gives the large-screen analysis: dashboard, activity detail with map and elevation profile, stats, heatmap, and settings.
- A small group of people (a household) share one deployment. Each person has an account with a name only, and can share activities with the others.
- An optional integration matches photos and videos from a private Immich server to activities by time and place.

## Boundaries

- The deployment is private. The network boundary is the only access control. There are no passwords and no public exposure.
- The source files are the source of truth. The database holds data derived from them, with a few exceptions that the technical brief names.
- Every page must work on a desktop browser and on a phone.

## Vocabulary

- **Activity**: one source file, with its statistics and its route.
- **Person**: an account name. The default person owns the files at the top of the data folder. Each other person owns the files in the subfolder with their name.
- **Owner**: the person whose folder holds the source file of an activity.
- **Share**: the owner lets another person count an activity as their own, read-only.
- **Trip**: something a group of people train for, with an end date and a distance goal. Every activity in its window counts toward the goal as equivalent hiking distance.
- **Recording**: a track on the phone that the server does not have yet.
- **Reanalysis**: a new parse of the source files that regenerates the derived data.
