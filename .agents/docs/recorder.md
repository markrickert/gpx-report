# Recorder

## Purpose

The recorder records a GPS track and uploads it to the server. Recording continues when the screen is locked. The upload waits when the phone is offline.

## Concepts

- The recorder runs on the phone with background location. It also runs in a browser, where it records only while the tab is open.
- Before recording starts, the person must set a name. The recorder stores the name when recording starts, so a later name change does not move a recording to a different person.
- The recording states are: recording, paused, stopped, pending, uploaded, and failed.
- Each resume starts a new track segment, so the time in a pause does not count as distance.

## Workflow

- A background task writes each location point directly to an on-device database. The recording does not depend on the UI. The record screen reads new points from the database.
- Save puts the recording in an upload queue and does not need the server. At upload time, the queue builds the GPX file from the stored points.
- The queue retries at app start, on a network change, when the app comes back to the foreground, and on a timer. It uses exponential backoff with an upper limit.
- Each upload sends the recording id. The server writes the file only one time for each id, so a retry after a lost response does not make a duplicate.

## Phone App Surfaces

- History shows the activities from the server and the recordings that are not uploaded yet, with a manual retry.
- The activity view on the phone is a short summary. The full analysis is on the web.
- Settings holds the person name, the server address, and the location permission status.

## Platform Limits

- On iOS, when the person swipes the app away, iOS stops location updates. When the system suspends or terminates the app, location updates do not stop.
- On Android, after the person swipes the app away, recording continues with a foreground-service notification.
