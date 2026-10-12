interface Input {
  tenantId: string;
  type: 'BACKUP' | 'BUSINESS_CONTINUITY';
  name: string;
  description?: string;
  sharingModel: 'SHARED' | 'PRIVATE';
  teamIds?: string[];
  memberId?: string;
  creatorMemberId?: string;
  moderatedAccess?: boolean;
  selectedModeratorIds?: string[];
  requestedMinimumApprovals?: number;
  requireAuth?: boolean;
  authenticationMode?: 'EXCLUSIVE' | 'ALL_REQUIRED';
  approvalMode?: 'THRESHOLD' | 'UNANIMOUS';
  authenticationMethodIds?: string[];
  categoryId?: string | null;
  assets?: unknown[];
}

export function buildPlanCreatePayload(input: Input) {
  const privatePlan = input.sharingModel === 'PRIVATE';
  const moderated = !privatePlan && !!input.moderatedAccess;
  const moderatorIds = moderated
    ? Array.from(
        new Set([input.creatorMemberId, ...(input.selectedModeratorIds ?? [])].filter(Boolean)),
      )
    : [];
  const minimumApprovals = !moderated
    ? undefined
    : input.approvalMode === 'UNANIMOUS'
      ? Math.max(moderatorIds.length, 1)
      : Math.min(
          Math.max(input.requestedMinimumApprovals ?? 1, 1),
          Math.max(moderatorIds.length, 1),
        );
  const authenticationMethods = input.requireAuth
    ? (input.authenticationMethodIds ?? []).map((id) => ({ id }))
    : [];
  return {
    tenantId: input.tenantId,
    type: input.type,
    name: input.name,
    description: input.description,
    privacyMode: privatePlan ? ('PRIVATE' as const) : ('PUBLIC' as const),
    moderators: moderated ? moderatorIds.map((id) => ({ id })) : undefined,
    minimumApprovals,
    authenticationMethods: authenticationMethods.length ? authenticationMethods : undefined,
    authenticationMode: authenticationMethods.length ? input.authenticationMode : undefined,
    approvalMode: moderated ? (input.approvalMode ?? 'THRESHOLD') : undefined,
    accessPolicy: {
      teams: { allow: privatePlan ? [] : (input.teamIds ?? []), deny: [] },
      members: {
        allow:
          privatePlan && (input.memberId ?? input.creatorMemberId)
            ? [input.memberId ?? input.creatorMemberId]
            : [],
        deny: [],
      },
    },
    assets: input.assets ?? [],
    categoryId: input.categoryId ?? null,
  };
}
