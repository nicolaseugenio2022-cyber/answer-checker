import ListChecks from 'lucide-react-native/icons/list-checks';
import Users from 'lucide-react-native/icons/users';
import { useMemo } from 'react';

import {
  NameListScreen,
  type NameListCopy,
  type NameListOperations,
  type RowDialogAction,
} from '@/core/presentation/components/name-list-screen';
import {
  countOf,
  describeNameError,
  type ErrorDescription,
} from '@/core/presentation/lib/describe-name-error';
import { destinationTitle } from '@/core/presentation/navigation/destinations';
import { useClassSubjectUseCases } from '@/features/class-subjects/presentation/class-subject-use-cases-context';
import { ManageClassSubjectsDialog } from '@/features/class-subjects/presentation/manage-class-subjects-dialog';
import { ClassInUseError } from '@/features/classes/application/class-repository';
import { CLASS_NAME_MAX_LENGTH } from '@/features/classes/domain/school-class';
import { useClassUseCases } from '@/features/classes/presentation/class-use-cases-context';
import { useSubjectUseCases } from '@/features/subjects/presentation/subject-use-cases-context';

const COPY: NameListCopy = {
  noun: 'class',
  pluralNoun: 'classes',
  intro:
    'A class is one group of students. Put the grade or year, the course or strand, and the section in its name, then choose the subjects taught to it.',
  emptyHint: 'Add the first class you teach, such as Grade 11 STEM-A or BSIT 1A.',
  namePlaceholder: 'BSIT 1A',
};

/** "This class contains 24 students and is used by 2 exams." */
function describeClassUse({ studentCount, examCount }: ClassInUseError): string {
  const parts: string[] = [];
  if (studentCount > 0) parts.push(`contains ${countOf(studentCount, 'student')}`);
  if (examCount > 0) parts.push(`is used by ${countOf(examCount, 'exam')}`);
  return `This class ${parts.join(' and ')}.`;
}

function describeClassError(error: unknown): ErrorDescription {
  if (error instanceof ClassInUseError) {
    return {
      kind: 'blocked',
      message: `${describeClassUse(error)} A class can be deleted only when it has no students and no exams.`,
    };
  }
  return describeNameError(error, COPY.noun);
}

export function ClassesScreen() {
  const useCases = useClassUseCases();
  const subjectUseCases = useSubjectUseCases();
  const classSubjectUseCases = useClassSubjectUseCases();

  const operations = useMemo<NameListOperations | null>(
    () =>
      useCases &&
      classSubjectUseCases && {
        // Each row also says how many subjects the class has.
        async list() {
          const [classes, subjectCounts] = await Promise.all([
            useCases.listClasses(),
            classSubjectUseCases.countSubjectsByClass(),
          ]);
          return classes.map((schoolClass) => {
            const count = subjectCounts[schoolClass.id] ?? 0;
            return {
              id: schoolClass.id,
              name: schoolClass.name,
              detail: count === 0 ? 'No subjects' : countOf(count, 'subject'),
            };
          });
        },
        add: useCases.addClass,
        rename: useCases.renameClass,
        remove: useCases.deleteClass,
      },
    [useCases, classSubjectUseCases]
  );

  const manageSubjects = useMemo<RowDialogAction | undefined>(
    () =>
      subjectUseCases && classSubjectUseCases
        ? {
            icon: ListChecks,
            label: (record) => `Manage subjects for ${record.name}`,
            renderDialog: (record, controls) => (
              <ManageClassSubjectsDialog
                schoolClass={record}
                subjectUseCases={subjectUseCases}
                classSubjectUseCases={classSubjectUseCases}
                onCancel={controls.close}
                onSaved={controls.done}
                onClassMissing={controls.missing}
              />
            ),
          }
        : undefined,
    [subjectUseCases, classSubjectUseCases]
  );

  return (
    <NameListScreen
      title={destinationTitle('classes')}
      icon={Users}
      copy={COPY}
      maxNameLength={CLASS_NAME_MAX_LENGTH}
      operations={operations}
      describeError={describeClassError}
      rowAction={manageSubjects}
    />
  );
}
