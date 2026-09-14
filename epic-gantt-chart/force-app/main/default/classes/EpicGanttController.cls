public with sharing class EpicGanttController {
    @AuraEnabled(cacheable=true)
    public static GanttData getGanttData(Id epicId) {
        GanttData data = new GanttData();

        data.stages = [
            SELECT Id, Name, Start_Date__c, End_Date__c, Stage_Owner__c, Display_Order__c, Description__c,
                   System__c
            FROM Project_Stage__c
            WHERE Epic__c = :epicId
            ORDER BY Display_Order__c ASC NULLS LAST, Start_Date__c ASC
        ];

        data.milestones = [
            SELECT Id, Name, Due_Date__c, Milestone_Description__c, Sort_Order__c
            FROM Milestone__c
            WHERE Epic__c = :epicId
            ORDER BY Due_Date__c ASC, Sort_Order__c ASC NULLS LAST, Name ASC
        ];

        return data;
    }

    @AuraEnabled
    public static void updateProjectStage(
        Id stageId,
        String name,
        Date startDate,
        Date endDate,
        String stageOwner,
        String description,
        String systemName
    ) {
        if (String.isBlank(name)) {
            throw new AuraHandledException('Stage Name is required.');
        }
        if (startDate > endDate) {
            throw new AuraHandledException('Start Date must be on or before End Date.');
        }

        Project_Stage__c stage = new Project_Stage__c(
            Id = stageId,
            Name = name,
            Start_Date__c = startDate,
            End_Date__c = endDate,
            Stage_Owner__c = stageOwner,
            Description__c = description,
            System__c = systemName
        );

        try {
            update stage;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static void updateMilestone(Id milestoneId, Date dueDate, String description, Decimal sortOrder) {
        if (dueDate == null) {
            throw new AuraHandledException('Due Date is required.');
        }
        if (String.isBlank(description)) {
            throw new AuraHandledException('Milestone Description is required.');
        }

        Milestone__c milestone = new Milestone__c(
            Id = milestoneId,
            Due_Date__c = dueDate,
            Milestone_Description__c = description,
            Sort_Order__c = sortOrder
        );

        try {
            update milestone;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    @AuraEnabled
    public static Id createProjectStage(
        Id epicId,
        String name,
        Date startDate,
        Date endDate,
        String stageOwner,
        String description,
        Decimal displayOrder,
        String systemName
    ) {
        if (String.isBlank(name)) {
            throw new AuraHandledException('Stage Name is required.');
        }
        if (startDate == null || endDate == null) {
            throw new AuraHandledException('Start Date and End Date are required.');
        }
        if (startDate > endDate) {
            throw new AuraHandledException('Start Date must be on or before End Date.');
        }
        if (String.isBlank(stageOwner)) {
            throw new AuraHandledException('Stage Owner is required.');
        }

        Project_Stage__c stage = new Project_Stage__c(
            Epic__c = epicId,
            Name = name,
            Start_Date__c = startDate,
            End_Date__c = endDate,
            Stage_Owner__c = stageOwner,
            Description__c = description,
            Display_Order__c = displayOrder,
            System__c = systemName
        );

        try {
            insert stage;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
        return stage.Id;
    }

    @AuraEnabled
    public static Id createMilestone(Id epicId, Date dueDate, String description, Decimal sortOrder) {
        if (dueDate == null) {
            throw new AuraHandledException('Due Date is required.');
        }
        if (String.isBlank(description)) {
            throw new AuraHandledException('Milestone Description is required.');
        }

        Milestone__c milestone = new Milestone__c(
            Epic__c = epicId,
            Due_Date__c = dueDate,
            Milestone_Description__c = description,
            Sort_Order__c = sortOrder
        );

        try {
            insert milestone;
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
        return milestone.Id;
    }

    @AuraEnabled
    public static void createStagesAndMilestones(Id epicId, List<Project_Stage__c> stages, List<Milestone__c> milestones) {
        for (Project_Stage__c stage : stages) {
            if (stage.Start_Date__c != null && stage.End_Date__c != null && stage.Start_Date__c > stage.End_Date__c) {
                throw new AuraHandledException(
                    'Start Date must be on or before End Date for stage "' + stage.Name + '".'
                );
            }
            stage.Epic__c = epicId;
        }

        for (Milestone__c milestone : milestones) {
            milestone.Epic__c = epicId;
        }

        try {
            if (!stages.isEmpty()) {
                insert stages;
            }
            if (!milestones.isEmpty()) {
                insert milestones;
            }
        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    public class GanttData {
        @AuraEnabled
        public List<Project_Stage__c> stages;
        @AuraEnabled
        public List<Milestone__c> milestones;
    }
}
