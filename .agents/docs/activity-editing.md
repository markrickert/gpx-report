# Activity Analysis and Editing

## Purpose

This domain covers the web analysis of activities and the edits that change an activity. Edits change the source file, so reanalysis keeps them.

## Analysis

- The dashboard shows totals, trends, activities from the same date in earlier years, and the activity list with route thumbnails.
- The activity detail shows metrics, a map, an elevation profile, the personal records that the activity matches, and matched photos and videos.
- The stats page shows streaks, year-over-year comparison, training load, and personal records by activity type.
- The heatmap shows all visible routes together.

## Edits

- Title, activity type, and trim rewrite the source file. They work for GPX and Ski Tracks files, not for IGC files.
- The database is the only storage for notes.
- Before an edit rewrites a file, the edit keeps a backup copy of the original file beside it. Ingestion ignores these backup copies.
- The page offers to restore the original only when the track's points differ from it (a trim, outlier cleanup, or elevation fix). Title and type edits keep a backup but do not show the offer.
- Only the owner can edit an activity.

## Cleanup Tools

- The cleanup tools are optional. They show a preview of the result before they save. The settings page lists the activities that each detector flags.
- **GPS outlier cleanup** removes points that imply an impossible jump in position. The preview parses a scratch copy with the real parser, so the preview statistics match the saved result. It works for all three formats.
- **Elevation spike fix** replaces short, sharp elevation errors with values interpolated between the nearest good points. It changes only elevation and keeps every point.
- **Lift detection** finds chairlift and gondola rides from the shape of the track. It only detects. It stores and changes nothing. The web app uses it to show elevation gain without lift rides.

## Delete

- For the owner, delete permanently removes the source file and the activity. The web app asks for confirmation first.
- For a share recipient, delete removes only their share.
