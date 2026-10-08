# Recorder

## Purpose

The recorder records a GPS track and uploads it to the server. Recording continues when the screen is locked. The upload waits when the phone is offline.

## Concepts

- The recorder runs only on the phone, with background location. The web app has no recorder, because a browser stops GPS updates when the tab is in the background or the screen locks.
- Before recording starts, the person must set a name. The recorder stores the name when recording starts, so a later name change does not move a recording to a different person.
- The recording states are: recording, paused, stopped, pending, uploaded, and failed.
- Each resume starts a new track segment, so the time in a pause does not count as distance.
- The record screen detects lift rides from the track and leaves them out of the live distance. A ride takes about two minutes to recognize, so its distance counts until then.

## Workflow

- A background task writes each location point directly to an on-device database. The recording does not depend on the UI. The record screen reads new points from the database.
- The record screen stops its timers while the app is in the background and reads the missed points when it returns. On Android, screen updates made in the background wait in memory until the app returns.
- Each point keeps the phone's accuracy estimates for position and altitude. They travel in the GPX as point extensions, and the server does not read them. They are there to diagnose a bad recording.
- The record screen shows the accuracy of the latest point and warns while the signal is weak. After a stop, it shows how many points were weak.
- Stop opens the save form. Resume from the form continues the same recording.
- The save form suggests activity types from the track on the phone, so it works offline. The title is prefilled. The note travels in the GPX `<trk><desc>`, and the server reads it into the activity notes only when the notes are empty.
- Save puts the recording in an upload queue and does not need the server. At upload time, the queue builds the GPX file from the stored points.
- The queue retries at app start, on a network change, when the app comes back to the foreground, and on a timer. It uses exponential backoff with an upper limit.
- Each upload sends the recording id. The server writes the file only one time for each id, so a retry after a lost response does not make a duplicate.

## Phone App Surfaces

- History shows the activities from the server and the recordings that are not uploaded yet, with a manual retry.
- The server processes an upload in the background. Until the activity is in the list, History shows the recording as uploaded and in progress, and asks the server again every few seconds. History also asks again when the app or the screen comes back, and while the server cannot be reached.
- The phone keeps its copy of an uploaded recording until the activity is in the list, then deletes it. A copy whose activity never appears stays on the phone and is not shown.
- History has a form to add an activity by hand, for distance with no recording. It saves on the phone and uploads through the same queue as imported files.
- The activity view on the phone is a short summary. The full analysis is on the web.
- Settings holds the person name, the server address, and the location permission status. Its About section shows the version, build number, channel, and running update, and checks for a new update on request.

## Platform Limits

- On iOS, when the person swipes the app away, iOS stops location updates. When the system suspends or terminates the app, location updates do not stop.
- On Android, after the person swipes the app away, recording continues with a foreground-service notification.
