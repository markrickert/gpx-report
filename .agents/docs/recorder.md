# Recorder

## Purpose

The recorder records a GPS track and uploads it to the server. Recording continues when the screen is locked. The upload waits when the phone is offline.

## Concepts

- The recorder runs only on the phone, with background location. The web app has no recorder, because a browser stops GPS updates when the tab is in the background or the screen locks.
- Before recording starts, the person must set a name. The recorder stores the name when recording starts, so a later name change does not move a recording to a different person.
- The recording states are: recording, paused, stopped, pending, uploaded, and failed.
- Each resume starts a new track segment, so the time in a pause does not count as distance.

## Workflow

- A background task writes each location point directly to an on-device database. The recording does not depend on the UI. The record screen reads new points from the database.
- Stop opens the save form. Resume from the form continues the same recording.
- The save form suggests activity types from the track on the phone, so it works offline. The title is prefilled. The note travels in the GPX `<trk><desc>`, and the server reads it into the activity notes only when the notes are empty.
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
