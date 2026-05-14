# GA4 Monthly Content Planning

## Summary
- Projects can now store a dedicated analytics source for content planning.
- The dashboard can generate a monthly 4-week content plan from the connected analytics source.
- Plans can be marked for auto-generation and executed into actual content jobs.
- A cron-ready automation route now generates missing monthly plans and creates due weekly content automatically.

## Project Settings
- Added project-level analytics source settings:
  - `analyticsSourceType`
  - `analyticsSourceId`
  - `analyticsSourceLabel`
  - `analyticsEndpointUrl`
  - `analyticsAccessKey`
  - `analyticsConnectedAt`

## Data Model
- Added `ContentPlan`
- Added `ContentPlanItem`

These store the month key, plan status, analytics basis summary, and weekly planned topics/objectives.

## API
- `POST /api/projects/:projectId/monthly-plan`
  - Generates the current month plan from connected analytics.
  - `autoGenerate: true` stores the plan as scheduled.
- `PATCH /api/projects/:projectId/monthly-plan`
  - Runs the latest plan and creates content jobs.
- `GET /api/automation/monthly-content`
  - Protected by `AUTOMATION_SECRET` or `CRON_SECRET`
  - Generates missing monthly plans and executes due weekly items for projects with auto-generation enabled.

## Automation
- `vercel.json` now schedules `/api/automation/monthly-content` daily.
- The auto runner:
  - creates the current month plan if missing
  - runs only the items due for the current week of the month

## Notes
- Prisma client must be regenerated after schema changes.
- Database schema rollout is still required before production deploy if the target database does not yet have the new columns/tables.
