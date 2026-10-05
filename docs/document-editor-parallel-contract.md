# Markdown editor parallel work contract

## Shared baseline

- Original baseline before preparation: `3e1a12448963d19765d8d52c54ab92338e64a682` (`feat: reorganize creative content sources`).
- The preparation commit is the shared parent of `codex/document-editor-core`, `codex/document-editor-pages`, and `codex/document-editor-acceptance`.
- The preparation includes the pre-existing tracked changes in `WorldBuildingEditor.tsx`, its browser acceptance file and stylesheet, and `screenshots/basic-settings-overview.png`. The untracked candidate/theme screenshots remain local visual artifacts in the primary checkout.
- `D:\Desktop\小说` is immutable. Do not use a formal novel project for write tests. Make disposable project copies under the current worktree's `.runtime` directory.

## File ownership

| Owner | Files |
| --- | --- |
| AI A — shared editor and independent document page | `src/components/editor/DocumentEditingSurface.tsx`, its surface stylesheet, `src/shared/document-editing.ts`, `src/shared/project-documents.ts`, `src/components/editor/VditorProseEditor.tsx` and its kernel stylesheet, `src/components/editor/ProjectDocumentEditor.tsx`, `src/components/editor/ArchFileViewer.tsx`, `src/components/pages/CultivationSettingsPage.tsx`, and focused tests for those files. |
| AI B — business-field pages | `src/components/editor/NovelConfigEditor.tsx`, `src/components/editor/CreativeMaterialsEditor.tsx`, `src/components/editor/LocationManagementEditor.tsx`, `src/components/editor/character-profile/CharacterProfileForm.tsx`, plus their page-local styles and focused tests. AI B consumes the shared surface and does not edit AI A's files. |
| Integration / acceptance | The acceptance worktree owns cross-page acceptance coverage and integration fixes after both branches are ready. It does not own either branch before handoff. |

The shared surface owns only editor chrome and Markdown interaction. Each page keeps its own parameter controls, lists, entity selection and field switching.

## Shared API

`DocumentEditingSurface` is the published entry point. Its required inputs are `documentIdentity`, `layout`, and `content`; it forwards `onChange`, `onSave`, `editable`, and `placeholder`. It also preserves the current callers' `onCharCountChange`, `editorRef`, `jumpTarget`, and `insertRequest` integrations. `showHeadingToc` overrides the layout default. The optional `onActiveHeadingChange` reports the currently active heading as `{ line, index, text }` or `null`; `index` belongs to the complete parsed heading sequence. `className` may add page-specific sizing classes.

- Layout values: `long-document` and `business-field`.
- `showHeadingToc` defaults to `true` for `long-document` and `false` for `business-field`.
- TOC navigation reuses the Markdown parser's complete heading list, keeps H2 visually prominent, and permits H3 groups to collapse without changing jump indexes. If no H2 exists, all parsed headings remain available.
- The surface fills its parent's available width and height, with `min-width: 0` and `min-height: 0`. It must not assume a viewport-sized page; the caller owns surrounding layout and scroll regions.
- Long-document outline is shown on wide layouts by default. At widths of 768 px or less it starts collapsed/hidden and remains available through a compact toggle. Business-field outline remains off by default; a caller may opt in for a long field.
- `editable={false}` is strictly read-only. No edit, insert, save, or persistence action may be initiated by the surface.
- The parent remains the sole persistence owner. The surface forwards Markdown to `onSave`; it does not write files, SQLite rows, or business data.

### Stable document identity

Use the exported helpers from `src/shared/document-editing.ts` and a stable project UUID (`ProjectData.id`), never a project display name or current selection index:

- Project document: `project/<encoded-project-id>/document/<encoded-relative-path-segments>`.
- Entity field: `project/<encoded-project-id>/entity/<encoded-entity-type>/<encoded-entity-id>/field/<encoded-field-id>`.

Each segment is URI-component encoded; project document paths are first normalized by `normalizeProjectDocumentPath`. Change identity whenever the project, document path, entity, or field changes so editor state cannot leak across selections.

## Interface changes and merge order

- Neither owner may change or remove a shared prop unilaterally. Raise the proposed type/signature change to the other owner and integration owner before editing it.
- Prefer a new optional prop with existing behavior as the default. Land that compatible API first, then consume it from page work.
- If a breaking change is unavoidable, pause dependent edits and agree on a replacement baseline before either branch continues. Do not resolve the conflict by silently replacing another owner's files.
- AI A and AI B work from the same preparation commit. Do not merge either branch into the primary checkout during their implementation.

## Development and data isolation

Vite binds to `127.0.0.1`; the checked-in default is port `5180` with `strictPort: true`. Use these ports:

| Worktree | Port | Runtime data root |
| --- | ---: | --- |
| `document-editor-core` | `5181` | `<worktree>/.runtime/document-editor-core/` |
| `document-editor-pages` | `5182` | `<worktree>/.runtime/document-editor-pages/` |
| `document-editor-acceptance` | `5183` | `<worktree>/.runtime/document-editor-acceptance/` |

In each worktree, set `AI_NOVEL_VELA_HOME` to `<runtime-root>/vela` and `AI_NOVEL_DEV_USER_DATA` to `<runtime-root>/user-data` before running `pnpm dev -- --port <port>`. The latter development-only Electron override sets separate `userData`, `sessionData`, and `logs` paths before `requestSingleInstanceLock`; Electron's lock is then isolated per profile. Each runtime root may also contain its own disposable `projects/` fixtures. `.runtime/` is ignored by Git. Do not copy database files between worktrees while an app may have them open.

The project's Vite server uses strict ports, so a collision fails startup rather than moving to a different port. The app uses Electron's existing `requestSingleInstanceLock`; unique development user-data profiles permit independent instances, while launches that reuse a profile keep the existing single-instance behavior. Never terminate another user's or AI's process to free a port or lock.

For browser acceptance in AI A, set `AI_NOVEL_VITEST_BROWSER_API_PORT=63451` and point `TEMP`, `TMP`, and `TMPDIR` to `<runtime-root>/tests/temp`; the cultivation fixture creates and removes its SQLite project beneath the OS temp directory. Screenshots are written under the ignored `output/playwright/` directory.

### Worker launch commands (PowerShell)

Run each command from the actual checkout path returned by the managed worktree tool:

```powershell
# AI A
$runtimeRoot = Join-Path (Get-Location) '.runtime\document-editor-core'
$env:AI_NOVEL_VELA_HOME = Join-Path $runtimeRoot 'vela'
$env:AI_NOVEL_DEV_USER_DATA = Join-Path $runtimeRoot 'user-data'
pnpm dev -- --port 5181
```

```powershell
# AI B
$runtimeRoot = Join-Path (Get-Location) '.runtime\document-editor-pages'
$env:AI_NOVEL_VELA_HOME = Join-Path $runtimeRoot 'vela'
$env:AI_NOVEL_DEV_USER_DATA = Join-Path $runtimeRoot 'user-data'
pnpm dev -- --port 5182
```

```powershell
# Integration / acceptance
$runtimeRoot = Join-Path (Get-Location) '.runtime\document-editor-acceptance'
$env:AI_NOVEL_VELA_HOME = Join-Path $runtimeRoot 'vela'
$env:AI_NOVEL_DEV_USER_DATA = Join-Path $runtimeRoot 'user-data'
pnpm dev -- --port 5183
```

Use only disposable copied projects under the matching runtime root. Never point tests or manual editing at `D:\Desktop\小说` or a formal user project.
