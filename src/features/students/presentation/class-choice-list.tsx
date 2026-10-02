import { ChoiceList } from '@/core/presentation/components/choice-list';

type ClassChoiceListProps = {
  classes: readonly { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (classId: string | null) => void;
  /** Adds a first option that selects no class, with this label. */
  noneLabel?: string;
  disabled?: boolean;
  /** Accessible name of the whole group, such as "Class". */
  label: string;
};

/** A single-choice list of the existing classes. */
export function ClassChoiceList({ classes, ...props }: ClassChoiceListProps) {
  return <ChoiceList options={classes} {...props} />;
}
