# Documentation Registry

## How to Read

Read this registry to determine whether documentation applies to the current task. Read a registered document only when explicitly asked or when its description or tags relate to the work. Do not read documentation just because it is available, and do not read unrelated documents.

## How to Update

- Add an entry when a documentation file other than this registry is created.
- Update its entry when the file is renamed or its purpose changes.
- Remove its entry when the file is deleted.
- Use the exact relative file reference or path as the entry heading.
- Keep descriptions terse and limited to the document's purpose and contents. Do not include technical details.
- Use concise tags that are likely to appear in a related task.

### Entry Format

Add each document using this format:

```md
#### [file-name.md](./file-name.md)

- Description: Very brief description of the document's purpose and contents.
- Tags: `related-topic`, `another-topic`
```

## Registry

#### [project-brief.md](./project-brief.md)

- Description: Purpose, scope, boundaries, and vocabulary of the project.
- Tags: `overview`, `purpose`, `scope`, `vocabulary`, `activity`, `person`, `share`

#### [technical-brief.md](./technical-brief.md)

- Description: Technical foundation, operating model, data ownership, and project-wide conventions.
- Tags: `stack`, `backend`, `frontend`, `expo`, `graphql`, `database`, `docker`, `deploy`, `tests`, `pnpm`, `lint`

#### [workflow.md](./workflow.md)

- Description: Operating rules for agents, including how to get changes live and how to commit.
- Tags: `commit`, `push`, `rebuild`, `deploy`, `docs`, `todo`, `tests`, `database`, `schema`, `migration`

#### [ingestion.md](./ingestion.md)

- Description: How source files become activities, and the rules that keep ingestion safe.
- Tags: `ingestion`, `watcher`, `parser`, `gpx`, `igc`, `skiz`, `reanalysis`, `geocoding`, `concurrency`, `upload`

#### [accounts.md](./accounts.md)

- Description: People, ownership, visibility, and sharing.
- Tags: `accounts`, `people`, `person`, `owner`, `sharing`, `visibility`, `permissions`, `trips`

#### [recorder.md](./recorder.md)

- Description: Phone and browser GPS recording, offline storage, and the upload queue.
- Tags: `recorder`, `recording`, `phone`, `mobile`, `native`, `gps`, `background-location`, `upload-queue`, `offline`

#### [activity-editing.md](./activity-editing.md)

- Description: Web analysis pages and the edits and cleanup tools that change activities.
- Tags: `dashboard`, `activity-detail`, `stats`, `heatmap`, `edit`, `trim`, `outliers`, `elevation`, `lift-detection`, `delete`
