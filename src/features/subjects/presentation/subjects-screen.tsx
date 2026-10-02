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
import { SubjectInUseError } from '@/features/subjects/application/subject-repository';
import { SUBJECT_NAME_MAX_LENGTH } from '@/features/subjects/domain/subject';
import { useSubjectUseCases } from '@/features/subjects/presentation/subject-use-cases-context';

const COPY: NameListCopy = {
  noun: 'subject',
  pluralNoun: 'subjects',
  intro: 'A subject is what you teach. Each exam belongs to one subject and one class.',
  emptyHint: 'Add the first subject you teach, such as Mathematics or Data Structures.',
  namePlaceholder: 'Mathematics',
};

function describeSubjectError(error: unknown): ErrorDescription {
  if (error instanceof SubjectInUseError) {
    return {
      kind: 'blocked',
      message: `This subject is used by ${countOf(error.examCount, 'exam')}. A subject can be deleted only when no exam uses it.`,
    };
  }
  return describeNameError(error, COPY.noun);
}

export function SubjectsScreen() {
  const useCases = useSubjectUseCases();
  const operations = useMemo<NameListOperations | null>(
    () =>
      useCases && {
        list: useCases.listSubjects,
        add: useCases.addSubject,
        rename: useCases.renameSubject,
        remove: useCases.deleteSubject,
      },
    [useCases]
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
