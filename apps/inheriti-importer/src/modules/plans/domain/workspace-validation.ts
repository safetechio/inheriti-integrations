import { materialisePlanAssets, type MaterialisationFieldError } from './asset-materializer';
import { planDraftView, type PlanDraftIssue } from './workspace-selectors';
import type { ImportSession } from '@modules/import/domain/import-model';
import type { PlanDraft } from './workspace-model';
import type { PlanCreationOrgPolicy } from '@modules/organization/infrastructure/importer-api';
import { validateAssetEditorValues } from './asset-metadata';

export interface PlanExecutionValidation {
  valid: boolean;
  issues: PlanDraftIssue[];
  materialisationErrors: MaterialisationFieldError[];
}

function validatePlanCreationPolicy(plan: PlanDraft, policy: PlanCreationOrgPolicy): string[] {
  const violations: string[] = [];
  if (plan.governance.sharingModel === 'PRIVATE' && !policy.privateAllowed)
    violations.push('Private plans are disabled by organization settings.');
  if (
    plan.governance.sharingModel === 'SHARED' &&
    policy.moderationRequired &&
    !plan.governance.moderatedAccess
  )
    violations.push('Moderation is required by organization settings.');
  if (policy.authRequired && plan.governance.authenticationMethodIds.length === 0)
    violations.push('Authentication is required by organization settings.');
  const enabledMethods = new Set(
    Object.keys(policy.enabledMethods).filter((id) => policy.enabledMethods[id]),
  );
  if (enabledMethods.size > 0) {
    for (const methodId of plan.governance.authenticationMethodIds) {
      if (!enabledMethods.has(methodId))
        violations.push(
          `Authentication method "${methodId}" is disabled by organization settings.`,
        );
    }
  }
  return violations;
}

/** Preflight gate for create/configure. No remote operation may start when it fails. */
export function validatePlanForExecution(
  plan: PlanDraft,
  session: ImportSession,
  policy?: PlanCreationOrgPolicy,
): PlanExecutionValidation {
  const view = planDraftView(plan);
  const materialised = materialisePlanAssets(plan, session);
  const issues = [...view.issues];

  if (policy) {
    for (const message of validatePlanCreationPolicy(plan, policy)) {
      issues.push({ code: 'POLICY_VIOLATION', message });
    }
  }

  for (const error of materialised.errors) {
    issues.push({
      code: 'STALE_REFERENCE',
      message: error.message,
      assetId: error.assetId,
    });
  }

  for (const asset of materialised.assets) {
    if (materialised.errors.some((error) => error.assetId === asset.id)) continue;
    const validationErrors = validateAssetEditorValues(asset.type, {
      meta: asset.meta,
      secret: asset.secret,
    });
    for (const [assetFieldSource, message] of Object.entries(validationErrors)) {
      const fieldError: MaterialisationFieldError = {
        assetId: asset.id ?? '',
        assetFieldSource,
        code: 'INVALID_VALUE',
        message,
      };
      materialised.errors.push(fieldError);
      issues.push({
        code: 'ASSET_INCOMPLETE',
        message,
        assetId: asset.id,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    materialisationErrors: materialised.errors,
  };
}

export function validateWorkspaceForExecution(
  plans: readonly PlanDraft[],
  session: ImportSession,
  policy?: PlanCreationOrgPolicy,
): Map<string, PlanExecutionValidation> {
  return new Map(
    plans.map((plan) => [plan.clientId, validatePlanForExecution(plan, session, policy)]),
  );
}
