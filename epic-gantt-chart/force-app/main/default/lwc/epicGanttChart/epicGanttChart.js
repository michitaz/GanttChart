import { LightningElement, api, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { RefreshEvent } from 'lightning/refresh';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getGanttData from '@salesforce/apex/EpicGanttController.getGanttData';
import updateProjectStage from '@salesforce/apex/EpicGanttController.updateProjectStage';
import updateMilestone from '@salesforce/apex/EpicGanttController.updateMilestone';
import createProjectStage from '@salesforce/apex/EpicGanttController.createProjectStage';
import createMilestone from '@salesforce/apex/EpicGanttController.createMilestone';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

// Bar colour carries phase, not owner: the same kind of work reads the same colour
// everywhere on the timeline. Order matters — the first rule that matches a stage
// name wins, so UAT is tested before Data Blend ("Data Blend UAT" is a UAT bar) and
// Data Blend before the generic Build rule ("Data Blend Build-Out" is a Data Blend
// bar). Every hue clears 6:1 against the shared near-black bar text.
const PHASE_RULES = [
    { key: 'uat', label: 'UAT', hex: '#e99b7b', match: /\buat\b|user acceptance/ },
    { key: 'qa', label: 'QA / Testing', hex: '#5e91cb', match: /\bqa\b|\btest/ },
    { key: 'validation', label: 'Validation & Verification', hex: '#65bfa1', match: /validat|verif/ },
    { key: 'dataBlend', label: 'Data Blend', hex: '#f2c25a', match: /data blend/ },
    { key: 'build', label: 'Build / Implementation', hex: '#75a7e4', match: /build|implement|\bdev\b|config/ }
];

// Anything the rules don't recognise gets one neutral slate rather than a new hue,
// so an unclassified stage reads as "uncategorised" instead of as its own phase.
const OTHER_PHASE = { key: 'other', label: 'Other', hex: '#9fb3bd' };

const BAR_TEXT = '#0b0b0b';

function phaseFor(stage) {
    const name = (stage.Name || '').toLowerCase();
    return PHASE_RULES.find((rule) => rule.match.test(name)) || OTHER_PHASE;
}

// Label column shrinks on narrow viewports; week columns have a pixel floor but
// otherwise share the leftover width equally so the grid always fills its region.
const LABEL_COLUMN_MIN_PX = 140;
const LABEL_COLUMN_MAX_PX = 150;
const WEEK_COLUMN_MIN_PX = 32;

// Hover card geometry: it flips below the bar when there isn't room above, and its
// center is clamped so a bar near either viewport edge doesn't push it off-screen.
const TOOLTIP_MAX_WIDTH_PX = 320;
const TOOLTIP_FLIP_THRESHOLD_PX = 170;
// The milestone card overlays a clamped description, so it gets more room than the
// bar card, which only has to sit above a bar.
const MILESTONE_TOOLTIP_MAX_WIDTH_PX = 360;

// Stages carry a System; those with none still need a lane to live in.
// How many week columns a milestone stack may reach into on each side. Its real
// span is whatever its neighbours leave free, capped here so a lone milestone on a
// wide chart doesn't sprawl across a whole month.
const MILESTONE_MAX_SIDE_SPAN = 2;

const UNASSIGNED_LANE = 'Unassigned';

// Mirrors the Project_Stage__c.System__c field default, so a stage created from the
// chart lands in the same lane as one created any other way.
const DEFAULT_SYSTEM = 'Salesforce';

function laneLabelFor(stage) {
    return (stage.System__c || '').trim() || UNASSIGNED_LANE;
}

function parseSfDate(dateStr) {
    // Salesforce Date fields serialize as 'YYYY-MM-DD'; construct in local time
    // to avoid the off-by-one day shift that new Date('YYYY-MM-DD') causes.
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function daysInMonth(year, monthIndex0) {
    return new Date(year, monthIndex0 + 1, 0).getDate();
}

function weeksInMonth(year, monthIndex0) {
    return Math.ceil(daysInMonth(year, monthIndex0) / 7);
}

function formatShortDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatLongDate(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default class EpicGanttChart extends LightningElement {
    @api recordId;

    stages = [];
    milestones = [];
    error;
    wiredGanttResult;

    tooltip;
    tooltipStyle = '';

    // Empty selection arrays mean "no restriction", not "nothing matches".
    selectedOwners = [];
    selectedSystems = [];
    filterStartDate;
    filterEndDate;
    openFilter;
    filtersExpanded = false;

    isModalOpen = false;
    isStageCreate = false;
    modalSaving = false;
    modalError;
    modalStageId;
    modalStageName;
    modalOriginalStageName;
    modalStartDate;
    modalEndDate;
    modalOwner;
    modalDescription;
    modalDisplayOrder;
    modalSystem;

    isMilestoneModalOpen = false;
    isMilestoneCreate = false;
    milestoneModalSaving = false;
    milestoneModalError;
    milestoneModalId;
    milestoneModalName;
    milestoneModalDueDate;
    milestoneModalDescription;
    milestoneModalSortOrder;

    @wire(getGanttData, { epicId: '$recordId' })
    wiredGantt(result) {
        this.wiredGanttResult = result;
        const { data, error } = result;
        if (data) {
            this.stages = data.stages || [];
            this.milestones = data.milestones || [];
            this.error = undefined;
        } else if (error) {
            this.error = error.body ? error.body.message : error.message;
            this.stages = [];
            this.milestones = [];
        }
    }

    get hasError() {
        return !!this.error;
    }

    get isEmpty() {
        return !this.error && this.stages.length === 0 && this.milestones.length === 0;
    }

    get visibleStages() {
        return this.stages.filter((stage) => {
            if (this.selectedOwners.length && !this.selectedOwners.includes(stage.Stage_Owner__c)) {
                return false;
            }
            if (this.selectedSystems.length && !this.selectedSystems.includes(laneLabelFor(stage))) {
                return false;
            }
            // A stage counts as in range if it overlaps the window at all, not only if
            // it sits entirely inside it. ISO date strings compare correctly as text.
            if (this.filterStartDate && stage.End_Date__c < this.filterStartDate) {
                return false;
            }
            if (this.filterEndDate && stage.Start_Date__c > this.filterEndDate) {
                return false;
            }
            return true;
        });
    }

    get visibleMilestones() {
        // Owner and System live on stages only, so milestones answer to the date window.
        return this.milestones.filter((ms) => {
            if (this.filterStartDate && ms.Due_Date__c < this.filterStartDate) {
                return false;
            }
            if (this.filterEndDate && ms.Due_Date__c > this.filterEndDate) {
                return false;
            }
            return true;
        });
    }

    get hasData() {
        return !this.error && (this.visibleStages.length > 0 || this.visibleMilestones.length > 0);
    }

    get showFilterBar() {
        return !this.error && !this.isEmpty;
    }

    get noMatches() {
        return !this.error && !this.isEmpty && !this.hasData;
    }

    // Guards against an orphaned bar if the last record disappears while it's open.
    get showFilterControls() {
        return this.showFilterBar && this.filtersExpanded;
    }

    get filtersToggleLabel() {
        return this.filtersExpanded ? 'Hide Filters' : 'Filters';
    }

    get filtersToggleClass() {
        return `filters-toggle${this.filtersExpanded ? ' filters-toggle_open' : ''}`;
    }

    // Surfaced as a badge so active filters stay visible once the bar is collapsed.
    get activeFilterCount() {
        return (
            (this.selectedOwners.length ? 1 : 0) +
            (this.selectedSystems.length ? 1 : 0) +
            (this.filterStartDate || this.filterEndDate ? 1 : 0)
        );
    }

    handleToggleFilters() {
        this.filtersExpanded = !this.filtersExpanded;
        if (!this.filtersExpanded) {
            this.openFilter = undefined;
        }
    }

    get hasActiveFilters() {
        return !!(
            this.selectedOwners.length ||
            this.selectedSystems.length ||
            this.filterStartDate ||
            this.filterEndDate
        );
    }

    get ownerOptions() {
        const owners = [];
        this.stages.forEach((stage) => {
            if (stage.Stage_Owner__c && !owners.includes(stage.Stage_Owner__c)) {
                owners.push(stage.Stage_Owner__c);
            }
        });
        return owners.map((owner) => ({
            key: owner,
            value: owner,
            label: owner,
            checked: this.selectedOwners.includes(owner)
        }));
    }

    get systemOptions() {
        const systems = [];
        this.stages.forEach((stage) => {
            const label = laneLabelFor(stage);
            if (!systems.includes(label)) {
                systems.push(label);
            }
        });
        return systems.map((sys) => ({
            key: sys,
            value: sys,
            label: sys,
            checked: this.selectedSystems.includes(sys)
        }));
    }

    get ownerFilterLabel() {
        return this._summarize(this.selectedOwners, 'All owners', 'owners');
    }

    get systemFilterLabel() {
        return this._summarize(this.selectedSystems, 'All systems', 'systems');
    }

    _summarize(selected, allLabel, noun) {
        if (!selected.length) {
            return allLabel;
        }
        return selected.length === 1 ? selected[0] : `${selected.length} ${noun}`;
    }

    get ownerFilterClass() {
        return `filter-trigger${this.selectedOwners.length ? ' filter-trigger_active' : ''}`;
    }

    get systemFilterClass() {
        return `filter-trigger${this.selectedSystems.length ? ' filter-trigger_active' : ''}`;
    }

    get isOwnerFilterOpen() {
        return this.openFilter === 'owner';
    }

    get isSystemFilterOpen() {
        return this.openFilter === 'system';
    }

    handleToggleOwnerFilter() {
        this.openFilter = this.openFilter === 'owner' ? undefined : 'owner';
    }

    handleToggleSystemFilter() {
        this.openFilter = this.openFilter === 'system' ? undefined : 'system';
    }

    handleOwnerOptionChange(event) {
        this.selectedOwners = this._toggleValue(
            this.selectedOwners,
            event.target.dataset.value,
            event.target.checked
        );
    }

    handleSystemOptionChange(event) {
        this.selectedSystems = this._toggleValue(
            this.selectedSystems,
            event.target.dataset.value,
            event.target.checked
        );
    }

    _toggleValue(list, value, checked) {
        if (checked) {
            return list.includes(value) ? list : [...list, value];
        }
        return list.filter((v) => v !== value);
    }

    handleFilterRangeChange(event) {
        const { startDate, endDate } = event.detail;
        this.filterStartDate = startDate || undefined;
        this.filterEndDate = endDate || undefined;
    }

    // Close when focus leaves the dropdown entirely. Outside-*click* detection is not
    // reliable here: a document-level listener sees our shadow-internal clicks
    // retargeted to the host, so it would close the menu on every checkbox tick.
    handleFilterBlur(event) {
        const next = event.relatedTarget;
        if (!next || !event.currentTarget.contains(next)) {
            this.openFilter = undefined;
        }
    }

    handleFilterKeyDown(event) {
        if (event.key === 'Escape') {
            this.openFilter = undefined;
        }
    }

    handleClearFilters() {
        this.selectedOwners = [];
        this.selectedSystems = [];
        this.filterStartDate = undefined;
        this.filterEndDate = undefined;
        this.openFilter = undefined;
    }

    get containerStyle() {
        const totalWeeks = this.columns.length;
        // min-width is the point below which the columns can no longer shrink, so
        // .gantt-scroll starts scrolling horizontally instead of squashing weeks.
        const minWidth = LABEL_COLUMN_MIN_PX + totalWeeks * WEEK_COLUMN_MIN_PX;
        return [
            `grid-template-columns: minmax(${LABEL_COLUMN_MIN_PX}px, ${LABEL_COLUMN_MAX_PX}px)`,
            ` repeat(${totalWeeks}, minmax(${WEEK_COLUMN_MIN_PX}px, 1fr));`,
            ` min-width: ${minWidth}px;`
        ].join('');
    }

    get months() {
        if (!this.hasData) {
            return [];
        }
        const { minDate, maxDate } = this._dateRange;

        const months = [];
        let y = minDate.getFullYear();
        let m = minDate.getMonth();
        const endY = maxDate.getFullYear();
        const endM = maxDate.getMonth();
        let colCursor = 0;

        while (y < endY || (y === endY && m <= endM)) {
            const weekCount = weeksInMonth(y, m);
            months.push({
                key: `${y}-${m}`,
                year: y,
                monthIndex0: m,
                label: `${MONTH_NAMES[m]} ${y}`,
                weekCount,
                startColIndex: colCursor
            });
            colCursor += weekCount;
            m += 1;
            if (m > 11) {
                m = 0;
                y += 1;
            }
        }
        return months;
    }

    get monthHeaderCells() {
        return this.months.map((month) => {
            const startCol = month.startColIndex + 2; // +1 for label col, +1 for 1-based grid lines
            const endCol = startCol + month.weekCount;
            return {
                key: month.key,
                label: month.label,
                style: `grid-column: ${startCol} / ${endCol}; grid-row: 1;`
            };
        });
    }

    get weekHeaderCells() {
        const cells = [];
        this.months.forEach((month) => {
            for (let w = 0; w < month.weekCount; w += 1) {
                const col = month.startColIndex + w + 2;
                cells.push({
                    key: `${month.key}-w${w}`,
                    label: `Wk ${w + 1}`,
                    style: `grid-column: ${col}; grid-row: 2;`
                });
            }
        });
        return cells;
    }

    get columns() {
        // Flat list of every week column across every month, used only for count.
        const cols = [];
        this.months.forEach((month) => {
            for (let w = 0; w < month.weekCount; w += 1) {
                cols.push({ month: month.key, week: w });
            }
        });
        return cols;
    }

    get _dateRange() {
        const allDates = [];
        this.visibleStages.forEach((s) => {
            allDates.push(parseSfDate(s.Start_Date__c));
            allDates.push(parseSfDate(s.End_Date__c));
        });
        this.visibleMilestones.forEach((ms) => {
            allDates.push(parseSfDate(ms.Due_Date__c));
        });
        const times = allDates.map((d) => d.getTime());
        return {
            minDate: new Date(Math.min(...times)),
            maxDate: new Date(Math.max(...times))
        };
    }

    _gridColumnForDate(date) {
        const month = this.months.find(
            (m) => m.year === date.getFullYear() && m.monthIndex0 === date.getMonth()
        );
        const weekIdx = Math.floor((date.getDate() - 1) / 7);
        return month.startColIndex + weekIdx + 2;
    }

    get _laneGroups() {
        // Apex already ordered the stages by Display Order then Start Date. Grouping by
        // first appearance keeps that as the lane order and guarantees one lane per
        // System, even when two stages of the same System aren't adjacent in that sort.
        const byLane = new Map();
        this.visibleStages.forEach((stage) => {
            const label = laneLabelFor(stage);
            if (!byLane.has(label)) {
                byLane.set(label, []);
            }
            byLane.get(label).push(stage);
        });
        return Array.from(byLane.entries()).map(([label, stages]) => ({ label, stages }));
    }

    get _orderedStages() {
        return this._laneGroups.reduce((all, group) => all.concat(group.stages), []);
    }

    get laneRows() {
        let cursor = 3; // rows 1-2 are the month/week headers
        return this._laneGroups.map((group, idx) => {
            const startRow = cursor;
            cursor += group.stages.length;
            const rowSpan = `grid-row: ${startRow} / ${cursor};`;
            const alt = idx % 2 === 1 ? ' lane-alt' : '';
            return {
                key: group.label,
                label: group.label,
                labelClass: `lane-label${alt}`,
                bandClass: `lane-band${alt}`,
                labelStyle: `grid-column: 1; ${rowSpan}`,
                bandStyle: `grid-column: 2 / -1; ${rowSpan}`
            };
        });
    }

    get stageRows() {
        return this._orderedStages.map((stage, idx) => {
            const phase = phaseFor(stage);
            const start = parseSfDate(stage.Start_Date__c);
            const end = parseSfDate(stage.End_Date__c);
            const startCol = this._gridColumnForDate(start);
            const endCol = this._gridColumnForDate(end) + 1;
            const rowNum = idx + 3; // rows 1-2 are the month/week headers

            // The bar truncates long names with an ellipsis; the hover card carries the
            // full text visually and aria-label carries it for screen readers.
            const dateRange = `${formatLongDate(start)} – ${formatLongDate(end)}`;

            return {
                id: stage.Id,
                name: stage.Name,
                barLabel: stage.Stage_Owner__c ? `${stage.Name} (${stage.Stage_Owner__c})` : stage.Name,
                ownerLabel: stage.Stage_Owner__c,
                ariaLabel: `${stage.Name}. ${phase.label}. ${dateRange}. Owner: ${stage.Stage_Owner__c}.`,
                barStyle: `grid-column: ${startCol} / ${endCol}; grid-row: ${rowNum}; background-color: ${phase.hex}; color: ${BAR_TEXT};`
            };
        });
    }

    get legend() {
        // Listed in PHASE_RULES order rather than first-appearance order, so the key
        // reads as a fixed sequence of phases instead of a chart-specific jumble.
        const present = new Set(this._orderedStages.map((stage) => phaseFor(stage).key));
        return [...PHASE_RULES, OTHER_PHASE]
            .filter((phase) => present.has(phase.key))
            .map((phase) => ({
                key: phase.key,
                owner: phase.label,
                style: `background-color: ${phase.hex};`
            }));
    }

    get milestoneRowNum() {
        return this.stageRows.length + 4; // +1 gap row after the last stage
    }

    get milestonesLabelStyle() {
        return `grid-column: 1; grid-row: ${this.milestoneRowNum};`;
    }

    get gridRowCount() {
        return this.hasMilestones ? this.milestoneRowNum : this.stageRows.length + 2;
    }

    get milestoneColumns() {
        // Milestones that land in the same week share one grid cell, so group them
        // into a single stack per column instead of drawing them on top of each other.
        // Apex already returns them ordered by Due Date, then Sort Order, then Name.
        const rowNum = this.milestoneRowNum;
        const byColumn = new Map();

        this.visibleMilestones.forEach((ms) => {
            const date = parseSfDate(ms.Due_Date__c);
            const col = this._gridColumnForDate(date);
            if (!byColumn.has(col)) {
                byColumn.set(col, []);
            }
            byColumn.get(col).push({
                id: ms.Id,
                dateLabel: formatShortDate(date),
                description: ms.Milestone_Description__c,
                ariaLabel: `${formatLongDate(date)}. ${ms.Milestone_Description__c}. Click to edit.`
            });
        });

        // A stack pinned to its own week column is only ~40px wide, which is what wraps
        // the date pill onto two lines. Let each one spread into the free week columns
        // around it instead. The span has to stay symmetric: the diamond sits at the
        // centre of the span, so an off-centre span would draw it over the wrong week.
        // Because the columns are 1fr, stacks widen on a wide chart and squeeze back
        // down as the window narrows, on their own.
        const cols = Array.from(byColumn.keys()).sort((a, b) => a - b);
        const firstCol = 2; // column 1 is the lane gutter
        const lastCol = this.columns.length + 1;

        const spans = cols.map((col, i) => {
            // Against a neighbour, take at most half the free columns between us and
            // leave one clear; against the chart edge, take everything available.
            const roomLeft =
                i === 0 ? col - firstCol : Math.floor((col - cols[i - 1] - 2) / 2);
            const roomRight =
                i === cols.length - 1 ? lastCol - col : Math.floor((cols[i + 1] - col - 2) / 2);
            return Math.max(0, Math.min(MILESTONE_MAX_SIDE_SPAN, roomLeft, roomRight));
        });

        return cols.map((col, i) => ({
            key: `milestone-col-${col}`,
            markers: byColumn.get(col),
            style: `grid-column: ${col - spans[i]} / ${col + spans[i] + 1}; grid-row: ${rowNum};`
        }));
    }

    get hasMilestones() {
        return this.visibleMilestones.length > 0;
    }

    get milestoneAxisStyle() {
        return `grid-column: 2 / -1; grid-row: ${this.milestoneRowNum};`;
    }

    get stagesHeaderStyle() {
        return 'grid-column: 1; grid-row: 1 / 3;';
    }

    get stageModalTitle() {
        return this.isStageCreate ? 'New Stage' : `Edit ${this.modalOriginalStageName}`;
    }

    get milestoneModalTitle() {
        return this.isMilestoneCreate ? 'New Milestone' : `Edit Milestone ${this.milestoneModalName}`;
    }

    handleBarEnter(event) {
        const stage = this.visibleStages.find((s) => s.Id === event.currentTarget.dataset.id);
        if (!stage) {
            return;
        }
        const start = parseSfDate(stage.Start_Date__c);
        const end = parseSfDate(stage.End_Date__c);
        this.tooltip = {
            name: stage.Name,
            dateRange: `${formatLongDate(start)} – ${formatLongDate(end)}`,
            owner: stage.Stage_Owner__c,
            description: stage.Description__c
        };

        // position: fixed against the bar's viewport rect, so the horizontally
        // scrolling .gantt-scroll can't clip the card.
        const rect = event.currentTarget.getBoundingClientRect();
        const flipBelow = rect.top < TOOLTIP_FLIP_THRESHOLD_PX;
        const half = TOOLTIP_MAX_WIDTH_PX / 2;
        const centerX = Math.min(
            Math.max(rect.left + rect.width / 2, half + 8),
            Math.max(window.innerWidth - half - 8, half + 8)
        );
        const y = flipBelow ? rect.bottom + 8 : rect.top - 8;
        this.tooltipStyle = [
            `left: ${Math.round(centerX)}px;`,
            ` top: ${Math.round(y)}px;`,
            ` transform: translate(-50%, ${flipBelow ? '0' : '-100%'});`
        ].join('');
    }

    handleHideTooltip() {
        this.tooltip = undefined;
    }

    get tooltipClass() {
        return this.tooltip && this.tooltip.wide ? 'bar-tooltip bar-tooltip_wide' : 'bar-tooltip';
    }

    handleMilestoneEnter(event) {
        const marker = event.currentTarget;
        const milestone = this.visibleMilestones.find((ms) => ms.Id === marker.dataset.id);
        if (!milestone) {
            return;
        }
        const date = parseSfDate(milestone.Due_Date__c);
        this.tooltip = {
            name: formatLongDate(date),
            description: milestone.Milestone_Description__c,
            wide: true
        };

        // Anchor to the clamped description so the card lands right on top of it.
        // On keyboard focus currentTarget is the diamond instead, which has no
        // description child — then the diamond itself is the anchor.
        const anchor = marker.querySelector('.milestone-desc') || marker;
        const rect = anchor.getBoundingClientRect();
        const half = MILESTONE_TOOLTIP_MAX_WIDTH_PX / 2;
        const centerX = Math.min(
            Math.max(rect.left + rect.width / 2, half + 8),
            Math.max(window.innerWidth - half - 8, half + 8)
        );
        this.tooltipStyle = [
            `left: ${Math.round(centerX)}px;`,
            ` top: ${Math.round(rect.top - 6)}px;`,
            ' transform: translate(-50%, 0);'
        ].join('');
    }

    handleBarClick(event) {
        this.openStageModal(event.currentTarget.dataset.id);
    }

    handleBarKeyUp(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            this.openStageModal(event.currentTarget.dataset.id);
        }
    }

    openStageModal(stageId) {
        const stage = this.stages.find((s) => s.Id === stageId);
        if (!stage) {
            return;
        }
        this.modalStageId = stage.Id;
        this.modalStageName = stage.Name;
        this.modalOriginalStageName = stage.Name;
        this.modalStartDate = stage.Start_Date__c;
        this.modalEndDate = stage.End_Date__c;
        this.modalOwner = stage.Stage_Owner__c;
        this.modalDescription = stage.Description__c || '';
        this.modalSystem = stage.System__c || '';
        this.modalDisplayOrder =
            stage.Display_Order__c === null || stage.Display_Order__c === undefined
                ? ''
                : String(stage.Display_Order__c);
        this.isStageCreate = false;
        this.modalError = undefined;
        this.isModalOpen = true;
    }

    handleNewStage() {
        this.isStageCreate = true;
        this.modalStageId = undefined;
        this.modalStageName = '';
        this.modalStartDate = undefined;
        this.modalEndDate = undefined;
        // Pre-fill the owner from the last stage so the common case is one click.
        const lastStage = this.stages[this.stages.length - 1];
        this.modalOwner = lastStage ? lastStage.Stage_Owner__c : '';
        this.modalDescription = '';
        this.modalSystem = DEFAULT_SYSTEM;
        this.modalDisplayOrder = this._nextDisplayOrder;
        this.modalError = undefined;
        this.isModalOpen = true;
    }

    // Only suggest a Display Order when the Epic already uses them. Seeding a 1 on an
    // Epic whose stages are all null would sort the new stage ahead of every existing
    // one (ASC NULLS LAST), instead of appending it where the user expects.
    get _nextDisplayOrder() {
        const orders = this.stages
            .map((s) => s.Display_Order__c)
            .filter((o) => o !== null && o !== undefined);
        return orders.length ? String(Math.max(...orders) + 1) : '';
    }

    closeModal() {
        this.isModalOpen = false;
    }

    handleStageNameChange(event) {
        this.modalStageName = event.target.value;
    }

    handleDisplayOrderChange(event) {
        this.modalDisplayOrder = event.target.value;
    }

    handleSystemChange(event) {
        this.modalSystem = event.target.value;
    }

    handleStartDateChange(event) {
        this.modalStartDate = event.target.value;
    }

    handleEndDateChange(event) {
        this.modalEndDate = event.target.value;
    }

    handleOwnerChange(event) {
        this.modalOwner = event.target.value;
    }

    handleDescriptionChange(event) {
        this.modalDescription = event.target.value;
    }

    handleMilestoneClick(event) {
        this.openMilestoneModal(event.currentTarget.dataset.id);
    }

    handleMilestoneKeyUp(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            this.openMilestoneModal(event.currentTarget.dataset.id);
        }
    }

    openMilestoneModal(milestoneId) {
        const milestone = this.milestones.find((ms) => ms.Id === milestoneId);
        if (!milestone) {
            return;
        }
        this.milestoneModalId = milestone.Id;
        this.milestoneModalName = milestone.Name;
        this.milestoneModalDueDate = milestone.Due_Date__c;
        this.milestoneModalDescription = milestone.Milestone_Description__c || '';
        this.milestoneModalSortOrder =
            milestone.Sort_Order__c === null || milestone.Sort_Order__c === undefined
                ? ''
                : String(milestone.Sort_Order__c);
        this.isMilestoneCreate = false;
        this.milestoneModalError = undefined;
        this.isMilestoneModalOpen = true;
    }

    handleNewMilestone() {
        this.isMilestoneCreate = true;
        this.milestoneModalId = undefined;
        this.milestoneModalName = '';
        this.milestoneModalDueDate = undefined;
        this.milestoneModalDescription = '';
        this.milestoneModalSortOrder = '';
        this.milestoneModalError = undefined;
        this.isMilestoneModalOpen = true;
    }

    closeMilestoneModal() {
        this.isMilestoneModalOpen = false;
    }

    handleMilestoneDueDateChange(event) {
        this.milestoneModalDueDate = event.target.value;
    }

    handleMilestoneDescriptionChange(event) {
        this.milestoneModalDescription = event.target.value;
    }

    handleMilestoneSortOrderChange(event) {
        this.milestoneModalSortOrder = event.target.value;
    }

    async handleMilestoneSave() {
        if (!this.milestoneModalDueDate) {
            this.milestoneModalError = 'Due Date is required.';
            return;
        }
        if (!this.milestoneModalDescription || !this.milestoneModalDescription.trim()) {
            this.milestoneModalError = 'Milestone Description is required.';
            return;
        }

        // An empty Sort Order is meaningful: it clears the value so the milestone
        // sorts last among others sharing its date.
        const rawSortOrder = this.milestoneModalSortOrder;
        const hasSortOrder = rawSortOrder !== '' && rawSortOrder !== null && rawSortOrder !== undefined;
        const sortOrder = hasSortOrder ? Number(rawSortOrder) : null;
        if (hasSortOrder && !Number.isInteger(sortOrder)) {
            this.milestoneModalError = 'Sort Order must be a whole number.';
            return;
        }

        this.milestoneModalSaving = true;
        this.milestoneModalError = undefined;

        try {
            if (this.isMilestoneCreate) {
                await createMilestone({
                    epicId: this.recordId,
                    dueDate: this.milestoneModalDueDate,
                    description: this.milestoneModalDescription,
                    sortOrder
                });
            } else {
                await updateMilestone({
                    milestoneId: this.milestoneModalId,
                    dueDate: this.milestoneModalDueDate,
                    description: this.milestoneModalDescription,
                    sortOrder
                });
            }
            await refreshApex(this.wiredGanttResult);
            this.isMilestoneModalOpen = false;
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Saved',
                    message: this.isMilestoneCreate ? 'Milestone created.' : 'Milestone updated.',
                    variant: 'success'
                })
            );
        } catch (e) {
            this.milestoneModalError =
                e.body && e.body.message ? e.body.message : 'An error occurred while saving.';
        } finally {
            this.milestoneModalSaving = false;
        }
    }

    async handleSave() {
        if (!this.modalStageName || !this.modalStageName.trim()) {
            this.modalError = 'Stage Name is required.';
            return;
        }
        if (!this.modalOwner) {
            this.modalError = 'Stage Owner is required.';
            return;
        }
        if (!this.modalStartDate || !this.modalEndDate) {
            this.modalError = 'Start Date and End Date are required.';
            return;
        }

        // An empty Display Order is meaningful: it clears the value so the stage
        // sorts last among the Epic's stages.
        const rawDisplayOrder = this.modalDisplayOrder;
        const hasDisplayOrder =
            rawDisplayOrder !== '' && rawDisplayOrder !== null && rawDisplayOrder !== undefined;
        const displayOrder = hasDisplayOrder ? Number(rawDisplayOrder) : null;
        if (this.isStageCreate && hasDisplayOrder && !Number.isInteger(displayOrder)) {
            this.modalError = 'Display Order must be a whole number.';
            return;
        }

        this.modalSaving = true;
        this.modalError = undefined;

        try {
            if (this.isStageCreate) {
                await createProjectStage({
                    epicId: this.recordId,
                    name: this.modalStageName,
                    startDate: this.modalStartDate,
                    endDate: this.modalEndDate,
                    stageOwner: this.modalOwner,
                    description: this.modalDescription,
                    displayOrder,
                    systemName: this.modalSystem
                });
            } else {
                await updateProjectStage({
                    stageId: this.modalStageId,
                    name: this.modalStageName,
                    startDate: this.modalStartDate,
                    endDate: this.modalEndDate,
                    stageOwner: this.modalOwner,
                    description: this.modalDescription,
                    systemName: this.modalSystem
                });
            }
            await refreshApex(this.wiredGanttResult);
            this.isModalOpen = false;
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'Saved',
                    message: this.isStageCreate
                        ? `${this.modalStageName} created.`
                        : `${this.modalStageName} updated.`,
                    variant: 'success'
                })
            );
            if (this.isStageCreate) {
                // A new stage also lands in the Epic's related lists, so refresh the
                // whole record page, not just this chart.
                this.dispatchEvent(new RefreshEvent());
            }
        } catch (e) {
            this.modalError = e.body && e.body.message ? e.body.message : 'An error occurred while saving.';
        } finally {
            this.modalSaving = false;
        }
    }
}
