import {
  Mission,
  type DefineAcceptanceGates,
  type DraftMission,
  type MissionOpenedResult,
  type MissionResult,
  type OpenMission,
} from "../domain/mission.js";
import {
  hasExactOwnKeys,
  hasJsonContentTopology,
  isJsonObject,
} from "../domain/json-topology.js";

export type CreateAndOpenMission = DraftMission &
  DefineAcceptanceGates &
  OpenMission;

export interface CreatedMission {
  readonly mission: Mission;
  readonly opened: MissionOpenedResult;
}

/**
 * The public create operation is one application decision. A caller receives
 * no aggregate unless Draft -> DefineAcceptanceGates -> Open all succeed.
 * Persistence, process creation, events, and outbox commands belong in one
 * MissionControlUnitOfWork transaction when an adapter is added.
 */
export function createAndOpenMission(
  command: CreateAndOpenMission,
): MissionResult<CreatedMission> {
  if (
    !isJsonObject(command) ||
    !hasExactOwnKeys(command, [
      "missionId",
      "missionRevision",
      "objective",
      "startingRevision",
      "workspaceReference",
      "allowedScope",
      "requestedCapabilities",
      "attemptBudget",
      "acceptanceGates",
      "gateSetDigest",
      "attemptId",
    ]) ||
    !hasJsonContentTopology(command)
  )
    return {
      ok: false,
      error: {
        code: "INVALID_MISSION",
        message: "Mission create input is invalid.",
      },
    };
  const drafted = Mission.draft({
    missionId: command.missionId,
    missionRevision: command.missionRevision,
    objective: command.objective,
    startingRevision: command.startingRevision,
    workspaceReference: command.workspaceReference,
    allowedScope: command.allowedScope,
    requestedCapabilities: command.requestedCapabilities,
    attemptBudget: command.attemptBudget,
  });
  if (!drafted.ok) return drafted;
  const mission = drafted.value;
  const defined = mission.defineAcceptanceGates({
    acceptanceGates: command.acceptanceGates,
    gateSetDigest: command.gateSetDigest,
  });
  if (!defined.ok) return defined;
  const opened = mission.open({ attemptId: command.attemptId });
  if (!opened.ok) return opened;
  return {
    ok: true,
    disposition: "applied",
    value: { mission, opened: opened.value },
    events: opened.events,
  };
}
