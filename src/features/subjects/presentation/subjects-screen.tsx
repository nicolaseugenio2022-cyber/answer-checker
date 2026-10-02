import BookOpen from 'lucide-react-native/icons/book-open';
import { useMemo } from 'react';

import {
  NameListScreen,
  type NameListCopy,
  type NameListOperations,
} from '@/core/presentation/components/name-list-screen';
import {
  countOf,
  describeNameError,
  type ErrorDescription,
} from '@/core/presentation/lib/describe-name-error';
import { destinationTitle } from '@/core/presentation/navigation/destinations';
import { useClassSubjectUseCases } from '@/features/class-subjects/presentation/class-subject-use-cases-context';
import { SubjectInUseError } from '@/features/subjects/application/subject-repository';
import { SUBJECT_NAME_MAX_LENGTH } from '@/features/subjects/domain/subject';
import { useSubjectUseCases } from '@/features/subjects/presentation/subject-use-cases-context';

const COPY: NameListCopy = {
  noun: 'subject',
  pluralNoun: 'subjects',
  intro:
    'A subject is what you teach. Choose which classes take it from Classes, with Manage subjects.',
  emptyHint: 'Add the first subject you teach, such as Mathematics or Data Structures.',
  namePlaceholder: 'Mathematics',
};

function describeSubjectError(error: unknown): ErrorDescription {
  if (error instanceof SubjectInUseError) {
    return {
      kind: 'blocked',
      message: `This subject has ${countOf(error.answerKeyCount, 'answer key')}. Delete those answer keys permanently first; then the subject can be deleted.`,
    };
  }
  return describeNameError(error, COPY.noun);
}

export function SubjectsScreen() {
  const useCases = useSubjectUseCases();
  const classSubjectUseCases = useClassSubjectUseCases();
  const operations = useMemo<NameListOperations | null>(
    () =>
      useCases &&
      classSubjectUseCases && {
        // Each row also says how many classes are taught the subject. The
        // assignment itself is edited from Classes.
        async list() {
          const [subjects, classCounts] = await Promise.all([
            useCases.listSubjects(),
            classSubjectUseCases.countClassesBySubject(),
          ]);
          return subjects.map((subject) => {
            const count = classCounts[subject.id] ?? 0;
            return {
              id: subject.id,
              name: subject.name,
              detail:
                count === 0 ? 'Not assigned to a class' : `Taught to ${countOf(count, 'class', 'classes')}`,
            };
          });
        },
        add: useCases.addSubject,
        rename: useCases.renameSubject,
        remove: useCases.deleteSubject,
      },
    [useCases, classSubjectUseCases]
  );

  return (
    <NameListScreen
      title={destinationTitle('subjects')}
      icon={BookOpen}
      copy={COPY}
      maxNameLength={SUBJECT_NAME_MAX_LENGTH}
      operations={operations}
      describeError={describeSubjectError}
    />
  );
}
