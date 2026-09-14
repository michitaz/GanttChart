# Epic Gantt Chart

A self-contained Salesforce package for planning and visualizing project work as a
Gantt chart: an `Epic__c` (the project) with `Project_Stage__c` bars and
`Milestone__c` diamonds rendered on a month/week timeline, plus filtering,
swim lanes, inline record creation, and a Screen Flow bulk-entry wizard.

Originally built in and deployed to the **Anchored Insight Enterprise** production org
(`anchored_enterprise` CLI alias). Everything needed to stand it up in another org
is in `force-app/`.

---

## What's in the box

### Data model

| Object | Role | Key fields |
| --- | --- | --- |
| `Epic__c` | The project / parent record | `Description__c`, `Account__c` (lookup) |
| `Project_Stage__c` | Timeline bars (master-detail to Epic) | `Start_Date__c`, `End_Date__c`, `Stage_Owner__c`, `System__c`, `Display_Order__c`, `Description__c` |
| `Milestone__c` | Timeline diamonds (master-detail to Epic) | `Due_Date__c`, `Milestone_Description__c`, `Sort_Order__c` |

`Milestone__c`'s Name field is an AutoNumber (`M-{000}`).

### Lightning Web Components

| Component | Exposed | Targets |
| --- | --- | --- |
| `epicGanttChart` | yes | `lightning__RecordPage` (Epic\_\_c), `lightning__AppPage` |
| `epicStageMilestoneBuilder` | yes | `lightning__FlowScreen` |
| `dateRangePicker` | no (child only) | reused by both of the above |

### Apex

`EpicGanttController` — all LWC data access:

- `getGanttData(epicId)` *(cacheable)* — returns stages + milestones for one Epic
- `createProjectStage(...)` / `updateProjectStage(...)`
- `createMilestone(...)` / `updateMilestone(...)`
- `createStagesAndMilestones(epicId, stages, milestones)` — bulk save from the Flow wizard

Covered by `EpicGanttControllerTest`.

### Other metadata

- Flow `Add_Project_Stages_And_Milestones` (screen flow hosting the builder LWC)
- Permission set `Epic_Gantt_Chart_Access` (object, field, tab, Apex, and flow access)
- Tabs + page layouts for all three objects
- `profiles/Admin.profile-meta.xml` — **only** grants Admin FLS on a couple of fields
  that would otherwise be invisible outside Apex (see gotchas). Review before deploying;
  profile deploys merge into the target org's Admin profile.

---

## Feature notes

**Timeline rendering.** CSS grid. The month header sizes each month to its real number
of weeks (`ceil(daysInMonth / 7)`), not a fixed 4, so bars line up with actual dates.

**Bar colors.** Stage bars are colored by `Stage_Owner__c` from a fixed-order categorical
palette; per-swatch text color is picked by WCAG contrast (most slots take black text,
green/violet take white). The chart and the legend read from one shared `_ownerColors`
map — building it twice from two different orderings gives the same owner two colors.

**Swim lanes.** `System__c` (text, defaults to `Salesforce`) groups stages into lanes in
the left gutter. Lanes are bucketed by first appearance, so Display Order drives lane
order and each System gets exactly one lane even when its stages aren't adjacent. Blank
System falls into an "Unassigned" lane.

**Filters.** Multi-select Stage Owner and System dropdowns plus a date-range picker above
the chart. Stages match on *overlap* with the window; milestones match on due date. The
dropdowns are custom checkbox popovers closed via `focusout` + Escape — **not** a
document click listener, which doesn't work reliably through shadow DOM retargeting.

**Inline create.** A "Stages" header cell in the top-left corner carries **+ New Stage**;
the Milestones label cell carries **+ New Milestone**. The Milestones row always renders
(with a filler div spanning `grid-column: 2 / -1` for the dashed axis) so the button
exists before the first milestone. Both reuse the edit modals via `isStageCreate` /
`isMilestoneCreate`. Milestone save calls `refreshApex`; stage save also fires
`RefreshEvent` from `lightning/refresh` to refresh the whole record page.

**Bulk entry.** `epicStageMilestoneBuilder` renders add/remove-able rows for both child
objects and saves in one Apex call, then closes with `FlowNavigationFinishEvent`. All
validation and DML live in Apex rather than declarative Create Records elements — Flow's
dynamic-row support is much weaker.

---

## Deploying to a new org

```bash
sf project deploy start -d force-app -o <your-org-alias>
sf org assign permset -n Epic_Gantt_Chart_Access -o <your-org-alias>
```

Then, manually in Setup:

1. **Create the Quick Action.** Object Manager → Epic → Buttons, Links, and Actions →
   New Action → Action Type: **Flow** → Flow: *Add Project Stages And Milestones* →
   label **Add Stages & Milestones** → Save. (See gotcha below — it can't be created by
   metadata deploy.) Then redeploy `layouts/Epic__c-Epic Layout.layout-meta.xml` to
   surface it as a button.
2. **Place the chart.** Lightning App Builder → Epic record page → drag **Epic Gantt
   Chart** onto the page → Save & Activate.

### Deploy-order caveat

Deploy objects/fields/Apex/LWC **first** and hold back any Layout that references a
brand-new master-detail related list; deploy layouts in a second pass. See gotcha #1.

---

## Gotchas worth knowing

**1. Brand-new custom field/relationship cache lag.** Right after deploying new objects
and fields in one transaction, two things fail even though the schema is genuinely live
(confirmed via `Schema.describe()`):

- A Layout deploy referencing a new master-detail child's related list
  (`<relatedList>Child__r</relatedList>`) fails with *"Cannot find related list"* —
  retries over ~10 minutes didn't clear it.
- Anonymous Apex referencing a brand-new field by dot notation fails to **compile**
  (*"Field does not exist"*), even when other fields from the same deploy compile fine.
  The Apex compiler's schema cache appears to warm per-field on first successful
  compile, not on field creation.

Both are Salesforce-side eventual consistency, not real errors; they normally clear
within an hour. The Setup UI path (Object Manager → Page Layouts → drag the related list
on) doesn't hit this cache and works immediately.

**2. AutoNumber `startingNumber` is ignored on update.** `CustomObject.nameField` does
accept `<startingNumber>`, but Salesforce only honors it the moment the field is first
converted from Text to AutoNumber. Redeploying an *already-AutoNumber* name field with a
new starting number deploys cleanly and silently does nothing. Fix: deploy
`<type>Text</type>` first, then redeploy `<type>AutoNumber</type>` with the desired
`<startingNumber>` — the reconversion is treated as a fresh creation and seeds correctly.

**3. Flow-type Quick Actions can't be deployed via Metadata API.** `optionsCreateFeedItem`
on a `<type>Flow</type>` QuickAction is contradictory — the deploy rejects it as both
*"cannot be set for type Flow"* (when present, at any value) and *"Required field is
missing"* (when absent), deterministically. No XML combination passes. Create the action
once via Setup UI; after that it exists as a real record and further metadata edits
deploy fine. `quickActions/Epic__c.Add_Stages_And_Milestones.quickAction-meta.xml` is
included here for reference and for post-creation edits — expect it to fail on a first
deploy into a fresh org.

**4. New custom fields need Admin profile FLS explicitly.** Fields deployed with FLS only
on `Epic_Gantt_Chart_Access` are invisible to an admin who isn't assigned that permission
set — everywhere except Apex, which ignores FLS. `sf data query`, `sf sobject describe`,
and anonymous Apex all report `No such column 'Foo__c'`, which reads exactly like the
field doesn't exist. Confirm with:

```bash
sf data query -o <org> -q "SELECT Field, Parent.Name FROM FieldPermissions WHERE SobjectType='Project_Stage__c'"
```

In this repo, `Project_Stage__c.Display_Order__c` and `.Description__c` are still **not**
on the Admin profile — smoke-test them through `getGanttData()` (system mode) instead of
direct SOQL.

**5. Anonymous Apex can't exercise `AuraHandledException` paths.** It surfaces as
`System.LimitException: Can only throw this exception type from VisualForce or Aura
context`. Wrap smoke tests in `Database.setSavepoint()` / `Database.rollback(sp)` so you
don't leave junk records on real Epics.

**6. `@api` properties on Flow Screen components need explicit `targetConfigs`.** Flow's
"auto-discover `@api` properties" doesn't work — without an explicit `<property>` tag,
`recordId` errors with *"We can't find this input attribute."*

**7. Existing stages often have a null `Display_Order__c`,** and `getGanttData` orders
`ASC NULLS LAST`, so pre-filling a new stage's Display Order with `1` sorts it above
every existing stage. `_nextDisplayOrder` returns `''` unless at least one sibling
already has a value.
