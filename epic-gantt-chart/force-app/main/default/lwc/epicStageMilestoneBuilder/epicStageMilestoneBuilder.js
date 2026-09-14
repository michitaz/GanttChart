import { LightningElement, api } from 'lwc';
import { FlowNavigationFinishEvent } from 'lightning/flowSupport';
import createStagesAndMilestones from '@salesforce/apex/EpicGanttController.createStagesAndMilestones';

// Mirrors the Project_Stage__c.System__c field default.
const DEFAULT_SYSTEM = 'Salesforce';

let keySeed = 0;
function nextKey(prefix) {
    keySeed += 1;
    return `${prefix}-${keySeed}`;
}

function blankStage() {
    return {
        key: nextKey('stage'),
        name: '',
        owner: '',
        system: DEFAULT_SYSTEM,
        startDate: null,
        endDate: null,
        description: '',
        errors: {}
    };
}

function blankMilestone() {
    return {
        key: nextKey('milestone'),
        dueDate: null,
        description: '',
        errors: {}
    };
}

export default class EpicStageMilestoneBuilder extends LightningElement {
    @api recordId;

    stageRows = [blankStage()];
    milestoneRows = [blankMilestone()];
    isSaving = false;
    saveError;

    get stageRowsView() {
        return this.stageRows.map((row, idx) => ({
            ...row,
            index: idx + 1,
            nameClass: `slds-input${row.errors.name ? ' slds-has-error' : ''}`,
            ownerClass: `slds-input${row.errors.owner ? ' slds-has-error' : ''}`,
            systemClass: 'slds-input',
            datesClass: row.errors.dates ? 'has-error' : ''
        }));
    }

    get milestoneRowsView() {
        return this.milestoneRows.map((row, idx) => ({
            ...row,
            index: idx + 1,
            dateClass: `slds-input${row.errors.dueDate ? ' slds-has-error' : ''}`,
            descriptionClass: row.errors.description ? 'has-error' : ''
        }));
    }

    get canRemoveStage() {
        return this.stageRows.length > 0;
    }

    get canRemoveMilestone() {
        return this.milestoneRows.length > 0;
    }

    get hasNothingToSave() {
        return this.stageRows.length === 0 && this.milestoneRows.length === 0;
    }

    handleAddStage() {
        this.stageRows = [...this.stageRows, blankStage()];
    }

    handleRemoveStage(event) {
        const key = event.currentTarget.dataset.key;
        this.stageRows = this.stageRows.filter((row) => row.key !== key);
    }

    handleAddMilestone() {
        this.milestoneRows = [...this.milestoneRows, blankMilestone()];
    }

    handleRemoveMilestone(event) {
        const key = event.currentTarget.dataset.key;
        this.milestoneRows = this.milestoneRows.filter((row) => row.key !== key);
    }

    handleStageNameChange(event) {
        this._updateStage(event.currentTarget.dataset.key, { name: event.target.value });
    }

    handleStageOwnerChange(event) {
        this._updateStage(event.currentTarget.dataset.key, { owner: event.target.value });
    }

    handleStageSystemChange(event) {
        this._updateStage(event.currentTarget.dataset.key, { system: event.target.value });
    }

    handleStageDescriptionChange(event) {
        this._updateStage(event.currentTarget.dataset.key, { description: event.target.value });
    }

    handleStageDatesChange(event) {
        const { startDate, endDate } = event.detail;
        this._updateStage(event.currentTarget.dataset.key, { startDate, endDate });
    }

    handleMilestoneDueDateChange(event) {
        this._updateMilestone(event.currentTarget.dataset.key, { dueDate: event.target.value });
    }

    handleMilestoneDescriptionChange(event) {
        this._updateMilestone(event.currentTarget.dataset.key, { description: event.target.value });
    }

    _updateStage(key, patch) {
        this.stageRows = this.stageRows.map((row) =>
            row.key === key ? { ...row, ...patch, errors: {} } : row
        );
    }

    _updateMilestone(key, patch) {
        this.milestoneRows = this.milestoneRows.map((row) =>
            row.key === key ? { ...row, ...patch, errors: {} } : row
        );
    }

    _validate() {
        let isValid = true;

        this.stageRows = this.stageRows.map((row) => {
            const errors = {};
            if (!row.name || !row.name.trim()) {
                errors.name = true;
            }
            if (!row.owner || !row.owner.trim()) {
                errors.owner = true;
            }
            if (!row.startDate || !row.endDate) {
                errors.dates = true;
            } else if (row.startDate > row.endDate) {
                errors.dates = true;
            }
            if (Object.keys(errors).length) {
                isValid = false;
            }
            return { ...row, errors };
        });

        this.milestoneRows = this.milestoneRows.map((row) => {
            const errors = {};
            if (!row.dueDate) {
                errors.dueDate = true;
            }
            if (!row.description || !row.description.trim()) {
                errors.description = true;
            }
            if (Object.keys(errors).length) {
                isValid = false;
            }
            return { ...row, errors };
        });

        if (this.hasNothingToSave) {
            isValid = false;
            this.saveError = 'Add at least one project stage or milestone before saving.';
        }

        return isValid;
    }

    async handleSave() {
        this.saveError = undefined;

        if (!this._validate()) {
            if (!this.saveError) {
                this.saveError = 'Fix the highlighted fields before saving.';
            }
            return;
        }

        this.isSaving = true;

        try {
            await createStagesAndMilestones({
                epicId: this.recordId,
                stages: this.stageRows.map((row) => ({
                    Name: row.name,
                    Stage_Owner__c: row.owner,
                    System__c: row.system,
                    Start_Date__c: row.startDate,
                    End_Date__c: row.endDate,
                    Description__c: row.description
                })),
                milestones: this.milestoneRows.map((row) => ({
                    Due_Date__c: row.dueDate,
                    Milestone_Description__c: row.description
                }))
            });
            this.dispatchEvent(new FlowNavigationFinishEvent());
        } catch (e) {
            this.saveError = e.body && e.body.message ? e.body.message : 'An error occurred while saving.';
        } finally {
            this.isSaving = false;
        }
    }

    handleCancel() {
        this.dispatchEvent(new FlowNavigationFinishEvent());
    }
}
