import { lockedDeployment } from '../runtime/configuration.js';
import { PROTECTED_FILE_FLAGS, HOST_FEATURE_FLAGS } from '@safetech/inheriti-elements-core/node-base';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MetadataTools } from '../server.js';
import { registerRevealPlanSecret } from './reveal_plan_secret.js';
import { registerDownloadPlanAsset } from './download_plan_asset.js';
import { registerCheckRevealStatus } from './check_reveal_status.js';
import { registerOpenInheritiFile } from './open_inheriti_file.js';
import { registerListOrganizations } from './list_organizations.js';
import { registerCheckUpdate } from './check_update.js';
import { registerSelectOrganization } from './select_organization.js';
import { registerListBackupPlans } from './list_backup_plans.js';
import { registerGetBackupPlan } from './get_backup_plan.js';
import { registerListBackupPlanLogs } from './list_backup_plan_logs.js';
import { registerListMemberLogs } from './list_member_logs.js';
import { registerLogout } from './logout.js';
import { registerAbortPlanAccess } from './abort_plan_access.js';
import { registerCreatePlanWithAssistant } from './create_plan_with_assistant.js';
import { registerCheckPlanCreationStatus } from './check_plan_creation_status.js';
import { registerStartAutomationSetup } from './start_automation_setup.js';
import { registerStartAutomationPairing } from './start_automation_pairing.js';
import { registerPairAwsAutomationService } from './pair_aws_automation_service.js';
import { registerPairGoogleCloudRun } from './pair_google_cloud_run.js';
import { registerPrepareAutomationEc2 } from './prepare_automation_ec2.js';
import { registerInspectAutomationEc2Identity } from './inspect_automation_ec2_identity.js';
import { registerCheckAutomationSetupStatus } from './check_automation_setup_status.js';
import { registerListAutomationConnections } from './list_automation_connections.js';
import { registerListAutomationGrants } from './list_automation_grants.js';
import { registerGithubAutomationUsage } from './github_automation_usage.js';
import { registerGetAutomationRuntimeInstallInstructions } from './get_automation_runtime_install_instructions.js';
import { registerListAutomationMembers } from './list_automation_members.js';
import { registerCreateAutomationConnection } from './create_automation_connection.js';
import { registerChangeAutomationTrust } from './change_automation_trust.js';
import { registerDisableAutomationConnection } from './disable_automation_connection.js';
import { registerCreateAutomationGrant } from './create_automation_grant.js';
import { registerActivateAutomationGrant } from './activate_automation_grant.js';
import { registerReplaceAutomationResponsibleMember } from './replace_automation_responsible_member.js';
import { registerRevokeAutomationGrant } from './revoke_automation_grant.js';
import { registerPrepareAutomationRuntime } from './prepare_automation_runtime.js';
import { registerApplyAutomationRuntime } from './apply_automation_runtime.js';
import { registerInspectAutomationCloudIdentity } from './inspect_automation_cloud_identity.js';
import { registerPublishPlanFieldsToAws } from './publish_plan_fields_to_aws.js';
import { registerPublishPlanFieldsToGoogleCloud } from './publish_plan_fields_to_google_cloud.js';

export function registerTools(server: McpServer, tools: MetadataTools) {
  registerListOrganizations(server, tools);
  registerCheckUpdate(server, tools);
  registerSelectOrganization(server, tools);
  registerListBackupPlans(server, tools);
  registerGetBackupPlan(server, tools);
  registerListBackupPlanLogs(server, tools);
  registerListMemberLogs(server, tools);
  registerLogout(server, tools);
  registerAbortPlanAccess(server, tools);
  registerRevealPlanSecret(server, tools);
  registerDownloadPlanAsset(server, tools);
  registerCheckRevealStatus(server, tools);
  if (lockedDeployment && HOST_FEATURE_FLAGS[lockedDeployment].planCreation) {
    registerCreatePlanWithAssistant(server, tools);
    registerCheckPlanCreationStatus(server, tools);
  }
  if (lockedDeployment && HOST_FEATURE_FLAGS[lockedDeployment].automation) {
    registerStartAutomationSetup(server, tools);
    registerStartAutomationPairing(server, tools);
    registerPairAwsAutomationService(server, tools);
    registerPairGoogleCloudRun(server, tools);
    registerPrepareAutomationEc2(server, tools);
    registerInspectAutomationEc2Identity(server, tools);
    registerCheckAutomationSetupStatus(server, tools);
    registerListAutomationConnections(server, tools);
    registerListAutomationGrants(server, tools);
    registerGithubAutomationUsage(server, tools);
    registerGetAutomationRuntimeInstallInstructions(server, tools);
    registerListAutomationMembers(server, tools);
    registerCreateAutomationConnection(server, tools);
    registerChangeAutomationTrust(server, tools);
    registerDisableAutomationConnection(server, tools);
    registerCreateAutomationGrant(server, tools);
    registerActivateAutomationGrant(server, tools);
    registerReplaceAutomationResponsibleMember(server, tools);
    registerRevokeAutomationGrant(server, tools);
    registerPrepareAutomationRuntime(server, tools);
    registerApplyAutomationRuntime(server, tools);
    registerInspectAutomationCloudIdentity(server, tools);
    registerPublishPlanFieldsToAws(server, tools);
    registerPublishPlanFieldsToGoogleCloud(server, tools);
  }
  if (lockedDeployment && PROTECTED_FILE_FLAGS[lockedDeployment]) {
    registerOpenInheritiFile(server);
  }
}
