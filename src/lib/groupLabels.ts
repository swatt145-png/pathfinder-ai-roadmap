export type GroupType = 'classroom' | 'team' | 'study_group';

export interface GroupLabels {
  group: string;
  owner: string;
  member: string;
  members: string;
  assign: string;
}

const LABELS: Record<GroupType, GroupLabels> = {
  classroom: { group: 'Classroom', owner: 'Professor', member: 'Student', members: 'Students', assign: 'Assign' },
  team:      { group: 'Team',      owner: 'Manager',   member: 'Member',  members: 'Members',  assign: 'Assign' },
  study_group: { group: 'Study Group', owner: 'Admin', member: 'Member',  members: 'Members',  assign: 'Share' },
};

export function getGroupLabels(type: GroupType): GroupLabels {
  return LABELS[type] ?? LABELS.study_group;
}
