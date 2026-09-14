import { LightningElement, api, track } from 'lwc';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

function toIso(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseIso(iso) {
    if (!iso) {
        return null;
    }
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function formatDisplay(date) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sameDay(a, b) {
    return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export default class DateRangePicker extends LightningElement {
    @api label = 'Dates';

    @track isOpen = false;
    rangeStart;
    rangeEnd;
    hoverDate;
    viewYear;
    viewMonth;

    _positioned = false;

    // Under synthetic shadow DOM a window-level listener sees a retargeted event
    // whose composedPath stops at the host, never the internal .picker-root. The
    // old check therefore treated the click that opened the popover as an outside
    // click and closed it again in the same tick. Match on the host as well, and
    // stop propagation at the root so inside clicks never reach window at all.
    _outsideClickHandler = (event) => {
        if (!this.isOpen) {
            return;
        }
        const path = event.composedPath();
        const host = this.template.host;
        const root = this.template.querySelector('.picker-root');
        if ((host && path.includes(host)) || (root && path.includes(root))) {
            return;
        }
        this.closePopover();
    };

    // .builder-root is a `max-height: 65vh; overflow-y: auto` scroller, which clips
    // an absolutely positioned popover. The popover is fixed-position instead and
    // pinned to the trigger here, so it escapes the scroll container.
    _repositionHandler = () => {
        if (this.isOpen) {
            this._positionPopover();
        }
    };

    connectedCallback() {
        const today = new Date();
        this.viewYear = today.getFullYear();
        this.viewMonth = today.getMonth();
        window.addEventListener('click', this._outsideClickHandler);
        window.addEventListener('scroll', this._repositionHandler, true);
        window.addEventListener('resize', this._repositionHandler);
    }

    disconnectedCallback() {
        window.removeEventListener('click', this._outsideClickHandler);
        window.removeEventListener('scroll', this._repositionHandler, true);
        window.removeEventListener('resize', this._repositionHandler);
    }

    renderedCallback() {
        if (this.isOpen && !this._positioned) {
            this._positionPopover();
            this._positioned = true;
        }
    }

    _positionPopover() {
        const trigger = this.template.querySelector('.range-trigger');
        const popover = this.template.querySelector('.popover');
        if (!trigger || !popover) {
            return;
        }
        const rect = trigger.getBoundingClientRect();
        const popHeight = popover.offsetHeight;
        const popWidth = popover.offsetWidth;
        const GAP = 4;
        const EDGE = 8;

        // Flip above the trigger when there is not enough room below it.
        const fitsBelow = window.innerHeight - rect.bottom >= popHeight + GAP + EDGE;
        const top = fitsBelow || rect.top < popHeight + GAP + EDGE
            ? rect.bottom + GAP
            : rect.top - popHeight - GAP;

        popover.style.top = `${Math.max(EDGE, Math.min(top, window.innerHeight - popHeight - EDGE))}px`;
        popover.style.left = `${Math.max(EDGE, Math.min(rect.left, window.innerWidth - popWidth - EDGE))}px`;
    }

    closePopover() {
        this.isOpen = false;
        this._positioned = false;
    }

    handleRootClick(event) {
        event.stopPropagation();
    }

    @api
    get startDate() {
        return this.rangeStart ? toIso(this.rangeStart) : null;
    }
    set startDate(value) {
        this.rangeStart = parseIso(value);
    }

    @api
    get endDate() {
        return this.rangeEnd ? toIso(this.rangeEnd) : null;
    }
    set endDate(value) {
        this.rangeEnd = parseIso(value);
    }

    get triggerLabel() {
        if (this.rangeStart && this.rangeEnd) {
            return `${formatDisplay(this.rangeStart)} → ${formatDisplay(this.rangeEnd)}`;
        }
        if (this.rangeStart) {
            return `${formatDisplay(this.rangeStart)} → Select end date`;
        }
        return 'Select dates';
    }

    get triggerClass() {
        return this.rangeStart && this.rangeEnd
            ? 'range-trigger'
            : 'range-trigger range-trigger_placeholder';
    }

    get monthLabel() {
        return `${MONTH_NAMES[this.viewMonth]} ${this.viewYear}`;
    }

    get weekdayLabels() {
        return WEEKDAY_LABELS.map((label, idx) => ({ key: `wd-${idx}`, label }));
    }

    get calendarWeeks() {
        const firstOfMonth = new Date(this.viewYear, this.viewMonth, 1);
        const startOffset = firstOfMonth.getDay();
        const gridStart = new Date(this.viewYear, this.viewMonth, 1 - startOffset);
        const today = startOfDay(new Date());

        const previewEnd = this.rangeEnd || this.hoverDate;
        const rangeLow = this.rangeStart && previewEnd && previewEnd < this.rangeStart ? previewEnd : this.rangeStart;
        const rangeHigh = this.rangeStart && previewEnd && previewEnd < this.rangeStart ? this.rangeStart : previewEnd;

        const weeks = [];
        for (let w = 0; w < 6; w += 1) {
            const days = [];
            for (let d = 0; d < 7; d += 1) {
                const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7 + d);
                const iso = toIso(cellDate);
                const isStart = sameDay(cellDate, this.rangeStart);
                const isEnd = sameDay(cellDate, this.rangeEnd);
                const inRange = !!rangeLow && !!rangeHigh && cellDate > rangeLow && cellDate < rangeHigh;

                let cellClass = 'day-cell';
                if (cellDate.getMonth() !== this.viewMonth) {
                    cellClass += ' day-cell_muted';
                }
                if (sameDay(cellDate, today)) {
                    cellClass += ' day-cell_today';
                }
                if (isStart || isEnd) {
                    cellClass += ' day-cell_selected';
                } else if (inRange) {
                    cellClass += ' day-cell_in-range';
                }

                days.push({
                    key: iso,
                    iso,
                    dayNum: cellDate.getDate(),
                    cellClass
                });
            }
            weeks.push({ key: `week-${w}`, days });
        }
        return weeks;
    }

    handlePrevMonth() {
        this.viewMonth -= 1;
        if (this.viewMonth < 0) {
            this.viewMonth = 11;
            this.viewYear -= 1;
        }
    }

    handleNextMonth() {
        this.viewMonth += 1;
        if (this.viewMonth > 11) {
            this.viewMonth = 0;
            this.viewYear += 1;
        }
    }

    handleTriggerClick() {
        if (this.isOpen) {
            this.closePopover();
        } else {
            this.isOpen = true;
        }
    }

    handleDayMouseEnter(event) {
        this.hoverDate = parseIso(event.currentTarget.dataset.iso);
    }

    handleDayClick(event) {
        const clicked = parseIso(event.currentTarget.dataset.iso);

        if (!this.rangeStart || (this.rangeStart && this.rangeEnd)) {
            this.rangeStart = clicked;
            this.rangeEnd = null;
            return;
        }

        if (clicked < this.rangeStart) {
            this.rangeStart = clicked;
            this.rangeEnd = null;
            return;
        }

        this.rangeEnd = clicked;
        this.closePopover();
        this.dispatchEvent(
            new CustomEvent('rangechange', {
                detail: { startDate: toIso(this.rangeStart), endDate: toIso(this.rangeEnd) }
            })
        );
    }

    handleDone() {
        this.closePopover();
        this.dispatchEvent(
            new CustomEvent('rangechange', {
                detail: { startDate: this.startDate, endDate: this.endDate }
            })
        );
    }

    handleClear() {
        this.rangeStart = null;
        this.rangeEnd = null;
        this.hoverDate = null;
        this.dispatchEvent(
            new CustomEvent('rangechange', {
                detail: { startDate: null, endDate: null }
            })
        );
    }
}
