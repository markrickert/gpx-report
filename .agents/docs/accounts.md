# Accounts

## Purpose

Accounts let a small group of people use one deployment. Each person sees their own activities and the activities that others share with them.

## Concepts

- An account is a name only. There are no passwords. The private network is the access control.
- The people are the default person and one person for each subfolder of the data folder. A new subfolder is a new person. A person's first phone upload can create their subfolder.
- A folder name must be lowercase and must not be the same as a web route name.
- Every request identifies a person. The phone sends the name from its settings. The web app sends the person from its URL path. The server treats a request without a valid person as a request from the default person.

## Rules

- **Visibility**: a person sees their own activities and the activities shared with them. Every query that reads activities must apply this filter.
- **Shared activities count fully**: they appear in lists, totals, personal records, streaks, and the heatmap.
- **Ownership**: only the owner can edit, clean up, delete, or share an activity. A person who receives a share sees it read-only.
- **Delete by a recipient**: when a recipient deletes a shared activity, the server removes only their share. The file and the activity stay for the owner.
- **Sharing**: the owner sets the full list of people for an activity. Each name must be an existing person and must not be the owner.
- **Share storage**: the database stores each share by its source file. Shares survive reanalysis. Shares cannot be regenerated from the files.

## Trips

- A trip is a shared training goal. Only the people on a trip can see it, edit it, change who is on it, or delete it. The person who creates a trip is always on it.
- Each person's progress comes from the activities that person can see. The people on a trip see each other's totals only. The visibility rule still decides whose activities a person can list.

## Web Interaction

- The web landing page lists the people. Each person has their own set of pages under their name in the URL.
- The web app keeps a separate API client and cache for each person, so the data of one person never appears on the pages of another.
