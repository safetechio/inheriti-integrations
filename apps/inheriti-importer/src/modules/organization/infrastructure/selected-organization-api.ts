import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { unwrapList, useApiQuery } from '@shared/infrastructure/importer-api/http';

const selectedOrganizationKey = 'selectedOrganizationId';

export function useGetRawSelectedOrganizationId() {
  const data = localStorage.getItem(selectedOrganizationKey);
  return { data, loading: false };
}

export function useGetSelectedOrganizationId() {
  return localStorage.getItem(selectedOrganizationKey);
}

export function useSwitchToOrganization() {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  return {
    loading,
    switchToOrganization: async (organizationId: string) => {
      setLoading(true);
      try {
        localStorage.setItem(selectedOrganizationKey, organizationId);
        await queryClient.invalidateQueries();
      } finally {
        setLoading(false);
      }
    },
  };
}

type Organization = {
  id: string;
  name: string;
  userId?: string;
  settings?: OrganizationSettings;
  standbyPeriod?: unknown;
  standbyPeriodInfo?: unknown;
};

type OrganizationSettings = {
  backupPlans?: { allowPrivatePlans?: boolean };
  authentication?: {
    allowNoAuthentication?: boolean;
    enabledMethods?: Record<string, boolean>;
    threshold?: 'per_plan' | 'require_one' | 'require_all';
  };
  moderation?: {
    allowNoModeration?: boolean;
    approvalMode?: 'PER_PLAN' | 'THRESHOLD' | 'UNANIMOUS';
    autoModerator?: boolean;
  };
};

export function useGetSelectedOrganization() {
  const id = useGetSelectedOrganizationId();
  return useApiQuery<Organization>(
    ['organization', id],
    id ? `/organizations/${encodeURIComponent(id)}` : null,
  );
}

export function useGetMyOrganization(options?: { enabled?: boolean }) {
  const organizations = useApiQuery<Organization[] | { items?: Organization[] }>(
    ['organizations'],
    options?.enabled === false ? null : '/organizations',
  );
  const profile = useApiQuery<{ id: string }>(
    ['profile'],
    options?.enabled === false ? null : '/user/profile',
  );
  return {
    ...organizations,
    data: unwrapList(organizations.data).find(
      (organization) => organization.userId === profile.data?.id,
    ),
    loading: organizations.loading || profile.loading,
  };
}

export function useGetJoinedOrganizations(options?: { enabled?: boolean }) {
  const organizations = useApiQuery<Organization[] | { items?: Organization[] }>(
    ['organizations'],
    options?.enabled === false ? null : '/organizations',
  );
  const profile = useApiQuery<{ id: string }>(
    ['profile'],
    options?.enabled === false ? null : '/user/profile',
  );
  return {
    ...organizations,
    data: unwrapList(organizations.data).filter(
      (organization) => organization.userId !== profile.data?.id,
    ),
    loading: organizations.loading || profile.loading,
  };
}

export function useGetIdentity() {
  const result = useApiQuery<{
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  }>(['profile'], '/user/profile');
  return {
    ...result,
    identity: result.data
      ? {
          id: result.data.id,
          fullName: [result.data.firstName, result.data.lastName].filter(Boolean).join(' '),
          email: result.data.email,
        }
      : undefined,
  };
}
