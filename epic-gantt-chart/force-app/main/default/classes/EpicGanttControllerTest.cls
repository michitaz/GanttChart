@IsTest
private class EpicGanttControllerTest {
    @TestSetup
    static void setup() {
        Epic__c epic = new Epic__c(Name = 'Test Epic');
        insert epic;

        insert new Project_Stage__c(
            Epic__c = epic.Id,
            Name = 'Build',
            Start_Date__c = Date.today(),
            End_Date__c = Date.today().addDays(7),
            Stage_Owner__c = 'Anchored Insight',
            Display_Order__c = 1,
            System__c = 'Salesforce'
        );

        insert new Milestone__c(
            Epic__c = epic.Id,
            Due_Date__c = Date.today().addDays(10),
            Milestone_Description__c = 'Client sign off required'
        );
    }

    @IsTest
    static void testGetGanttDataReturnsRelatedRecords() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        Test.startTest();
        EpicGanttController.GanttData data = EpicGanttController.getGanttData(epic.Id);
        Test.stopTest();

        System.assertEquals(1, data.stages.size(), 'Expected one related stage');
        System.assertEquals(1, data.milestones.size(), 'Expected one related milestone');
        System.assertEquals('Anchored Insight', data.stages[0].Stage_Owner__c, 'Stage owner should round-trip');
        System.assertEquals('Client sign off required', data.milestones[0].Milestone_Description__c);
    }

    @IsTest
    static void testGetGanttDataExcludesUnrelatedEpic() {
        Epic__c otherEpic = new Epic__c(Name = 'Other Epic');
        insert otherEpic;

        Test.startTest();
        EpicGanttController.GanttData data = EpicGanttController.getGanttData(otherEpic.Id);
        Test.stopTest();

        System.assertEquals(0, data.stages.size(), 'Unrelated epic should have no stages');
        System.assertEquals(0, data.milestones.size(), 'Unrelated epic should have no milestones');
    }

    @IsTest
    static void testUpdateProjectStageSavesChanges() {
        Project_Stage__c stage = [SELECT Id FROM Project_Stage__c LIMIT 1];

        Test.startTest();
        EpicGanttController.updateProjectStage(
            stage.Id,
            'Build (renamed)',
            Date.today().addDays(1),
            Date.today().addDays(14),
            'Client',
            'Updated description',
            'NetSuite'
        );
        Test.stopTest();

        Project_Stage__c updated = [
            SELECT Name, Start_Date__c, End_Date__c, Stage_Owner__c, Description__c, System__c
            FROM Project_Stage__c
            WHERE Id = :stage.Id
        ];
        System.assertEquals('Build (renamed)', updated.Name, 'Stage Name should be editable');
        System.assertEquals('NetSuite', updated.System__c, 'System should round-trip');
        System.assertEquals(Date.today().addDays(1), updated.Start_Date__c);
        System.assertEquals(Date.today().addDays(14), updated.End_Date__c);
        System.assertEquals('Client', updated.Stage_Owner__c);
        System.assertEquals('Updated description', updated.Description__c);
    }

    @IsTest
    static void testUpdateProjectStageRejectsInvalidDateRange() {
        Project_Stage__c stage = [SELECT Id FROM Project_Stage__c LIMIT 1];

        Test.startTest();
        try {
            EpicGanttController.updateProjectStage(
                stage.Id,
                'Build',
                Date.today().addDays(10),
                Date.today(),
                'Client',
                'Should not save',
                'Salesforce'
            );
            System.assert(false, 'Expected an AuraHandledException for an invalid date range');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void testUpdateProjectStageRejectsBlankName() {
        Project_Stage__c stage = [SELECT Id FROM Project_Stage__c LIMIT 1];

        Test.startTest();
        try {
            EpicGanttController.updateProjectStage(
                stage.Id,
                '   ',
                Date.today(),
                Date.today().addDays(3),
                'Client',
                'Should not save',
                'Salesforce'
            );
            System.assert(false, 'Expected an AuraHandledException for a blank stage name');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();

        Project_Stage__c unchanged = [SELECT Name FROM Project_Stage__c WHERE Id = :stage.Id];
        System.assertEquals('Build', unchanged.Name, 'Stage should not have been renamed');
    }

    @IsTest
    static void testUpdateMilestoneSavesChanges() {
        Milestone__c milestone = [SELECT Id FROM Milestone__c LIMIT 1];

        Test.startTest();
        EpicGanttController.updateMilestone(milestone.Id, Date.today().addDays(30), 'Rescheduled sign off', 2);
        Test.stopTest();

        Milestone__c updated = [
            SELECT Due_Date__c, Milestone_Description__c, Sort_Order__c
            FROM Milestone__c
            WHERE Id = :milestone.Id
        ];
        System.assertEquals(Date.today().addDays(30), updated.Due_Date__c);
        System.assertEquals('Rescheduled sign off', updated.Milestone_Description__c);
        System.assertEquals(2, updated.Sort_Order__c, 'Sort Order should round-trip');
    }

    @IsTest
    static void testGetGanttDataOrdersSameDateMilestonesBySortOrder() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];
        Date shared = Date.today().addDays(45);

        insert new List<Milestone__c>{
            new Milestone__c(
                Epic__c = epic.Id,
                Due_Date__c = shared,
                Milestone_Description__c = 'Second on the day',
                Sort_Order__c = 2
            ),
            new Milestone__c(
                Epic__c = epic.Id,
                Due_Date__c = shared,
                Milestone_Description__c = 'First on the day',
                Sort_Order__c = 1
            ),
            new Milestone__c(
                Epic__c = epic.Id,
                Due_Date__c = shared,
                Milestone_Description__c = 'Unordered sorts last'
            )
        };

        Test.startTest();
        EpicGanttController.GanttData data = EpicGanttController.getGanttData(epic.Id);
        Test.stopTest();

        List<Milestone__c> sameDay = new List<Milestone__c>();
        for (Milestone__c ms : data.milestones) {
            if (ms.Due_Date__c == shared) {
                sameDay.add(ms);
            }
        }
        System.assertEquals(3, sameDay.size(), 'Expected three milestones sharing a due date');
        System.assertEquals('First on the day', sameDay[0].Milestone_Description__c);
        System.assertEquals('Second on the day', sameDay[1].Milestone_Description__c);
        System.assertEquals('Unordered sorts last', sameDay[2].Milestone_Description__c, 'Null Sort Order should sort last');
    }

    @IsTest
    static void testUpdateMilestoneRejectsBlankDescription() {
        Milestone__c milestone = [SELECT Id FROM Milestone__c LIMIT 1];

        Test.startTest();
        try {
            EpicGanttController.updateMilestone(milestone.Id, Date.today().addDays(30), '   ', 1);
            System.assert(false, 'Expected an AuraHandledException for a blank description');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();

        Milestone__c unchanged = [SELECT Milestone_Description__c FROM Milestone__c WHERE Id = :milestone.Id];
        System.assertEquals('Client sign off required', unchanged.Milestone_Description__c, 'Milestone should not have changed');
    }

    @IsTest
    static void testUpdateMilestoneRejectsNullDueDate() {
        Milestone__c milestone = [SELECT Id FROM Milestone__c LIMIT 1];

        Test.startTest();
        try {
            EpicGanttController.updateMilestone(milestone.Id, null, 'Missing a due date', 1);
            System.assert(false, 'Expected an AuraHandledException for a null due date');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void testCreateStagesAndMilestonesInsertsBoth() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        List<Project_Stage__c> stages = new List<Project_Stage__c>{
            new Project_Stage__c(
                Name = 'Discovery',
                Start_Date__c = Date.today(),
                End_Date__c = Date.today().addDays(5),
                Stage_Owner__c = 'Anchored Insight'
            ),
            new Project_Stage__c(
                Name = 'Build',
                Start_Date__c = Date.today().addDays(6),
                End_Date__c = Date.today().addDays(20),
                Stage_Owner__c = 'Client'
            )
        };
        List<Milestone__c> milestones = new List<Milestone__c>{
            new Milestone__c(Due_Date__c = Date.today().addDays(21), Milestone_Description__c = 'Go live')
        };

        Test.startTest();
        EpicGanttController.createStagesAndMilestones(epic.Id, stages, milestones);
        Test.stopTest();

        List<Project_Stage__c> insertedStages = [SELECT Id, Epic__c FROM Project_Stage__c WHERE Epic__c = :epic.Id];
        List<Milestone__c> insertedMilestones = [SELECT Id, Epic__c FROM Milestone__c WHERE Epic__c = :epic.Id];
        System.assertEquals(3, insertedStages.size(), 'Expected the 1 test-setup stage plus 2 new stages');
        System.assertEquals(2, insertedMilestones.size(), 'Expected the 1 test-setup milestone plus 1 new milestone');
    }

    @IsTest
    static void testCreateStagesAndMilestonesRejectsInvalidDateRange() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        List<Project_Stage__c> stages = new List<Project_Stage__c>{
            new Project_Stage__c(
                Name = 'Bad Range',
                Start_Date__c = Date.today().addDays(10),
                End_Date__c = Date.today(),
                Stage_Owner__c = 'Anchored Insight'
            )
        };

        Test.startTest();
        try {
            EpicGanttController.createStagesAndMilestones(epic.Id, stages, new List<Milestone__c>());
            System.assert(false, 'Expected an AuraHandledException for an invalid date range');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();

        List<Project_Stage__c> insertedStages = [
            SELECT Id
            FROM Project_Stage__c
            WHERE Epic__c = :epic.Id AND Name = 'Bad Range'
        ];
        System.assertEquals(0, insertedStages.size(), 'Invalid stage should not have been inserted');
    }

    @IsTest
    static void testCreateProjectStageInsertsStage() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        Test.startTest();
        Id newId = EpicGanttController.createProjectStage(
            epic.Id,
            'Discovery',
            Date.today().addDays(1),
            Date.today().addDays(9),
            'Client',
            'Kickoff workshops',
            5,
            'NetSuite'
        );
        Test.stopTest();

        Project_Stage__c created = [
            SELECT Name, Epic__c, Start_Date__c, End_Date__c, Stage_Owner__c, Description__c, Display_Order__c,
                   System__c
            FROM Project_Stage__c
            WHERE Id = :newId
        ];
        System.assertEquals(epic.Id, created.Epic__c, 'New stage should hang off the Epic');
        System.assertEquals('Discovery', created.Name);
        System.assertEquals(Date.today().addDays(1), created.Start_Date__c);
        System.assertEquals(Date.today().addDays(9), created.End_Date__c);
        System.assertEquals('Client', created.Stage_Owner__c);
        System.assertEquals('Kickoff workshops', created.Description__c);
        System.assertEquals(5, created.Display_Order__c, 'Display Order should round-trip');
        System.assertEquals('NetSuite', created.System__c, 'System should round-trip');
    }

    @IsTest
    static void testCreateProjectStageRejectsBlankName() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        Test.startTest();
        try {
            EpicGanttController.createProjectStage(
                epic.Id,
                '   ',
                Date.today(),
                Date.today().addDays(3),
                'Client',
                null,
                null,
                'Salesforce'
            );
            System.assert(false, 'Expected an AuraHandledException for a blank stage name');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();

        System.assertEquals(
            1,
            [SELECT COUNT() FROM Project_Stage__c WHERE Epic__c = :epic.Id],
            'Only the test-setup stage should exist'
        );
    }

    @IsTest
    static void testCreateProjectStageRejectsInvalidDateRange() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        Test.startTest();
        try {
            EpicGanttController.createProjectStage(
                epic.Id,
                'Backwards',
                Date.today().addDays(10),
                Date.today(),
                'Client',
                null,
                null,
                'Salesforce'
            );
            System.assert(false, 'Expected an AuraHandledException for an invalid date range');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();

        System.assertEquals(
            0,
            [SELECT COUNT() FROM Project_Stage__c WHERE Epic__c = :epic.Id AND Name = 'Backwards'],
            'Invalid stage should not have been inserted'
        );
    }

    @IsTest
    static void testCreateProjectStageRejectsMissingDatesAndOwner() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        Test.startTest();
        try {
            EpicGanttController.createProjectStage(
                epic.Id, 'No Dates', null, null, 'Client', null, null, 'Salesforce');
            System.assert(false, 'Expected an AuraHandledException for missing dates');
        } catch (AuraHandledException e) {
            System.assert(true);
        }

        try {
            EpicGanttController.createProjectStage(
                epic.Id,
                'No Owner',
                Date.today(),
                Date.today().addDays(2),
                '  ',
                null,
                null,
                'Salesforce'
            );
            System.assert(false, 'Expected an AuraHandledException for a blank stage owner');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void testCreateMilestoneInsertsMilestone() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        Test.startTest();
        Id newId = EpicGanttController.createMilestone(
            epic.Id,
            Date.today().addDays(12),
            'Carrier confirmed',
            3
        );
        Test.stopTest();

        Milestone__c created = [
            SELECT Epic__c, Due_Date__c, Milestone_Description__c, Sort_Order__c
            FROM Milestone__c
            WHERE Id = :newId
        ];
        System.assertEquals(epic.Id, created.Epic__c, 'New milestone should hang off the Epic');
        System.assertEquals(Date.today().addDays(12), created.Due_Date__c);
        System.assertEquals('Carrier confirmed', created.Milestone_Description__c);
        System.assertEquals(3, created.Sort_Order__c, 'Sort Order should round-trip');
    }

    @IsTest
    static void testCreateMilestoneAllowsNullSortOrder() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        Test.startTest();
        Id newId = EpicGanttController.createMilestone(epic.Id, Date.today().addDays(4), 'Unordered', null);
        Test.stopTest();

        Milestone__c created = [SELECT Sort_Order__c FROM Milestone__c WHERE Id = :newId];
        System.assertEquals(null, created.Sort_Order__c, 'Blank Sort Order should stay null');
    }

    @IsTest
    static void testCreateMilestoneRejectsMissingRequiredValues() {
        Epic__c epic = [SELECT Id FROM Epic__c LIMIT 1];

        Test.startTest();
        try {
            EpicGanttController.createMilestone(epic.Id, null, 'No due date', null);
            System.assert(false, 'Expected an AuraHandledException for a null due date');
        } catch (AuraHandledException e) {
            System.assert(true);
        }

        try {
            EpicGanttController.createMilestone(epic.Id, Date.today(), '   ', null);
            System.assert(false, 'Expected an AuraHandledException for a blank description');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();

        System.assertEquals(
            1,
            [SELECT COUNT() FROM Milestone__c WHERE Epic__c = :epic.Id],
            'Only the test-setup milestone should exist'
        );
    }
}
