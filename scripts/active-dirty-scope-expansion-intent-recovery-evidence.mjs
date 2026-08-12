// Responsibility: Bind one frozen scope intent, its exact heartbeat successor, and terminal live state.
import path from"node:path";import{canonicalJson,digestValue,normalizeWriteSet,validateLedger}from"./cloud-collaboration-primitives.mjs";
import{normalizeActiveDirtyScopeExpansionPlan}from"./active-dirty-scope-expansion-contract.mjs";import{normalizeDeclaredWriteScopeManifest}from"./scoped-lane-admission-lib.mjs";
import{projectPublicClaim,pseudonymousIdentifier}from"./github-cloud-collaboration-mapping.mjs";import{writerLeaseDigest}from"./writer-lease-registry-cas.mjs";
import{projectWriterLeasePullRequestMarker}from"./writer-lease-lib.mjs";const ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_SOURCE_EVIDENCE_SCHEMA="\
agentic-active-dirty-scope-expansion-intent-recovery-source-evidence/v1";const ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_TERMINAL_OBSERVATION_SCHEMA="\
agentic-active-dirty-scope-expansion-intent-recovery-terminal-observation/v1";const LINEAGE_SCHEMA="agentic-active-dirty\
-scope-expansion-intent-recovery-heartbeat-lineage/v1";const DIGEST_PATTERN=/^[0-9a-f]{64}$/u;const SHA_PATTERN=/^[0-9a-f]{40}$/u;
const SOURCE_FIELDS=Object.freeze(["schema","controller","lane","lease","leaseDigest","scopeExpansionIntent","scopeExpan\
sionIntentDigest","targetManifest","currentAuthority","currentClaim","ledgerLineage","pullRequest","dirt","mutationAutho\
rity","sourceEvidenceDigest"]);const INTENT_FIELDS=Object.freeze(["schema","status","branch","sourceLeaseDigest","source\
ClaimId","sourceFenceSha","targetWriteSetDigest","targetManifestDigest","planDigest","targetClaimId","targetClaimDigest",
"targetLeaseEpoch","targetCanonicalBaseSha","targetReviewRequestId","completedReceiptDigest","waiting","waitingReceiptDi\
gest","sourceRetirementReceiptDigest","promoted","promotedReceiptDigest","boundAuthority","boundReceiptDigest","localPro\
jection","localProjectionReceiptDigest","pullRequestProjection","pullRequestProjectionReceiptDigest","finalReceiptDigest",
"planSnapshot"]);function verifyExactScopeExpansionHeartbeatSuffix({historicalLedger,currentLedger,boundAuthority,currentClaim,
historicalSuccessors=null}={}){requireValidLedger(historicalLedger,"Historical");requireValidLedger(currentLedger,"Curre\
nt");const bound=normalizeAuthority(boundAuthority,"historical bound authority");const claim=normalizeClaim(currentClaim);
if(historicalLedger.ledgerRepositoryId!==currentLedger.ledgerRepositoryId||historicalLedger.entries.length>=currentLedger.
entries.length||canonicalJson(currentLedger.entries.slice(0,historicalLedger.entries.length))!==canonicalJson(historicalLedger.
entries)){throw new Error("Current collaboration ledger does not extend the exact historical prefix.")}const historicalEntry=historicalLedger.
entries.findLast(entry=>entry.claimId===bound.claimId);const currentEntry=currentLedger.entries.findLast(entry=>entry.claimId===
bound.claimId);if(!historicalEntry||!currentEntry||historicalLedger.headDigest!==bound.ledgerDigest||historicalEntry.digest!==
bound.claimLedgerRevision||historicalEntry.claimDigest!==bound.claimDigest||historicalEntry.claimCore.transitionCounter!==
bound.transitionCounter){throw new Error("Historical scope-expansion authority does not bind its ledger prefix.")}if(historicalSuccessors){
exactKeys(historicalSuccessors,["waiting","promoted","bound","sourceClaimId","targetReviewRequestId"],"Historical successors");
const sourceClaimId=digest(historicalSuccessors.sourceClaimId,"historical predecessor claim ID");const targetReviewRequestId=text(
historicalSuccessors.targetReviewRequestId,"historical target review request");const phases=[["C1",historicalSuccessors.waiting,"claim","waiting-successor",null],["C2",historicalSuccessors.promoted,"continue","current",null],["C3",historicalSuccessors.bound,
"continue","current",targetReviewRequestId]];for(const[label,phase,action,state,reviewRequestId]of phases){const entry=historicalLedger.
entries.find(candidate=>candidate.digest===phase.claimLedgerRevision);const core=entry?.claimCore;if(!entry||entry.claimId!==phase.
claimId||entry.claimDigest!==phase.claimDigest||core.transitionCounter!==phase.transitionCounter||entry.action!==action||core.state!==
state||core.heartbeatCounter!==0||core.reviewRequestId!==reviewRequestId||core.predecessorClaimId!==sourceClaimId||core.expiresAt!==
phase.expiresAt){throw new Error(`Historical scope-expansion ${label} successor phase is not exact or ledger-backed.`)}}}const suffix=currentLedger.entries.slice(historicalLedger.
entries.length);const targetSuffix=suffix.filter(entry=>entry.claimId===bound.claimId);const unrelatedSuffix=suffix.filter(
entry=>entry.claimId!==bound.claimId);if(targetSuffix.length!==1||targetSuffix[0].digest!==currentEntry.digest||currentEntry.
action!=="continue"){throw new Error("Scope-expansion recovery requires exactly one target heartbeat suffix.")}const before=historicalEntry.
claimCore,after=currentEntry.claimCore;if(canonicalJson(heartbeatStableCore(before))!==canonicalJson(heartbeatStableCore(
after))||after.transitionCounter!==before.transitionCounter+1||after.heartbeatCounter!==before.heartbeatCounter+1||Date.
parse(after.expiresAt)<=Date.parse(before.expiresAt)||currentEntry.claimDigest!==claimDigest(claim)||currentEntry.digest!==
claim.transitionDigest||claim.claimId!==bound.claimId||claim.transitionCounter!==after.transitionCounter||claim.heartbeatCounter!==
after.heartbeatCounter||claim.expiresAt!==after.expiresAt){throw new Error("Scope-expansion successor changed outside on\
e exact heartbeat renewal.")}const core={schema:LINEAGE_SCHEMA,claimId:bound.claimId,historicalLedgerDigest:digestValue(
historicalLedger),historicalHeadDigest:historicalLedger.headDigest,historicalSequence:historicalLedger.sequence,historicalTransitionDigest:historicalEntry.
digest,historicalClaimDigest:historicalEntry.claimDigest,historicalTransitionCounter:before.transitionCounter,historicalHeartbeatCounter:before.
heartbeatCounter,currentLedgerDigest:digestValue(currentLedger),currentHeadDigest:currentLedger.headDigest,currentSequence:currentLedger.
sequence,currentTransitionDigest:currentEntry.digest,currentClaimDigest:currentEntry.claimDigest,currentTransitionCounter:after.
transitionCounter,currentHeartbeatCounter:after.heartbeatCounter,currentExpiresAt:after.expiresAt,targetSuffixDigest:digestValue(
targetSuffix),unrelatedSuffixDigest:digestValue(unrelatedSuffix)};return deepFreeze({...core,lineageDigest:digestValue(core)})}
function buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence(input,{expectedIntentStatus="successor-bound"}={}){object(
input,"Recovery source input");const lease=snapshot(input.lease,"writer lease");const sourceIntent=normalizeRecoverableScopeExpansionIntent(
input.scopeExpansionIntent,{expectedStatus:expectedIntentStatus});const core={schema:ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_SOURCE_EVIDENCE_SCHEMA,
controller:normalizeController(input.controller),lane:normalizeLane(input.lane),lease,leaseDigest:matchingDigest(input.leaseDigest??
writerLeaseDigest(lease),writerLeaseDigest(lease),"writer lease digest"),scopeExpansionIntent:sourceIntent,scopeExpansionIntentDigest:matchingDigest(
input.scopeExpansionIntentDigest??digestValue(sourceIntent),digestValue(sourceIntent),"scope-expansion intent digest"),targetManifest:normalizeTargetManifest(
input.targetManifest,lease.scope),currentAuthority:normalizeAuthority(input.currentAuthority,"current authority"),currentClaim:normalizeClaim(
input.currentClaim),ledgerLineage:normalizeLineage(input.ledgerLineage),pullRequest:normalizePullRequest(input.pullRequest),
dirt:normalizeDirt(input.dirt),mutationAuthority:normalizeMutationAuthority(input.mutationAuthority)};assertSourceJoins(
core);return deepFreeze({...core,sourceEvidenceDigest:digestValue(core)})}function normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence(value){
object(value,"Recovery source evidence");exactKeys(value,SOURCE_FIELDS,"Recovery source evidence");const normalized=buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence(
value);if(value.schema!==ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_SOURCE_EVIDENCE_SCHEMA||value.sourceEvidenceDigest!==
normalized.sourceEvidenceDigest)throw new Error("Recovery source evidence digest drifted.");return normalized}const assertActiveDirtyScopeExpansionIntentRecoverySourceEvidence=normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence;
function normalizeRecoverableScopeExpansionIntent(value,{expectedStatus=null}={}){object(value,"Scope-expansion intent");
exactKeys(value,INTENT_FIELDS,"Scope-expansion intent");const plan=normalizeActiveDirtyScopeExpansionPlan(value.planSnapshot);
const intent={schema:text(value.schema,"scope-expansion intent schema"),status:text(value.status,"scope-expansion intent\
 status"),branch:text(value.branch,"scope-expansion intent branch"),sourceLeaseDigest:digest(value.sourceLeaseDigest,"so\
urce lease digest"),sourceClaimId:digest(value.sourceClaimId,"source claim ID"),sourceFenceSha:sha(value.sourceFenceSha,
"source fence SHA"),targetWriteSetDigest:digest(value.targetWriteSetDigest,"target write-set digest"),targetManifestDigest:digest(
value.targetManifestDigest,"target manifest digest"),planDigest:digest(value.planDigest,"plan digest"),targetClaimId:nullableDigest(
value.targetClaimId,"target claim ID"),targetClaimDigest:nullableDigest(value.targetClaimDigest,"target claim digest"),targetLeaseEpoch:integer(
value.targetLeaseEpoch,"target lease epoch",1),targetCanonicalBaseSha:sha(value.targetCanonicalBaseSha,"target base SHA"),
targetReviewRequestId:nullableText(value.targetReviewRequestId,"target review request"),completedReceiptDigest:nullableDigest(
value.completedReceiptDigest,"completed receipt digest"),waiting:nullableHistoricalSuccessor(value.waiting,"waiting succ\
essor"),waitingReceiptDigest:nullableDigest(value.waitingReceiptDigest,"waiting receipt digest"),sourceRetirementReceiptDigest:nullableDigest(
value.sourceRetirementReceiptDigest,"source retirement receipt digest"),promoted:nullableHistoricalSuccessor(value.promoted,
"promoted successor"),promotedReceiptDigest:nullableDigest(value.promotedReceiptDigest,"promoted receipt digest"),boundAuthority:value.
boundAuthority==null?null:normalizeAuthority(value.boundAuthority,"bound authority"),boundReceiptDigest:nullableDigest(value.
boundReceiptDigest,"bound receipt digest"),localProjection:nullableSnapshot(value.localProjection,"local projection"),localProjectionReceiptDigest:nullableDigest(
value.localProjectionReceiptDigest,"local projection receipt digest"),pullRequestProjection:nullableSnapshot(value.pullRequestProjection,
"PR projection"),pullRequestProjectionReceiptDigest:nullableDigest(value.pullRequestProjectionReceiptDigest,"PR projecti\
on receipt digest"),finalReceiptDigest:nullableDigest(value.finalReceiptDigest,"final receipt digest"),planSnapshot:plan};
if(intent.schema!=="agentic-active-dirty-scope-expansion-intent/v1"||!["successor-bound","complete"].includes(intent.status)||
expectedStatus&&intent.status!==expectedStatus||intent.targetLeaseEpoch!==1||intent.planDigest!==plan.planDigest||intent.
branch!==plan.sourceBranch||intent.sourceLeaseDigest!==plan.sourceLeaseDigest||intent.sourceClaimId!==plan.sourceClaimId||
intent.sourceFenceSha!==plan.sourceFenceSha||intent.targetWriteSetDigest!==plan.targetWriteSetDigest||intent.targetManifestDigest!==
plan.targetManifestDigest||intent.targetCanonicalBaseSha!==plan.targetCanonicalBaseSha||!intent.targetClaimId||!intent.targetClaimDigest||
!intent.targetReviewRequestId||!intent.waiting||!intent.waitingReceiptDigest||!intent.sourceRetirementReceiptDigest||!intent.
promoted||!intent.promotedReceiptDigest||!intent.boundAuthority||!intent.boundReceiptDigest){throw new Error("Scope-expa\
nsion intent is not an exact recoverable successor.")}const projected=[intent.localProjection,intent.localProjectionReceiptDigest,
intent.pullRequestProjection,intent.pullRequestProjectionReceiptDigest,intent.finalReceiptDigest];if(intent.status==="su\
ccessor-bound"&&projected.some(item=>item!==null)||intent.status==="complete"&&projected.some(item=>item===null))throw new Error(
"Scope-expansion intent projection phase is inconsistent.");assertHistoricalSuccessorChain(intent,plan);return deepFreeze(
intent)}function normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation(value,{planDigest,operationKey,sourceEvidenceDigest,
sourceEvidence}={}){object(value,"Recovery terminal observation");exactKeys(value,["schema","state","planDigest","operat\
ionKey","sourceEvidenceDigest","recoveredScopeExpansionIntent","recoveredScopeExpansionIntentDigest","currentAuthorityDi\
gest","heartbeatLineageDigest","currentLeaseDigest","pullRequestMarkerDigest","mutationAuthorityReceiptDigest","finalRec\
eiptDigest","observationDigest"],"Recovery terminal observation");const recovered=normalizeRecoverableScopeExpansionIntent(
value.recoveredScopeExpansionIntent,{expectedStatus:"complete"});const source=normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence(
sourceEvidence);assertTerminalProjection(source,recovered);const core={schema:text(value.schema,"terminal observation sc\
hema"),state:text(value.state,"terminal observation state"),planDigest:digest(value.planDigest,"terminal plan digest"),operationKey:digest(
value.operationKey,"terminal operation key"),sourceEvidenceDigest:digest(value.sourceEvidenceDigest,"terminal source-evi\
dence digest"),recoveredScopeExpansionIntent:recovered,recoveredScopeExpansionIntentDigest:matchingDigest(value.recoveredScopeExpansionIntentDigest,
digestValue(recovered),"recovered scope-expansion intent digest"),currentAuthorityDigest:digest(value.currentAuthorityDigest,
"current authority digest"),heartbeatLineageDigest:digest(value.heartbeatLineageDigest,"heartbeat lineage digest"),currentLeaseDigest:digest(
value.currentLeaseDigest,"current lease digest"),pullRequestMarkerDigest:digest(value.pullRequestMarkerDigest,"pull-requ\
est marker digest"),mutationAuthorityReceiptDigest:digest(value.mutationAuthorityReceiptDigest,"mutation-authority recei\
pt digest"),finalReceiptDigest:digest(value.finalReceiptDigest,"final receipt digest")};if(core.schema!==ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_TERMINAL_OBSERVATION_SCHEMA||
core.state!=="complete"||core.planDigest!==digest(planDigest,"expected plan digest")||core.operationKey!==digest(operationKey,
"expected operation key")||core.sourceEvidenceDigest!==digest(sourceEvidenceDigest,"expected source-evidence digest")||core.
sourceEvidenceDigest!==source.sourceEvidenceDigest||core.currentAuthorityDigest!==digestValue(source.currentAuthority)||
core.heartbeatLineageDigest!==source.ledgerLineage.lineageDigest||core.currentLeaseDigest!==source.leaseDigest||core.pullRequestMarkerDigest!==
source.pullRequest.markerDigest||core.mutationAuthorityReceiptDigest!==source.mutationAuthority.receiptDigest||core.finalReceiptDigest!==
recovered.finalReceiptDigest||value.observationDigest!==digestValue(core)){throw new Error("Recovery terminal observatio\
n drifted.")}return deepFreeze({...core,observationDigest:value.observationDigest})}function buildActiveDirtyScopeExpansionIntentRecoveryTerminalObservation({
plan,operationKey,recoveredScopeExpansionIntent}={}){object(plan,"Recovery plan");const source=normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence(
plan.sourceEvidence);if(plan.sourceEvidenceDigest!==source.sourceEvidenceDigest){throw new Error("Recovery plan source e\
vidence drifted.")}const recovered=normalizeRecoverableScopeExpansionIntent(recoveredScopeExpansionIntent,{expectedStatus:"\
complete"});assertTerminalProjection(source,recovered);const core={schema:ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_TERMINAL_OBSERVATION_SCHEMA,
state:"complete",planDigest:digest(plan.planDigest,"terminal plan digest"),operationKey:digest(operationKey,"terminal op\
eration key"),sourceEvidenceDigest:source.sourceEvidenceDigest,recoveredScopeExpansionIntent:recovered,recoveredScopeExpansionIntentDigest:digestValue(
recovered),currentAuthorityDigest:digestValue(source.currentAuthority),heartbeatLineageDigest:source.ledgerLineage.lineageDigest,
currentLeaseDigest:source.leaseDigest,pullRequestMarkerDigest:source.pullRequest.markerDigest,mutationAuthorityReceiptDigest:source.
mutationAuthority.receiptDigest,finalReceiptDigest:recovered.finalReceiptDigest};return deepFreeze({...core,observationDigest:digestValue(
core)})}function classifyActiveDirtyScopeExpansionIntentRecoveryTerminal(value,expected={}){if(value==null||value?.state===
"pending")return Object.freeze({state:"pending",observation:null});const observation=normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation(
value,expected);return Object.freeze({state:"complete",observation})}function normalizeController(value){object(value,"P\
rotected controller");const result={path:absolute(value.path,"controller path"),origin:text(value.origin,"controller ori\
gin"),targetRepository:repository(value.targetRepository,"target repository"),headSha:sha(value.headSha,"controller HEAD"),
originMainSha:sha(value.originMainSha,"controller origin/main"),remoteMainSha:sha(value.remoteMainSha,"controller remote\
 main"),treeSha:sha(value.treeSha,"controller tree"),clean:value.clean,implementationDigest:digest(value.implementationDigest,
"implementation digest")};if(result.clean!==true||result.headSha!==result.originMainSha||result.headSha!==result.remoteMainSha){
throw new Error("Recovery requires one clean exact protected controller main.")}return deepFreeze(result)}function normalizeTargetManifest(value,expectedScope){
if(Array.isArray(value?.paths)){return normalizeDeclaredWriteScopeManifest(value,{expectedScope})}object(value,"Target w\
rite-scope manifest");const declaredWriteSet=normalizeWriteSet(value.declaredWriteSet);const result={schema:text(value.schema,
"target manifest schema"),semanticScope:text(value.semanticScope,"target semantic scope"),declaredWriteSet:deepFreeze(declaredWriteSet),
manifestDigest:digest(value.manifestDigest,"target manifest digest"),writeSetDigest:digest(value.writeSetDigest,"target \
write-set digest")};if(result.schema!=="agentic-declared-write-scope/v1"||result.semanticScope!==expectedScope||!declaredWriteSet.
includes(`semantic:${expectedScope}`)||result.writeSetDigest!==digestValue(declaredWriteSet)){throw new Error("Target wr\
ite-scope manifest is malformed.")}return deepFreeze(result)}function normalizeLane(value){object(value,"Recovery lane");
const result={path:absolute(value.path,"lane path"),branch:text(value.branch,"lane branch"),headSha:sha(value.headSha,"l\
ane HEAD"),remoteHeadSha:sha(value.remoteHeadSha,"remote lane HEAD"),dirty:value.dirty,changedPaths:paths(value.changedPaths,
"lane changed paths"),untrackedPaths:paths(value.untrackedPaths??[],"lane untracked paths",true),dirtyDigest:digest(value.
dirtyDigest,"lane dirty digest")};if(result.dirty!==true||result.headSha!==result.remoteHeadSha||result.changedPaths.length===
0||result.untrackedPaths.length>0){throw new Error("Recovery requires exact tracked dirty bytes at the remote fence.")}return deepFreeze(
result)}function normalizeAuthority(value,label){const authority=snapshot(value,label);for(const[key,validator]of[["clai\
mId",digest],["claimDigest",digest],["ledgerRevision",sha],["ledgerDigest",digest],["claimLedgerRevision",digest],["cano\
nicalBaseSha",sha],["laneRevision",sha],["writeSetDigest",digest]])validator(authority[key],`${label} ${key}`);integer(authority.
transitionCounter,`${label} transition counter`,1);integer(authority.leaseEpoch,`${label} lease epoch`,1);if(authority.schema!==
"agentic-lane-cloud-authority/v1"||authority.state!=="active"||!authority.reviewRequestId){throw new Error(`${label} is \
not active bound authority.`)}return authority}function nullableHistoricalSuccessor(value,label){if(value==null)return null;
object(value,label);exactKeys(value,["claimId","claimDigest","ledgerRevision","claimLedgerRevision","transitionCounter",
"expiresAt"],label);return deepFreeze({claimId:digest(value.claimId,`${label} claim ID`),claimDigest:digest(value.claimDigest,
`${label} claim digest`),ledgerRevision:sha(value.ledgerRevision,`${label} ledger revision`),claimLedgerRevision:digest(
value.claimLedgerRevision,`${label} claim ledger revision`),transitionCounter:integer(value.transitionCounter,`${label} \
transition counter`,1),expiresAt:instant(value.expiresAt,`${label} expiry`)})}function normalizeClaim(value){const raw=snapshot(
value,"current cloud claim");if(raw.claimDigest&&raw.fenceRevision&&raw.claimDigest!==raw.fenceRevision||raw.transitionDigest&&
raw.ledgerRevision&&raw.transitionDigest!==raw.ledgerRevision){throw new Error("Current cloud claim digest projections d\
isagree.")}const claim=deepFreeze({...raw,claimDigest:claimDigest(raw),transitionDigest:digest(raw.transitionDigest??raw.
ledgerRevision,"current claim transition digest"),integrationReceiptDigest:raw.integrationReceiptDigest??null,integration:raw.integration??null});for(const key of["claimId","writeS\
etDigest","transitionDigest"]){digest(claim[key],`current claim ${key}`)}claimDigest(claim);integer(claim.transitionCounter,
"current claim transition counter",1);integer(claim.heartbeatCounter,"current claim heartbeat counter",0);instant(claim.
expiresAt,"current claim expiry");for(const key of["actorId","repositoryId","workItemId","deviceId","sessionId","canonic\
alBaseRevision","laneRevision","reviewRequestId","entrySchema","claimIdentitySchema","operationReceiptDigest"])text(claim[key],
`current claim ${key}`);if(!Array.isArray(claim.declaredWriteScope)||digestValue(normalizeWriteSet(claim.declaredWriteScope))!==
claim.writeSetDigest||claim.entrySchema!=="agentic-cloud-collaboration-entry/v2"||claim.claimIdentitySchema!=="agentic-c\
loud-collaboration-entry/v2"||!/^github-user:\d+$/u.test(claim.actorId)||!/^github-repository:[^\s]+$/u.test(claim.repositoryId)||
claim.state!=="current"||claim.recordedState!=="current"||claim.writeAuthority!==true||claim.scopeReserved!==true||claim.
integrationReceiptDigest!==null||claim.integration!==null){throw new Error("Current cloud claim is malformed.")}return claim}
function normalizeLineage(value){object(value,"Heartbeat lineage");const fields=["schema","claimId","historicalLedgerDig\
est","historicalHeadDigest","historicalSequence","historicalTransitionDigest","historicalClaimDigest","historicalTransit\
ionCounter","historicalHeartbeatCounter","currentLedgerDigest","currentHeadDigest","currentSequence","currentTransitionD\
igest","currentClaimDigest","currentTransitionCounter","currentHeartbeatCounter","currentExpiresAt","targetSuffixDigest",
"unrelatedSuffixDigest","lineageDigest"];exactKeys(value,fields,"Heartbeat lineage");const{lineageDigest:supplied,...core}=value;
for(const key of fields.filter(key2=>key2.endsWith("Digest")||key2==="claimId")){if(key!=="lineageDigest")digest(core[key],
`heartbeat lineage ${key}`)}for(const key of["historicalSequence","historicalTransitionCounter","currentSequence","curre\
ntTransitionCounter"])integer(core[key],key,1);for(const key of["historicalHeartbeatCounter","currentHeartbeatCounter"])
integer(core[key],key,0);if(core.schema!==LINEAGE_SCHEMA||core.currentSequence<=core.historicalSequence||core.currentTransitionCounter!==
core.historicalTransitionCounter+1||core.currentHeartbeatCounter!==core.historicalHeartbeatCounter+1||instant(core.currentExpiresAt,
"heartbeat lineage current expiry")!==core.currentExpiresAt||supplied!==digestValue(core)){throw new Error("Heartbeat li\
neage evidence is malformed.")}return deepFreeze({...snapshot(core,"heartbeat lineage"),lineageDigest:supplied})}function normalizePullRequest(value){
object(value,"Ownership pull request");const marker=snapshot(value.marker,"pull-request marker");const result={number:integer(
value.number,"pull-request number",1),nodeId:text(value.nodeId,"pull-request node ID"),url:text(value.url,"pull-request \
URL"),state:text(value.state,"pull-request state"),isDraft:value.isDraft,baseRepository:repository(value.baseRepository,
"pull-request base repository"),baseRefName:text(value.baseRefName,"pull-request base ref"),baseRefOid:sha(value.baseRefOid,
"pull-request base SHA"),headRepository:repository(value.headRepository,"pull-request head repository"),headRefName:text(
value.headRefName,"pull-request head ref"),headRefOid:sha(value.headRefOid,"pull-request head SHA"),marker,markerDigest:matchingDigest(
value.markerDigest,digestValue(marker),"pull-request marker digest"),bodyDigest:digest(value.bodyDigest,"pull-request bo\
dy digest")};if(result.state!=="OPEN"||result.isDraft!==true||result.baseRefName!=="main"){throw new Error("Recovery req\
uires the exact open draft ownership pull request.")}return deepFreeze(result)}function normalizeDirt(value){object(value,
"Owned dirt evidence");const result={changedPaths:paths(value.changedPaths,"changed paths"),untrackedPaths:paths(value.untrackedPaths??
[],"untracked paths",true),dirtyDigest:digest(value.dirtyDigest,"owned dirt digest")};if(result.changedPaths.length===0||
result.untrackedPaths.length>0){throw new Error("Recovery requires tracked owned dirt and no untracked bytes.")}return deepFreeze(
result)}function normalizeMutationAuthority(value){object(value,"Mutation-authority receipt");exactKeys(value,["schema",
"status","claimId","claimDigest","claimLedgerRevision","localAuthorityDigest","localLeaseDigest","localLeaseEpoch","loca\
lFenceSha","globalLedgerRevision","globalLedgerDigest","currentClaimDigest","currentClaimInventoryDigest","cloudVerifica\
tionReceiptDigest","evaluatedAt","expiresAt","receiptDigest"],"Recovery mutation authority");const core={schema:text(value.
schema,"mutation schema"),status:text(value.status,"mutation status"),claimId:digest(value.claimId,"mutation claim ID"),
claimDigest:digest(value.claimDigest,"mutation claim digest"),claimLedgerRevision:digest(value.claimLedgerRevision,"muta\
tion transition digest"),localAuthorityDigest:digest(value.localAuthorityDigest,"local authority digest"),localLeaseDigest:digest(
value.localLeaseDigest,"local lease digest"),localLeaseEpoch:integer(value.localLeaseEpoch,"local lease epoch",1),localFenceSha:sha(
value.localFenceSha,"local fence SHA"),globalLedgerRevision:sha(value.globalLedgerRevision,"global ledger revision"),globalLedgerDigest:digest(
value.globalLedgerDigest,"global ledger digest"),currentClaimDigest:digest(value.currentClaimDigest,"current claim diges\
t"),currentClaimInventoryDigest:digest(value.currentClaimInventoryDigest,"claim inventory digest"),cloudVerificationReceiptDigest:digest(
value.cloudVerificationReceiptDigest,"verification receipt digest"),evaluatedAt:instant(value.evaluatedAt,"mutation eval\
uation"),expiresAt:instant(value.expiresAt,"mutation expiry")};if(core.schema!=="agentic-active-dirty-scope-expansion-in\
tent-recovery-mutation-authority/v1"||core.status!=="ready"||value.receiptDigest!==digestValue(core)){throw new Error("M\
utation-authority receipt is malformed or not ready.")}return deepFreeze({...core,receiptDigest:value.receiptDigest})}function assertHistoricalSuccessorChain(intent,plan){
const waiting=intent.waiting,promoted=intent.promoted,bound=intent.boundAuthority;if(![waiting,promoted,bound].every(item=>item.
claimId===intent.targetClaimId)||intent.targetClaimDigest!==bound.claimDigest||canonicalJson([waiting.transitionCounter,
promoted.transitionCounter,bound.transitionCounter])!==canonicalJson([1,2,3])||new Set([waiting.claimDigest,promoted.claimDigest,
bound.claimDigest]).size!==3||new Set([waiting.ledgerRevision,promoted.ledgerRevision,bound.ledgerRevision]).size!==3||new Set(
[waiting.claimLedgerRevision,promoted.claimLedgerRevision,bound.claimLedgerRevision]).size!==3||Date.parse(promoted.expiresAt)<
Date.parse(waiting.expiresAt)||bound.expiresAt!==promoted.expiresAt||canonicalJson([bound.provider,bound.state,bound.canonicalBaseSha,
bound.laneRevision,bound.writeSetDigest,bound.leaseEpoch,bound.reviewRequestId,bound.manifestDigest])!==canonicalJson(["\
github","active",plan.targetCanonicalBaseSha,plan.sourceFenceSha,plan.targetWriteSetDigest,plan.targetCloudLeaseEpoch,plan.
sourceReviewRequestId,plan.targetManifestDigest])||canonicalJson(normalizeWriteSet(bound.cloudDeclaredWriteScope))!==canonicalJson(
plan.targetDeclaredWriteSet)||intent.targetReviewRequestId!==bound.reviewRequestId||bound.claimLedgerRevision!==bound.ledgerDigest){
throw new Error("Scope-expansion historical waiting/promoted/bound chain is inconsistent.")}}function assertSourceJoins(source){
const{controller,lane,lease,scopeExpansionIntent:intent,targetManifest:manifest,currentAuthority:authority,currentClaim:claim,
ledgerLineage:lineage,pullRequest,dirt,mutationAuthority:mutation}=source;if(lease.schema!=="agentic-writer-lease/v2"||lease.
status!=="active"||lease.branch!==lane.branch||path.resolve(lease.worktreePath)!==lane.path||lease.fenceSha!==lane.headSha||
lease.cloudAuthority?.claimId!==authority.claimId||digestValue(lease.cloudAuthority)!==digestValue(authority)||lease.admission?.
status!=="admitted"||lease.admission.manifestDigest!==intent.targetManifestDigest||lease.admission.writeSetDigest!==intent.
targetWriteSetDigest||manifest.manifestDigest!==intent.targetManifestDigest||manifest.writeSetDigest!==intent.targetWriteSetDigest||
controller.targetRepository!==authority.targetRepository||pullRequest.baseRepository!==authority.targetRepository||pullRequest.
headRepository!==authority.targetRepository||authority.provider!=="github"||authority.canonicalBaseSha!==intent.targetCanonicalBaseSha||
authority.canonicalBaseSha!==lease.baseSha||authority.laneRevision!==lane.headSha||authority.writeSetDigest!==manifest.writeSetDigest||
canonicalJson(normalizeWriteSet(authority.cloudDeclaredWriteScope))!==canonicalJson(manifest.declaredWriteSet)||authority.
leaseEpoch!==intent.targetLeaseEpoch||authority.reviewRequestId!==intent.targetReviewRequestId||authority.deviceId!==lease.
device||authority.sessionId!==lease.sessionId||authority.expiresAt!==lease.expiresAt||authority.claimId!==intent.targetClaimId||
authority.claimId!==claim.claimId||authority.claimDigest!==claimDigest(claim)||authority.claimLedgerRevision!==claim.transitionDigest||
authority.transitionCounter!==claim.transitionCounter||authority.heartbeatCounter!==claim.heartbeatCounter||authority.expiresAt!==
claim.expiresAt||claim.entrySchema!==authority.entrySchema||claim.claimIdentitySchema!==authority.claimIdentitySchema||claim.
operationReceiptDigest!==authority.operationReceiptDigest||claim.canonicalBaseRevision!==authority.canonicalBaseSha||claim.
laneRevision!==authority.laneRevision||claim.writeSetDigest!==authority.writeSetDigest||canonicalJson(normalizeWriteSet(
claim.declaredWriteScope))!==canonicalJson(manifest.declaredWriteSet)||claim.leaseEpoch!==authority.leaseEpoch||claim.reviewRequestId!==
authority.reviewRequestId||claim.deviceId!==pseudonymousIdentifier("device",lease.device)||claim.sessionId!==pseudonymousIdentifier("session",lease.sessionId)||claim.predecessorClaimId!==
intent.planSnapshot.sourceClaimId||claim.workItemId!==pseudonymousIdentifier("work-item",lease.scope)||claim.fenceRevision!==
authority.claimDigest||(claim.integrationReceiptDigest??null)!==(authority.integrationReceiptDigest??null)||canonicalJson(claim.integration??null)!==
canonicalJson(authority.integration??null)||authority.transitionCounter!==intent.boundAuthority.transitionCounter+1||lineage.claimId!==
authority.claimId||lineage.historicalClaimDigest!==intent.boundAuthority.claimDigest||lineage.historicalTransitionDigest!==
intent.boundAuthority.claimLedgerRevision||lineage.historicalHeadDigest!==intent.boundAuthority.ledgerDigest||lineage.historicalTransitionCounter!==
intent.boundAuthority.transitionCounter||lineage.currentClaimDigest!==authority.claimDigest||lineage.currentTransitionDigest!==
authority.claimLedgerRevision||lineage.currentTransitionCounter!==authority.transitionCounter||lineage.currentExpiresAt!==
authority.expiresAt||pullRequest.url!==lease.pullRequestUrl||pullRequest.headRefName!==lane.branch||pullRequest.headRefOid!==
lane.headSha||pullRequest.nodeId!==intent.targetReviewRequestId.replace(/^github-pull-request:/u,"")||canonicalJson(pullRequest.
marker)!==canonicalJson(projectWriterLeasePullRequestMarker(lease))||canonicalJson(dirt)!==canonicalJson({changedPaths:lane.
changedPaths,untrackedPaths:lane.untrackedPaths,dirtyDigest:lane.dirtyDigest})||mutation.claimId!==authority.claimId||mutation.
claimDigest!==authority.claimDigest||mutation.claimLedgerRevision!==authority.claimLedgerRevision||mutation.localAuthorityDigest!==
digestValue(authority)||mutation.localLeaseDigest!==source.leaseDigest||mutation.localLeaseEpoch!==lease.epoch||mutation.
localFenceSha!==lane.headSha||mutation.globalLedgerDigest!==lineage.currentHeadDigest||mutation.currentClaimDigest!==digestValue(
projectPublicClaim(claim))||mutation.expiresAt!==authority.expiresAt||Date.parse(mutation.evaluatedAt)>=Date.parse(mutation.
expiresAt)||!dirt.changedPaths.every(changed=>writeSetCoversPath(manifest.declaredWriteSet,changed))){throw new Error("R\
ecovery source evidence does not form one exact local/cloud/PR join.")}}function assertTerminalProjection(source,recovered){
const original=source.scopeExpansionIntent,mutable=new Set(["status","localProjection","localProjectionReceiptDigest","p\
ullRequestProjection","pullRequestProjectionReceiptDigest","finalReceiptDigest"]);const historyChanged=INTENT_FIELDS.some(
key=>!mutable.has(key)&&canonicalJson(original[key])!==canonicalJson(recovered[key]));const mutationDigest=source.mutationAuthority.
receiptDigest,markerDigest=source.pullRequest.markerDigest;const expectedPrReceipt=digestValue({schema:"agentic-active-d\
irty-scope-expansion-pr-projection/v1",planDigest:original.planDigest,pullRequestUrl:source.pullRequest.url,markerDigest});
const expectedFinalReceipt=digestValue({schema:"agentic-active-dirty-scope-expansion-complete/v1",planDigest:original.planDigest,
mutationAuthorityReceiptDigest:mutationDigest,pullRequestMarkerDigest:markerDigest});if(historyChanged||recovered.localProjection?.
leaseDigest!==source.leaseDigest||recovered.localProjection?.claimId!==source.currentAuthority.claimId||recovered.localProjection?.
receiptDigest!==mutationDigest||recovered.localProjectionReceiptDigest!==mutationDigest||recovered.pullRequestProjection?.
markerDigest!==markerDigest||recovered.pullRequestProjectionReceiptDigest!==expectedPrReceipt||recovered.finalReceiptDigest!==
expectedFinalReceipt){throw new Error("Recovered scope-expansion intent changed historical or current terminal evidence.")}}
function heartbeatStableCore(value){const{transitionCounter,heartbeatCounter,expiresAt,...stable}=value;return stable}function requireValidLedger(value,label){
const failures=validateLedger(value);if(failures.length>0)throw new Error(`${label} ledger is invalid: ${failures.join("\
; ")}`)}function claimDigest(value){return digest(value.claimDigest??value.fenceRevision,"current claim digest")}function writeSetCoversPath(writeSet,changedPath){
return normalizeWriteSet(writeSet).some(item=>{if(!item.startsWith("path:"))return false;const owned=item.slice(5).replace(
/\/$/u,"");return changedPath===owned||changedPath.startsWith(`${owned}/`)})}function snapshot(value,label){object(value,
label);const serialized=canonicalJson(value);if(serialized.length>262144)throw new Error(`${label} exceeds its evidence \
bound.`);return deepFreeze(JSON.parse(serialized))}function nullableSnapshot(value,label){return value==null?null:snapshot(
value,label)}function object(value,label){if(!value||typeof value!=="object"||Array.isArray(value))throw new Error(`${label}\
 must be an object.`)}function exactKeys(value,keys,label){if(canonicalJson(Object.keys(value).sort())!==canonicalJson([
...keys].sort()))throw new Error(`${label} has unexpected or missing fields.`)}function text(value,label){if(typeof value!==
"string"||!value.trim())throw new Error(`${label} is required.`);return value}function nullableText(value,label){return value==
null?null:text(value,label)}function digest(value,label){if(!DIGEST_PATTERN.test(String(value||"")))throw new Error(`${label}\
 must be a SHA-256 digest.`);return value}function nullableDigest(value,label){return value==null?null:digest(value,label)}
function matchingDigest(value,expected,label){const result=digest(value,label);if(result!==expected)throw new Error(`${label}\
 drifted.`);return result}function sha(value,label){if(!SHA_PATTERN.test(String(value||"")))throw new Error(`${label} mu\
st be a Git SHA.`);return value}function integer(value,label,minimum){if(!Number.isInteger(value)||value<minimum)throw new Error(
`${label} is invalid.`);return value}function instant(value,label){const time=Date.parse(value);if(!Number.isFinite(time)||
new Date(time).toISOString()!==value)throw new Error(`${label} must be an exact instant.`);return value}function absolute(value,label){
const result=text(value,label);if(!path.isAbsolute(result)||path.normalize(result)!==result)throw new Error(`${label} mu\
st be normalized and absolute.`);return result}function repository(value,label){const result=text(value,label);if(!/^[^/\s]+\/[^/\s]+$/u.
test(result))throw new Error(`${label} must be owner/name.`);return result}function paths(value,label,allowEmpty=false){
if(!Array.isArray(value))throw new Error(`${label} must be an array.`);const result=[...new Set(value.map(item=>text(item,
label)))].sort();if(!allowEmpty&&result.length===0||result.some(item=>path.isAbsolute(item)||item.includes("..")))throw new Error(
`${label} is invalid.`);return deepFreeze(result)}function deepFreeze(value){if(value&&typeof value==="object"&&!Object.
isFrozen(value)){Object.values(value).forEach(deepFreeze);Object.freeze(value)}return value}export{ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_SOURCE_EVIDENCE_SCHEMA,ACTIVE_DIRTY_SCOPE_EXPANSION_INTENT_RECOVERY_TERMINAL_OBSERVATION_SCHEMA,
assertActiveDirtyScopeExpansionIntentRecoverySourceEvidence,buildActiveDirtyScopeExpansionIntentRecoverySourceEvidence,buildActiveDirtyScopeExpansionIntentRecoveryTerminalObservation,
classifyActiveDirtyScopeExpansionIntentRecoveryTerminal,normalizeActiveDirtyScopeExpansionIntentRecoverySourceEvidence,normalizeActiveDirtyScopeExpansionIntentRecoveryTerminalObservation,
normalizeRecoverableScopeExpansionIntent,verifyExactScopeExpansionHeartbeatSuffix};
