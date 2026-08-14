// Responsibility: Recover one frozen source-retired scope expansion without mutating Git source state.
import{execFileSync}from"node:child_process"
;import{closeSync,existsSync,fsyncSync,mkdirSync,openSync,readFileSync,renameSync,writeSync}from"node:fs";import path from"node:path"
;import{canonicalJson,digestValue}from"./cloud-collaboration-primitives.mjs"
;import{invokeRepositoryCloudVerifier}from"./cloud-collaboration-delivery-verifier.mjs"
;import{normalizeTaskAuthoritySuccessorProjectionRepairPhaseReceipt,sealTaskAuthoritySuccessorProjectionRepairEvidence}from"./task-authority-successor-projection-repair-contract.mjs"

;import{bindAdmissionCloudAuthority,invokeRepositoryCloudAction,verifyAdmissionCloudAuthority}from"./scoped-lane-cloud-authority.mjs"

;import{assertCapabilityMatchesBinding,assertTaskAuthorityBinding,projectTaskAuthorityCapability}from"./task-bound-lane-authority-contract.mjs"

;import{authorizeTaskBoundLeaseMutation,createTaskAuthorityLeaseBinding,readTaskAuthorityCapability}from"./task-bound-lane-authority-store.mjs"
;import{withReviewedLaneEntrypointFence}from"./reviewed-lane-revision-fence.mjs"
;import{assertAdmissionMutationAuthority}from"./scoped-lane-admission-state.mjs"
;import{advanceScopeExpansionIntent,casWriterLeaseProjection,readScopeExpansionIntent,withHeartbeatProjectionFence,writerLeaseDigest}from"./writer-lease-registry-cas.mjs"

;import{createWriterLeaseStore,parseWriterLeasePullRequestBody,projectWriterLeasePullRequestMarker,updateWriterLeasePullRequestBody}from"./writer-lease-lib.mjs"

;const METHODS=Object.freeze(["readEvidence","withEntrypointFence","readIntent","writeIntent","revalidate","reconcilePhase","prepareProjection","assertIrreversibilityBarrier","promoteSuccessor","bindSuccessor","projectLease","projectMarker","finalizeExpansion","verifyTerminal","archiveComplete"])
;const ENTRYPOINT="task-authority-successor-projection-repair"
;export function createTaskAuthoritySuccessorProjectionRepairAdapter(methods={}){for(const name of METHODS){
if(typeof methods[name]!=="function"){
throw new Error(`Task-authority successor projection repair adapter requires ${name}().`)}}
return Object.freeze(Object.fromEntries(METHODS.map(name=>[name,methods[name]])))}
export function createRepositoryTaskAuthoritySuccessorProjectionRepairAdapter({sourceRepository:sourceRepository,sessionId:sessionId,pullRequestNumber:pullRequestNumber,capabilityPath:suppliedCapabilityPath,capabilityFile:capabilityFile=suppliedCapabilityPath,targetRepository:targetRepository=null,environment:environment=process.env,execute:execute=execFileSync,now:now=()=>new Date,leaseStore:leaseStore=null,cloudAction:cloudAction=invokeRepositoryCloudAction,cloudVerifier:cloudVerifier=invokeRepositoryCloudVerifier,captureLiveState:captureLiveState=null,ttlSeconds:ttlSeconds=7200}={}){
const root=realDirectory(sourceRepository,"source repository");const session=requiredText(sessionId,"session ID")
;const pullNumber=positiveInteger(pullRequestNumber,"pull request number")
;const capabilityPath=realFile(capabilityFile,"task authority capability file")
;if(ttlSeconds!==7200)throw new Error("Successor-projection repair TTL must be exactly 7200 seconds.")
;const noGitLocks=Object.freeze({...environment,GIT_OPTIONAL_LOCKS:"0"})
;const raw=(program,args,cwd=root)=>Buffer.from(execute(program,args,{cwd:cwd,encoding:null,
env:program==="git"?noGitLocks:environment,maxBuffer:32*1024*1024,stdio:["ignore","pipe","pipe"],timeout:6e4}))
;const text=(program,args,cwd=root)=>raw(program,args,cwd).toString("utf8").trim()
;const origin=text("git",["config","--get","remote.origin.url"])
;const target=requiredRepository(targetRepository||repositoryFromOrigin(origin),"target repository")
;const commonDir=realDirectory(path.resolve(root,text("git",["rev-parse","--git-common-dir"])),"Git common directory")
;const store=leaseStore||createWriterLeaseStore({gitCommonDir:commonDir,now:now,taskAuthorityFile:capabilityPath,
taskAuthorityPolicy:"required"})
;if(!store.statePath||typeof store.withRegistryLock!=="function"||typeof store.readRegistry!=="function"){
throw new Error("Successor-projection repair requires the repository writer-lease store.")}
const journalKey=digestValue({root:root,session:session,target:target,pullNumber:pullNumber})
;const journalPath=path.join(commonDir,"agentic-canvas-os","task-authority-successor-projection-repair",`${journalKey}.json`)
;const effectsPath=`${journalPath}.effects`;const capture=captureLiveState||(({allowProjected:allowProjected=true}={})=>captureLive({
root:root,session:session,pullNumber:pullNumber,target:target,capabilityPath:capabilityPath,store:store,raw:raw,
text:text,cloudAction:cloudAction,environment:environment,allowProjected:allowProjected}))
;const readIntent=()=>readJournal(journalPath);const readEvidence=()=>{const live=capture();const stored=readIntent()
;if(stored){assertLiveForIntent(stored.planSnapshot,stored,live,nextPhase(stored.status),{allowAhead:true,
effectsPath:effectsPath});return stored.planSnapshot.evidence}
return buildEvidence(live,{root:root,session:session,pullNumber:pullNumber})};const phaseContext=context=>({...context,
live:capture(),store:store,capabilityPath:capabilityPath,cloudAction:cloudAction,cloudVerifier:cloudVerifier,
environment:environment,now:now,ttlSeconds:ttlSeconds,text:text,effectsPath:effectsPath})
;return createTaskAuthoritySuccessorProjectionRepairAdapter({readEvidence:readEvidence,
withEntrypointFence:(subject,action)=>{const operationDigest=requiredDigest(subject?.planDigest,"repair plan digest")
;const live=capture();const stored=readIntent();if(live.leaseDigest!==live.expansion.sourceLeaseDigest){
const operation=readEffect(effectsPath,"lease_projection_operation")
;const expected=stored?.phases?.lease_projected?.values?.targetLeaseDigest||operation?.targetLeaseDigest
;const prepared=stored?.phases?.projection_prepared?.values
;const bound=stored?.phases?.successor_bound?.values?.authority
;const rebuilt=prepared&&bound&&buildTargetLease(subject.plan,prepared,bound,subject.plan.evidence.source.lease)
;if(stored?.planDigest!==operationDigest||operation?.planDigest!==operationDigest
||operation?.sourceLeaseDigest!==subject?.plan?.evidence?.source?.leaseDigest
||!rebuilt||writerLeaseDigest(rebuilt)!==expected||canonicalJson(rebuilt)!==canonicalJson(live.lease)
||live.leaseDigest!==expected||operation?.targetLeaseDigest!==expected||live.lease.cloudAuthority?.claimId!==live.expansion.targetClaimId){
throw new Error("Projected repair cannot reacquire its exact cooperative fence.")}}
return withReviewedLaneEntrypointFence({leaseStore:store,branch:live.branch,entrypoint:ENTRYPOINT,
operationDigest:operationDigest,expectedLeaseDigest:live.leaseDigest,expectedClaimId:live.lease.cloudAuthority.claimId
},action)},readIntent:readIntent,
writeIntent:({expected:expected,value:value})=>writeJournalCas(journalPath,expected,value,now),
revalidate:({plan:plan,intent:intent=null,phase:phase})=>assertLiveForIntent(plan,intent,capture(),phase,{
effectsPath:effectsPath}),reconcilePhase:context=>reconcilePhase(phaseContext(context)),
prepareProjection:context=>prepareProjection(phaseContext(context)),
assertIrreversibilityBarrier:context=>assertIrreversibilityBarrier(phaseContext(context)),
promoteSuccessor:context=>promoteSuccessor(phaseContext(context)),
bindSuccessor:context=>bindSuccessor(phaseContext(context)),projectLease:context=>projectLease(phaseContext(context)),
projectMarker:context=>projectMarker(phaseContext(context)),
finalizeExpansion:context=>finalizeExpansion(phaseContext(context)),
verifyTerminal:context=>verifyTerminal(phaseContext(context)),archiveComplete:context=>archiveComplete({
...phaseContext(context),journalPath:journalPath})})}
function captureLive({root:root,session:session,pullNumber:pullNumber,target:target,capabilityPath:capabilityPath,store:store,raw:raw,text:text,cloudAction:cloudAction,environment:environment,allowProjected:allowProjected}){
const branch=requiredText(text("git",["branch","--show-current"]),"source branch");const lease=store.verify({
sessionId:session,branch:branch,allowExpired:true});const binding=assertTaskAuthorityBinding({
binding:lease.taskAuthority,lease:lease});const capability=readTaskAuthorityCapability(capabilityPath)
;assertCapabilityMatchesBinding(capability,binding);const expansion=readScopeExpansionIntent({leaseStore:store,
branch:branch})
;if(!expansion||!["source-retired","promoted","successor-bound","local-cas","pr-marker","complete"].includes(expansion.status)){
throw new Error("Repair requires the exact source-retired scope-expansion intent.")}
if(!allowProjected&&writerLeaseDigest(lease)!==expansion.sourceLeaseDigest){
throw new Error("Repair source lease was already projected.")}const dirt=readDirt(raw)
;const pull=readPullRequest(text,pullNumber,target);const marker=requireMarker(pull.body)
;const registry=store.readRegistry();const cloud=cloudAction({action:"status",
ledgerRepository:lease.cloudAuthority.ledgerRepository,request:{targetRepository:target},environment:environment})
;return Object.freeze({root:root,branch:branch,lease:lease,leaseDigest:writerLeaseDigest(lease),binding:binding,
capability:capability,expansion:expansion,expansionDigest:digestValue(expansion),dirt:dirt,pull:pull,marker:marker,
markerDigest:digestValue(marker),bodyDigest:digestValue(pull.body),registry:registry,
registryDigest:digestValue(registry),cloud:cloud,headSha:sha(text("git",["rev-parse","HEAD"]),"HEAD"),
treeSha:sha(text("git",["rev-parse","HEAD^{tree}"]),"HEAD tree"),remoteHeadSha:remoteHead(raw,branch),
indexStateDigest:digestValue(raw("git",["ls-files","--stage","-z","--"])),capabilityPath:capabilityPath})}
function readDirt(raw){
const stagedPaths=splitNul(raw("git",["diff","--cached","--name-only","--no-renames","-z","--"])).sort()
;const unstagedPaths=splitNul(raw("git",["diff","--name-only","--no-renames","-z","--"])).sort()
;const untrackedPaths=splitNul(raw("git",["ls-files","--others","--exclude-standard","-z","--"])).sort()
;const changedPaths=[...new Set([...stagedPaths,...unstagedPaths,...untrackedPaths])].sort()
;const stagedPatch=raw("git",["diff","--cached","--binary","--no-renames","--"])
;const unstagedPatch=raw("git",["diff","--binary","--no-renames","--"])
;const indexEntries=raw("git",["ls-files","--stage","-z","--",...changedPaths]);const core={changedPaths:changedPaths,
stagedPaths:stagedPaths,unstagedPaths:unstagedPaths,untrackedPaths:untrackedPaths,
stagedPatchDigest:digestValue(stagedPatch),unstagedPatchDigest:digestValue(unstagedPatch),
indexEntriesDigest:digestValue(indexEntries)};return Object.freeze({...core,dirtyDigest:digestValue(core)})}
function buildEvidence(live,{root:root,session:session,pullNumber:pullNumber}){
if(live.expansion.status!=="source-retired")throw new Error("Planning requires source-retired expansion state.")
;if(live.dirt.untrackedPaths.length)throw new Error("Repair does not authorize untracked source bytes.")
;const sourcePaths=writePaths(live.lease.admission.declaredWriteSet)
;const targetPaths=writePaths(live.expansion.planSnapshot.targetDeclaredWriteSet)
;if(live.dirt.changedPaths.some(item=>!sourcePaths.has(item)||!targetPaths.has(item))){
throw new Error("Current source bytes exceed C1 or C2 admission.")}
const historicalPaths=[...live.expansion.planSnapshot.sourceChangedPaths].sort();const reconciliation={
historicalDirtyDigest:live.expansion.planSnapshot.sourceDirtyDigest,historicalChangedPaths:historicalPaths,
currentDirtyDigest:live.dirt.dirtyDigest,addedPaths:difference(live.dirt.changedPaths,historicalPaths),
removedPaths:difference(historicalPaths,live.dirt.changedPaths),
commonPaths:live.dirt.changedPaths.filter(item=>historicalPaths.includes(item))}
;if(reconciliation.removedPaths.length)throw new Error("Historical source paths disappeared before repair.")
;const waiting=exactClaim(live.cloud.claims,live.expansion.targetClaimId)
;if(waiting.state!=="waiting-successor")throw new Error("Cloud successor is not waiting.");const snapshot={
headSha:live.headSha,treeSha:live.treeSha,remoteHeadSha:live.remoteHeadSha,indexStateDigest:live.indexStateDigest}
;const value={schema:"agentic-task-authority-successor-projection-repair-evidence/v2",repository:root,
branch:live.branch,sessionId:session,source:{lease:live.lease,leaseDigest:live.leaseDigest,binding:live.binding,
snapshot:{...snapshot,snapshotDigest:digestValue(snapshot)},currentDirt:live.dirt,dirtReconciliation:{...reconciliation,
receiptDigest:digestValue(reconciliation)}},expansion:{intent:live.expansion,intentDigest:live.expansionDigest},cloud:{
ledgerRevision:live.cloud.ledgerRevision,ledgerDigest:live.cloud.ledgerDigest,successor:projectClaim(waiting),
inventoryDigest:digestValue(live.cloud.claims)},
pullRequest:projectPull(live.pull,pullNumber,live.markerDigest,live.bodyDigest),capability:{
...projectTaskAuthorityCapability(live.capability),bindingDigest:live.binding.bindingDigest}}
;delete value.capability.publicKey;return sealTaskAuthoritySuccessorProjectionRepairEvidence(value)}
function prepareProjection({plan:plan,live:live,capabilityPath:capabilityPath,now:now,ttlSeconds:ttlSeconds,effectsPath:effectsPath}){
assertSourceProjection(plan,live);const projectedAt=now().toISOString();const proof=authorizeTaskBoundLeaseMutation({
lease:live.lease,capabilityPath:capabilityPath,
operation:`task-authority-successor-projection-repair:prepare:${plan.planDigest}`,now:new Date(projectedAt)})
;const successor=plan.evidence.cloud.successor;const prospectiveLane=Object.freeze({branch:live.lease.branch,
scope:live.lease.scope,device:live.lease.device,epoch:live.lease.epoch,
baseSha:plan.evidence.expansion.intent.targetCanonicalBaseSha,cloudClaimId:successor.claimId});const minimalLease={
...prospectiveLane,cloudAuthority:{claimId:prospectiveLane.cloudClaimId}};delete minimalLease.cloudClaimId
;const continuation=createTaskAuthorityLeaseBinding({lease:minimalLease,capabilityPath:capabilityPath,
bindingMode:"continuation",priorBindingDigest:live.binding.bindingDigest,boundAt:projectedAt});const values={
sourceLeaseDigest:live.leaseDigest,sourceBindingDigest:live.binding.bindingDigest,prospectiveLane:prospectiveLane,
prospectiveLaneDigest:digestValue(prospectiveLane),continuationBinding:continuation,capabilityVerificationReceipt:proof,
projectedAt:projectedAt,expiresAt:new Date(Date.parse(projectedAt)+ttlSeconds*1e3).toISOString(),
expansionIntentDigest:live.expansionDigest};const receipt=phaseReceipt(plan,"projection_prepared",values)
;writeEffect(effectsPath,"projection_prepared",receipt);return receipt}
function assertIrreversibilityBarrier({plan:plan,intent:intent,live:live,capabilityPath:capabilityPath,phase:phase}){
assertLiveForIntent(plan,intent,live,phase);const prepared=intent?.phases?.projection_prepared
;if(!prepared)throw new Error("Irreversible repair requires the durable prepared projection.")
;authorizeTaskBoundLeaseMutation({lease:live.lease,capabilityPath:capabilityPath,
operation:`task-authority-successor-projection-repair:barrier:${plan.planDigest}:${phase}`})
;const pull=plan.evidence.pullRequest
;if(live.pull.url!==pull.url||live.pull.nodeId!==pull.nodeId||live.pull.state!=="OPEN"||live.pull.isDraft!==true||live.pull.headRefOid!==pull.headSha||live.pull.headRefName!==pull.branch||live.pull.baseRefName!==pull.baseBranch){
throw new Error("Pull-request identity drifted before an irreversible repair effect.")}return Object.freeze({
status:"ready",phase:phase,planDigest:plan.planDigest})}
function promoteSuccessor({plan:plan,live:live,cloudAction:cloudAction,environment:environment,ttlSeconds:ttlSeconds}){
assertSourceProjection(plan,live);const waiting=plan.evidence.cloud.successor;return cloudAction({action:"continue",
ledgerRepository:live.lease.cloudAuthority.ledgerRepository,request:{
targetRepository:live.lease.cloudAuthority.targetRepository,claimId:waiting.claimId,
expectedFenceRevision:waiting.claimDigest,expectedTransitionCounter:waiting.transitionCounter,mode:"promote",
ttlSeconds:ttlSeconds,deviceId:live.lease.device,sessionId:live.lease.sessionId,
idempotencyKey:`task-authority-successor-projection-repair:promote:${plan.planDigest}`},environment:environment})}
function bindSuccessor({plan:plan,intent:intent,live:live,cloudAction:cloudAction,cloudVerifier:cloudVerifier,environment:environment}){
const promoted=intent.phases.successor_promoted.values;const status=cloudStatus(live,cloudAction,environment)
;const claim=exactClaim(status.claims,promoted.claimId);const authority=successorAuthority(plan,live,status,claim)
;return bindAdmissionCloudAuthority({authority:authority,manifest:targetManifest(plan),branch:live.branch,
headSha:plan.evidence.source.snapshot.headSha,reviewRequestId:`github-pull-request:${live.pull.nodeId}`,
deviceId:live.lease.device,sessionId:live.lease.sessionId,
idempotencyKey:`task-authority-successor-projection-repair:bind:${plan.planDigest}`,returnVerification:true,
environment:environment,invoke:cloudAction,inspect:cloudAction,verify:cloudVerifier})}
function projectLease({plan:plan,intent:intent,live:live,store:store,capabilityPath:capabilityPath,effectsPath:effectsPath}){
const prepared=intent.phases.projection_prepared.values;const bound=intent.phases.successor_bound.values.authority
;if(live.leaseDigest!==prepared.sourceLeaseDigest){throw new Error("Source lease drifted before its frozen projection.")
}const targetCore={...live.lease,baseSha:plan.evidence.expansion.intent.targetCanonicalBaseSha,
admission:targetAdmission(plan,live.lease.admission,bound),cloudAuthority:bound,heartbeatAt:prepared.projectedAt,
expiresAt:bound.expiresAt};if(Date.parse(prepared.projectedAt)>=Date.parse(bound.expiresAt)){
throw new Error("Prepared projection timestamp is not before successor expiry.")}const targetLease={...targetCore,
taskAuthority:prepared.continuationBinding};assertTaskAuthorityBinding({binding:targetLease.taskAuthority,
lease:targetLease});const current=store.readRegistry().leases[live.branch]
;if(writerLeaseDigest(current)!==prepared.sourceLeaseDigest)throw new Error("Registry source lease drifted before store-owned projection.")
;const operation=leaseTransitionOperation(plan,live.branch,prepared,targetLease)
;writeEffect(effectsPath,"lease_projection_operation",operation);const projected=casWriterLeaseProjection({
leaseStore:store,branch:live.branch,expectedLeaseDigest:prepared.sourceLeaseDigest,
expectedClaimId:plan.evidence.expansion.intent.sourceClaimId,values:targetLease}).lease
;if(writerLeaseDigest(projected)!==operation.targetLeaseDigest){
throw new Error("Store-owned task-authority projection returned a different lease.")}return reconcileProjectedLease({
plan:plan,intent:intent,live:{...live,lease:projected,leaseDigest:writerLeaseDigest(projected),
registry:store.readRegistry()},capabilityPath:capabilityPath,effectsPath:effectsPath})}
function projectMarker({plan:plan,intent:intent,live:live,store:store,text:text,effectsPath:effectsPath}){
const targetLeaseDigest=intent.phases.lease_projected.values.targetLeaseDigest
;if(live.leaseDigest!==targetLeaseDigest)throw new Error("Projected lease drifted before PR projection.")
;const nextBody=updateWriterLeasePullRequestBody(live.pull.body,live.lease);const operation=seal({
schema:"agentic-task-authority-successor-marker-operation/v1",planDigest:plan.planDigest,pullRequestUrl:live.pull.url,
beforeBodyDigest:digestValue(live.pull.body),afterBodyDigest:digestValue(nextBody),targetLeaseDigest:targetLeaseDigest})
;writeEffect(effectsPath,"marker_projection_operation",operation);withHeartbeatProjectionFence({leaseStore:store,
branch:live.branch,expectedLeaseDigest:live.leaseDigest,expectedClaimId:live.lease.cloudAuthority.claimId,action:()=>{
const current=readPullRequest(text,live.pull.number,live.lease.cloudAuthority.targetRepository)
;assertPullExact(plan.evidence.pullRequest,current);if(digestValue(current.body)!==operation.beforeBodyDigest){
throw new Error("Pull-request body preimage drifted before marker projection.")}
text("gh",["pr","edit",live.pull.url,"--body",nextBody])}});return operation}
function finalizeExpansion({plan:plan,intent:intent,live:live,store:store,cloudVerifier:cloudVerifier,cloudAction:cloudAction,environment:environment,effectsPath:effectsPath}){
let operation=readEffect(effectsPath,"expansion_finalization_operation");if(!operation){const mutation=mutationAuthority(plan,live,cloudVerifier,cloudAction,environment)
;operation=writeEffect(effectsPath,"expansion_finalization_operation",finalizationOperation(plan,intent,live,mutation))}
operation=validateFinalizationOperation(plan,intent,live,operation,mutationAuthority(plan,live,cloudVerifier,cloudAction,environment))
;const values=terminalExpansion(plan,intent,live,operation.mutationAuthorityReceipt);return advanceScopeExpansionIntent({leaseStore:store,
branch:live.branch,expectedLeaseDigest:live.leaseDigest,expectedClaimId:plan.evidence.cloud.successor.claimId,
expectedPlanDigest:plan.evidence.expansion.intent.planDigest,values:values}).intent}
function verifyTerminal({plan:plan,intent:intent,live:live,cloudVerifier:cloudVerifier,cloudAction:cloudAction,environment:environment,effectsPath:effectsPath}){
assertLiveForIntent(plan,intent,live,"verified");const phases=intent.phases
;if(!phases.lease_projected||!phases.marker_projected||!phases.expansion_finalized){
throw new Error("Terminal repair lacks its exact phase lineage.")}
if(live.leaseDigest!==phases.lease_projected.values.targetLeaseDigest||live.markerDigest!==phases.marker_projected.values.markerDigest||live.bodyDigest!==phases.marker_projected.values.bodyDigest||live.expansionDigest!==phases.expansion_finalized.values.expansionIntentDigest){
throw new Error("Terminal local projections drifted from their receipts.")}assertTaskAuthorityBinding({
binding:live.lease.taskAuthority,lease:live.lease});const verified=verifyAdmissionCloudAuthority({
authority:live.lease.cloudAuthority,manifest:targetManifest(plan),
canonicalBaseSha:plan.evidence.expansion.intent.targetCanonicalBaseSha,environment:environment,inspect:cloudAction,
invoke:cloudVerifier});const mutation=assertAdmissionMutationAuthority({lease:live.lease,
cloudAuthority:verified.authority,remoteAuthorityVerification:verified.verification})
;const operation=validateFinalizationOperation(plan,intent,live,readEffect(effectsPath,"expansion_finalization_operation"),mutation)
;assertTerminalExpansion(plan,intent,live.expansion,operation.mutationAuthorityReceipt);assertPullExact(plan.evidence.pullRequest,live.pull,{
allowProjectedBody:true});return phaseReceipt(plan,"verified",{
sourceSnapshotDigest:plan.evidence.source.snapshot.snapshotDigest,currentDirtDigest:live.dirt.dirtyDigest,
leaseDigest:live.leaseDigest,authorityDigest:digestValue(verified.authority),markerDigest:live.markerDigest,
bodyDigest:live.bodyDigest,expansionIntentDigest:live.expansionDigest,claimId:plan.evidence.cloud.successor.claimId,
verifiedAt:verified.verification.verifiedAt,cloudVerificationReceiptDigest:verified.verification.receiptDigest})}
function archiveComplete({plan:plan,intent:intent,verified:verified,journalPath:journalPath}){
if(canonicalJson(stableVerification(verified))!==canonicalJson(stableVerification(intent.phases.verified))){
throw new Error("Archive verification drifted.")}
;const core={
schema:"agentic-task-authority-successor-projection-repair-archive/v1",status:"complete",planDigest:plan.planDigest,
terminalIntentDigest:intent.intentDigest,completionReceiptDigest:intent.receipt.receiptDigest}
;const archive=Object.freeze({...core,archiveDigest:digestValue(core)});const file=`${journalPath}.complete`
;if(existsSync(file)){const existing=JSON.parse(readFileSync(file,"utf8"))
;if(canonicalJson(existing)!==canonicalJson(archive))throw new Error("Existing repair archive is invalid.")
}else writeJson(file,archive);return archive}function stableVerification(receipt){const values={...receipt.values}
;delete values.verifiedAt;delete values.cloudVerificationReceiptDigest;delete values.receiptDigest
;return{schema:receipt.schema,phase:receipt.phase,planDigest:receipt.planDigest,
operationKey:receipt.operationKey,values:values}}function reconcilePhase(context){
const{plan:plan,intent:intent,phase:phase,live:live,effectsPath:effectsPath}=context
;assertLiveForIntent(plan,intent,live,phase,{allowAhead:true,effectsPath:effectsPath})
;if(phase==="projection_prepared"){const sidecar=readEffect(effectsPath,phase);if(!sidecar)return null
;const proof=authorizeTaskBoundLeaseMutation({lease:live.lease,capabilityPath:context.capabilityPath,
operation:`task-authority-successor-projection-repair:prepare:${plan.planDigest}`,
now:new Date(sidecar.values.projectedAt)});const{receiptDigest:_ignored,...values}=sidecar.values
;return phaseReceipt(plan,phase,{...values,capabilityVerificationReceipt:proof})}
if(phase==="successor_promoted"){
const claim=exactClaim(live.cloud.claims,plan.evidence.cloud.successor.claimId)
;if(!isActiveClaim(claim)||claim.reviewRequestId!==null)return null
;return phaseReceipt(plan,phase,promotedValues(claim,live.cloud))}if(phase==="successor_bound"){
const promoted=intent.phases.successor_promoted?.values;if(!promoted)return null
;const claim=exactClaim(live.cloud.claims,promoted.claimId);if(!isActiveClaim(claim)||!claim.reviewRequestId)return null
;const verified=verifyAdmissionCloudAuthority({authority:successorAuthority(plan,live,live.cloud,claim),
manifest:targetManifest(plan),canonicalBaseSha:plan.evidence.expansion.intent.targetCanonicalBaseSha,
environment:context.environment,inspect:context.cloudAction,invoke:context.cloudVerifier})
;if(verified.authority.reviewRequestId!==`github-pull-request:${live.pull.nodeId}`)return null
;return phaseReceipt(plan,phase,{authority:verified.authority,authorityDigest:digestValue(verified.authority),
reviewRequestId:verified.authority.reviewRequestId,cloudVerificationReceiptDigest:verified.verification.receiptDigest})}
if(phase==="lease_projected")return reconcileProjectedLease(context);if(phase==="marker_projected"){
const operation=readEffect(effectsPath,"marker_projection_operation")
;const leaseDigest=intent.phases.lease_projected?.values.targetLeaseDigest
;if(!operation||live.leaseDigest!==leaseDigest||operation.afterBodyDigest!==live.bodyDigest||live.markerDigest!==digestValue(projectWriterLeasePullRequestMarker(live.lease)))return null
;return phaseReceipt(plan,phase,{pullRequestUrl:live.pull.url,pullRequestNodeId:live.pull.nodeId,
leaseDigest:leaseDigest,markerDigest:live.markerDigest,bodyDigest:live.bodyDigest,
beforeBodyDigest:operation.beforeBodyDigest})}if(phase==="expansion_finalized"){
if(live.expansion.status!=="complete")return null
;const fresh=mutationAuthority(plan,live,context.cloudVerifier,context.cloudAction,context.environment)
;const operation=validateFinalizationOperation(plan,intent,live,readEffect(effectsPath,"expansion_finalization_operation"),fresh)
;assertTerminalExpansion(plan,intent,live.expansion,operation.mutationAuthorityReceipt);return phaseReceipt(plan,phase,{
expansionIntentDigest:live.expansionDigest,expansionFinalReceiptDigest:live.expansion.finalReceiptDigest,
status:"complete",mutationAuthorityReceiptDigest:operation.mutationAuthorityReceiptDigest})}
if(phase==="verified")return verifyTerminal(context);return null}
function reconcileProjectedLease({plan:plan,intent:intent,live:live,capabilityPath:capabilityPath,effectsPath:effectsPath}){
const prepared=intent.phases.projection_prepared?.values;const bound=intent.phases.successor_bound?.values?.authority
;const operation=readEffect(effectsPath,"lease_projection_operation");if(!prepared||!bound||!operation)return null
;const target=buildTargetLease(plan,prepared,bound,plan.evidence.source.lease)
;const expected=leaseTransitionOperation(plan,live.branch,prepared,target)
;if(canonicalJson(operation)!==canonicalJson(expected)||live.leaseDigest!==operation.targetLeaseDigest)return null
;if(digestValue(live.registry.leases[live.branch])!==digestValue(target))return null
;const targetProof=authorizeTaskBoundLeaseMutation({lease:live.lease,capabilityPath:capabilityPath,
operation:`task-authority-successor-projection-repair:target-proof:${plan.planDigest}`})
;return phaseReceipt(plan,"lease_projected",{sourceLeaseDigest:operation.sourceLeaseDigest,targetLease:target,
targetLeaseDigest:operation.targetLeaseDigest,continuationBinding:prepared.continuationBinding,
storeTransitionReceipt:leaseTransitionReceipt(operation,targetProof),
expansionIntentDigest:plan.evidence.expansion.intentDigest})}
function leaseTransitionOperation(plan,branch,prepared,target){const core={
schema:"agentic-task-authority-successor-store-transition-operation/v1",planDigest:plan.planDigest,branch:branch,
sourceLeaseDigest:prepared.sourceLeaseDigest,targetLeaseDigest:writerLeaseDigest(target),
sourceBindingDigest:prepared.sourceBindingDigest,
continuationBindingDigest:prepared.continuationBinding.bindingDigest};return Object.freeze({...core,
operationDigest:digestValue(core)})}function leaseTransitionReceipt(operation,targetProof){const core={
schema:"agentic-task-authority-successor-store-transition/v1",planDigest:operation.planDigest,
branch:operation.branch,method:"writer-lease-registry-cas.casWriterLeaseProjection",
authorityEnforcement:"source-barrier+exact-cas+target-proof",
sourceLeaseDigest:operation.sourceLeaseDigest,targetLeaseDigest:operation.targetLeaseDigest,
sourceBindingDigest:operation.sourceBindingDigest,continuationBindingDigest:operation.continuationBindingDigest,
operationDigest:operation.operationDigest,targetCapabilityVerificationReceipt:targetProof,
frozenIncidentOnly:true};return Object.freeze({...core,
receiptDigest:digestValue(core)})}
function assertLiveForIntent(plan,intent,live,phase="prepared",{allowAhead:allowAhead=false,effectsPath:effectsPath=null}={}){
const evidence=plan.evidence;const snapshot={headSha:live.headSha,treeSha:live.treeSha,remoteHeadSha:live.remoteHeadSha,
indexStateDigest:live.indexStateDigest}
;if(digestValue(snapshot)!==evidence.source.snapshot.snapshotDigest||digestValue(live.dirt)!==digestValue(evidence.source.currentDirt)){
throw new Error("Frozen source Git state or exact bytes drifted.")}
const leaseEffect=effectsPath&&readEffect(effectsPath,"lease_projection_operation")
;const markerEffect=effectsPath&&readEffect(effectsPath,"marker_projection_operation")
;const aheadLease=Boolean(allowAhead&&phase==="lease_projected"&&exactLeaseCandidate(plan,intent,live,leaseEffect))
;const aheadMarker=Boolean(allowAhead&&phase==="marker_projected"&&exactMarkerCandidate(plan,live,markerEffect))
;const recordedMarker=intent?.phases?.marker_projected?.values;assertPullExact(evidence.pullRequest,live.pull,{
allowProjectedBody:Boolean(recordedMarker||aheadMarker)})
;if(recordedMarker&&(live.bodyDigest!==recordedMarker.bodyDigest||live.markerDigest!==recordedMarker.markerDigest)){
throw new Error("Projected pull-request marker drifted from its durable phase.")}
const projected=intent&&(phaseIndex(intent.status)>=phaseIndex("lease_projected")||aheadLease)
;const expectedLease=projected?intent.phases.lease_projected?.values.targetLeaseDigest||leaseEffect.targetLeaseDigest:evidence.source.leaseDigest
;if(live.leaseDigest!==expectedLease)throw new Error("Repair writer lease drifted from its durable phase.")
;if(projected){assertTaskAuthorityBinding({binding:live.lease.taskAuthority,lease:live.lease})}else{
assertSourceProjection(plan,live)}
const completeExpansion=live.expansion.status==="complete"
;const exactComplete=completeExpansion&&exactExpansionCandidate(plan,intent,live,effectsPath)
;if(completeExpansion&&!exactComplete)throw new Error("Completed scope-expansion projection drifted.")
;const aheadFinal=allowAhead&&phase==="expansion_finalized"&&exactComplete
;if(projected||aheadFinal||phaseIndex(intent?.status||"prepared")>=phaseIndex("expansion_finalized")){
if(!["source-retired","complete"].includes(live.expansion.status)){
throw new Error("Scope-expansion intent entered an unauthorized phase.")}
;if(live.expansion.status==="source-retired"&&live.expansionDigest!==evidence.expansion.intentDigest){
throw new Error("Source-retired scope-expansion intent drifted.")}
;const recordedFinal=intent?.phases?.expansion_finalized?.values
;if(recordedFinal&&live.expansionDigest!==recordedFinal.expansionIntentDigest){
throw new Error("Completed scope-expansion intent drifted from its durable phase.")}
}else if(live.expansionDigest!==evidence.expansion.intentDigest){
throw new Error("Source-retired scope-expansion intent drifted.")}
const claim=exactClaim(live.cloud.claims,evidence.cloud.successor.claimId)
;const aheadPromoted=allowAhead&&phase==="successor_promoted"&&isActiveClaim(claim)
;if(phaseIndex(intent?.status||"prepared")<phaseIndex("successor_promoted")&&!aheadPromoted){
if(digestValue(projectClaim(claim))!==digestValue(evidence.cloud.successor)){
throw new Error("Waiting successor drifted before promotion.")}
}else{if(!isActiveClaim(claim))throw new Error("Successor cloud authority is not active.")
;const promoted=intent?.phases?.successor_promoted?.values;const bound=intent?.phases?.successor_bound?.values.authority
;const aheadBound=allowAhead&&phase==="successor_bound"&&promoted&&!bound&&isActiveClaim(claim)
&&claim.transitionCounter===promoted.transitionCounter+1
&&claim.reviewRequestId===`github-pull-request:${live.pull.nodeId}`
;const promotedCounter=bound?.transitionCounter??(aheadBound?promoted.transitionCounter+1:
promoted?.transitionCounter??evidence.cloud.successor.transitionCounter+1)
;const expectedReview=bound?.reviewRequestId??(aheadBound?`github-pull-request:${live.pull.nodeId}`:null)
;assertSuccessorTransition(plan,claim,promotedCounter,expectedReview)
;if(promoted&&!bound&&!aheadBound&&(promoted.claimDigest!==(claim.fenceRevision||claim.claimDigest)
||promoted.transitionCounter!==claim.transitionCounter))throw new Error("Promoted successor drifted from its durable phase.")
;if(bound&&(bound.claimDigest!==claim.fenceRevision||bound.reviewRequestId!==claim.reviewRequestId)){
throw new Error("Bound successor drifted from its durable phase.")}}return live}
function exactLeaseCandidate(plan,intent,live,operation){const prepared=intent?.phases?.projection_prepared?.values
;const bound=intent?.phases?.successor_bound?.values?.authority;if(!operation||!prepared||!bound)return false
;const target=buildTargetLease(plan,prepared,bound,plan.evidence.source.lease)
;return canonicalJson(operation)===canonicalJson(leaseTransitionOperation(plan,live.branch,prepared,target))
&&canonicalJson(live.lease)===canonicalJson(target)&&live.leaseDigest===writerLeaseDigest(target)}
function exactMarkerCandidate(plan,live,operation){if(!operation)return false
;const{receiptDigest,...core}=operation;return core.schema==="agentic-task-authority-successor-marker-operation/v1"
&&core.planDigest===plan.planDigest&&core.pullRequestUrl===plan.evidence.pullRequest.url
&&core.beforeBodyDigest===plan.evidence.pullRequest.bodyDigest&&core.afterBodyDigest===live.bodyDigest
&&core.targetLeaseDigest===live.leaseDigest&&receiptDigest===digestValue(core)
&&live.markerDigest===digestValue(projectWriterLeasePullRequestMarker(live.lease))}
function exactExpansionCandidate(plan,intent,live,effectsPath){const operation=effectsPath&&readEffect(effectsPath,"expansion_finalization_operation")
;if(!operation)return false;try{const normalized=normalizeFinalizationOperation(plan,intent,live,operation)
;return live.expansionDigest===normalized.terminalExpansionIntentDigest&&canonicalJson(live.expansion)===canonicalJson({...plan.evidence.expansion.intent,...terminalExpansion(plan,intent,live,normalized.mutationAuthorityReceipt)})
}catch{return false}}
function assertSuccessorTransition(plan,claim,counter,review){const expected=plan.evidence.cloud.successor
;if(claim.claimId!==expected.claimId||claim.canonicalBaseRevision!==expected.canonicalBaseRevision
||claim.laneRevision!==expected.laneRevision||claim.writeSetDigest!==expected.writeSetDigest
||claim.leaseEpoch!==expected.leaseEpoch||claim.predecessorClaimId!==expected.predecessorClaimId
||claim.transitionCounter!==counter||claim.reviewRequestId!==(review||null)||claim.writeAuthority!==true
||claim.scopeReserved!==true)throw new Error("Successor cloud transition drifted from repair lineage.")
;requiredDigest(claim.fenceRevision||claim.claimDigest,"successor claim digest")
;requiredDigest(claim.transitionDigest,"successor claim ledger revision")
;requiredDigest(claim.operationReceiptDigest,"successor operation receipt")
;requiredText(claim.expiresAt,"successor expiry")}
function assertSourceProjection(plan,live){const source=plan.evidence.source
;if(live.leaseDigest!==source.leaseDigest||live.binding.bindingDigest!==source.binding.bindingDigest||live.expansionDigest!==plan.evidence.expansion.intentDigest||live.expansion.status!=="source-retired"||live.expansion.sourceLeaseDigest!==source.leaseDigest||live.expansion.sourceClaimId!==plan.evidence.expansion.intent.sourceClaimId){
throw new Error("Frozen source projection no longer matches its repair plan.")}}
function buildTargetLease(plan,prepared,bound,sourceLease){const targetCore={...sourceLease,
baseSha:plan.evidence.expansion.intent.targetCanonicalBaseSha,
admission:targetAdmission(plan,sourceLease.admission,bound),cloudAuthority:bound,heartbeatAt:prepared.projectedAt,
expiresAt:bound.expiresAt};const target={...targetCore,taskAuthority:prepared.continuationBinding}
;assertTaskAuthorityBinding({binding:target.taskAuthority,lease:target});return Object.freeze(target)}
function targetAdmission(plan,sourceAdmission,authority){const expansion=plan.evidence.expansion.intent
;const snapshot=expansion.planSnapshot;return Object.freeze({schema:"agentic-lane-admission-lease/v1",status:"admitted",
semanticScope:plan.evidence.source.lease.scope,declaredWriteSet:snapshot.targetDeclaredWriteSet,
writeSetDigest:snapshot.targetWriteSetDigest,manifestDigest:snapshot.targetManifestDigest,
planReceiptDigest:snapshot.planDigest,admissionReceiptDigest:authority.operationReceiptDigest,
existingLaneStateDigest:sourceAdmission.existingLaneStateDigest,admittedReportDigest:digestValue({
schema:"agentic-active-dirty-scope-expansion-admitted-report/v1",planDigest:snapshot.planDigest,
claimId:authority.claimId,claimDigest:authority.claimDigest}),preservationReceiptDigest:digestValue({
schema:"agentic-active-dirty-scope-expansion-preservation/v1",planDigest:snapshot.planDigest,
sourceAdmissionDigest:digestValue(sourceAdmission),successorClaimId:authority.claimId})})}
function terminalExpansion(plan,intent,live,mutation){const current=live.expansion
;const markerDigest=intent.phases.marker_projected.values.markerDigest;const pullReceiptDigest=digestValue({
schema:"agentic-active-dirty-scope-expansion-pr-projection/v1",planDigest:current.planDigest,
pullRequestUrl:live.lease.pullRequestUrl,markerDigest:markerDigest});const finalReceiptDigest=digestValue({
schema:"agentic-active-dirty-scope-expansion-complete/v1",planDigest:current.planDigest,
mutationAuthorityReceiptDigest:mutation.receiptDigest,pullRequestMarkerDigest:markerDigest})
;const promotion=intent.phases.successor_promoted.values;const binding=intent.phases.successor_bound.values
;return{status:"complete",targetClaimDigest:binding.authority.claimDigest,
targetReviewRequestId:binding.authority.reviewRequestId,promoted:{claimId:promotion.claimId,claimDigest:promotion.claimDigest,
ledgerRevision:promotion.ledgerRevision,claimLedgerRevision:promotion.claimLedgerRevision,
transitionCounter:promotion.transitionCounter,expiresAt:promotion.expiresAt},
promotedReceiptDigest:promotion.operationReceiptDigest,boundAuthority:binding.authority,
boundReceiptDigest:binding.cloudVerificationReceiptDigest,localProjection:{leaseDigest:live.leaseDigest,
claimId:live.lease.cloudAuthority.claimId,receiptDigest:mutation.receiptDigest},
localProjectionReceiptDigest:mutation.receiptDigest,pullRequestProjection:{markerDigest:markerDigest},
pullRequestProjectionReceiptDigest:pullReceiptDigest,finalReceiptDigest:finalReceiptDigest}}
function assertTerminalExpansion(plan,intent,expansion,mutation){const expected=terminalExpansion(plan,intent,{
expansion:expansion,leaseDigest:intent.phases.lease_projected.values.targetLeaseDigest,
lease:intent.phases.lease_projected.values.targetLease},mutation);for(const[key,value]of Object.entries(expected)){
if(canonicalJson(expansion[key])!==canonicalJson(value)){
throw new Error(`Terminal scope-expansion ${key} drifted from repair lineage.`)}}}
function finalizationOperation(plan,intent,live,mutation){const receipt=normalizeMutationAuthority(mutation)
;const terminal=terminalExpansion(plan,intent,live,receipt);const core={
schema:"agentic-task-authority-successor-expansion-finalization-operation/v1",planDigest:plan.planDigest,
branch:live.branch,sourceExpansionIntentDigest:plan.evidence.expansion.intentDigest,
targetLeaseDigest:intent.phases.lease_projected.values.targetLeaseDigest,
targetClaimId:plan.evidence.cloud.successor.claimId,markerDigest:intent.phases.marker_projected.values.markerDigest,
mutationAuthorityReceipt:receipt,mutationAuthorityReceiptDigest:receipt.receiptDigest,
terminalExpansionIntentDigest:digestValue({...plan.evidence.expansion.intent,...terminal})}
;return Object.freeze({...core,operationDigest:digestValue(core)})}
function normalizeFinalizationOperation(plan,intent,live,operation){if(!operation||typeof operation!=="object"){
throw new Error("Expansion finalization operation is missing.")}const{operationDigest,...core}=operation
;const receipt=normalizeMutationAuthority(core.mutationAuthorityReceipt);const expected=finalizationOperation(plan,intent,live,receipt)
;if(operationDigest!==digestValue(core)||canonicalJson(operation)!==canonicalJson(expected)){
throw new Error("Expansion finalization operation drifted.")}return expected}
function validateFinalizationOperation(plan,intent,live,operation,fresh){const normalized=normalizeFinalizationOperation(plan,intent,live,operation)
;const current=normalizeMutationAuthority(fresh);if(canonicalJson(stableMutation(normalized.mutationAuthorityReceipt))!==canonicalJson(stableMutation(current))){
throw new Error("Expansion finalization mutation authority drifted.")}return normalized}
function normalizeMutationAuthority(value){const receipt={...value};const digest=receipt.receiptDigest;delete receipt.receiptDigest
;if(receipt.schema!=="agentic-admission-mutation-authority/v1"||receipt.status!=="ready"||digest!==digestValue(receipt)
||canonicalJson(Object.keys(value).sort())!==canonicalJson(["claimDigest","claimId","cloudVerificationReceiptDigest","evaluatedAt","expiresAt","ledgerRevision","localFenceSha","localLeaseEpoch","receiptDigest","remoteLeaseEpoch","schema","status"])
||!Number.isSafeInteger(receipt.localLeaseEpoch)||!Number.isSafeInteger(receipt.remoteLeaseEpoch)
||!Number.isFinite(Date.parse(receipt.evaluatedAt))||!Number.isFinite(Date.parse(receipt.expiresAt))){
throw new Error("Expansion finalization mutation authority is malformed.")}for(const key of["claimId","claimDigest","cloudVerificationReceiptDigest"]){requiredDigest(receipt[key],key)}
;sha(receipt.ledgerRevision,"mutation ledger revision");sha(receipt.localFenceSha,"mutation local fence");return Object.freeze({...receipt,receiptDigest:digest})}
function stableMutation(value){const{evaluatedAt:_evaluatedAt,cloudVerificationReceiptDigest:_cloudVerificationReceiptDigest,receiptDigest:_receiptDigest,...stable}=value
;return stable}
function mutationAuthority(plan,live,cloudVerifier,cloudAction,environment){
const verified=verifyAdmissionCloudAuthority({authority:live.lease.cloudAuthority,manifest:targetManifest(plan),
canonicalBaseSha:plan.evidence.expansion.intent.targetCanonicalBaseSha,environment:environment,inspect:cloudAction,
invoke:cloudVerifier});return assertAdmissionMutationAuthority({lease:live.lease,cloudAuthority:verified.authority,
remoteAuthorityVerification:verified.verification})}function phaseReceipt(plan,phase,rawValues){
const values=Object.freeze({...rawValues,receiptDigest:rawValues.receiptDigest||digestValue(rawValues)});const core={
schema:"agentic-task-authority-successor-projection-repair-phase-receipt/v1",phase:phase,planDigest:plan.planDigest,
operationKey:digestValue({schema:"agentic-task-authority-successor-projection-repair-phase-receipt/v1",
planDigest:plan.planDigest,phase:phase}),values:values}
;return normalizeTaskAuthoritySuccessorProjectionRepairPhaseReceipt({plan:plan,phase:phase,value:{...core,
receiptDigest:digestValue(core)}})}function promotedValues(claim,status){
if(!isActiveClaim(claim)||claim.writeAuthority!==true||claim.scopeReserved!==true){
throw new Error("Successor claim is not current write authority.")}return{
claimId:requiredDigest(claim.claimId,"successor claim ID"),
claimDigest:requiredDigest(claim.fenceRevision||claim.claimDigest,"successor claim digest"),
ledgerRevision:sha(status.ledgerRevision,"promotion ledger revision"),transitionCounter:claim.transitionCounter,
expiresAt:requiredText(claim.expiresAt,"promotion expiry"),state:"active",writeAuthority:true,scopeReserved:true,
operationReceiptDigest:requiredDigest(claim.operationReceiptDigest,"promotion operation receipt"),
claimLedgerRevision:requiredDigest(claim.transitionDigest,"promotion claim ledger revision")}}
function successorAuthority(plan,live,status,claim){
if(!isActiveClaim(claim))throw new Error("Successor claim is not active.");const{heartbeatCounter:_ignored,
...source}=live.lease.cloudAuthority;return Object.freeze({...source,claimId:claim.claimId,
claimDigest:requiredDigest(claim.fenceRevision,"successor claim digest"),
ledgerRevision:sha(status.ledgerRevision,"successor ledger revision"),
ledgerDigest:requiredDigest(status.ledgerDigest,"successor ledger digest"),
claimLedgerRevision:requiredDigest(claim.transitionDigest,"successor claim ledger revision"),
canonicalBaseSha:plan.evidence.expansion.intent.targetCanonicalBaseSha,
laneRevision:plan.evidence.source.snapshot.headSha,
cloudDeclaredWriteScope:plan.evidence.expansion.intent.planSnapshot.targetDeclaredWriteSet,
writeSetDigest:plan.evidence.expansion.intent.targetWriteSetDigest,leaseEpoch:1,
transitionCounter:claim.transitionCounter,state:"active",reviewRequestId:claim.reviewRequestId||null,
operationReceiptDigest:requiredDigest(claim.operationReceiptDigest,"successor operation receipt"),
expiresAt:claim.expiresAt,
manifestDigest:plan.evidence.expansion.intent.targetManifestDigest,integrationReceiptDigest:null,integration:null})}
function targetManifest(plan){const intent=plan.evidence.expansion.intent
;const declaredWriteSet=intent.planSnapshot.targetDeclaredWriteSet;return Object.freeze({
schema:"agentic-declared-write-scope/v1",
semanticScope:declaredWriteSet.find(item=>item.startsWith("semantic:"))?.slice(9),declaredWriteSet:declaredWriteSet,
writeSetDigest:intent.targetWriteSetDigest,manifestDigest:intent.targetManifestDigest})}function projectClaim(claim){
const core={claimId:requiredDigest(claim.claimId,"claim ID"),
claimDigest:requiredDigest(claim.fenceRevision||claim.claimDigest,"claim digest"),state:claim.state,
writeAuthority:claim.writeAuthority,scopeReserved:claim.scopeReserved,
canonicalBaseRevision:sha(claim.canonicalBaseRevision,"claim base"),
laneRevision:sha(claim.laneRevision,"claim lane revision"),
writeSetDigest:requiredDigest(claim.writeSetDigest,"claim write set"),leaseEpoch:claim.leaseEpoch,
transitionCounter:claim.transitionCounter,
predecessorClaimId:requiredDigest(claim.predecessorClaimId,"predecessor claim ID"),
reviewRequestId:claim.reviewRequestId||null,expiresAt:claim.expiresAt,
operationReceiptDigest:requiredDigest(claim.operationReceiptDigest,"claim operation receipt")};return Object.freeze({
...core,claimRecordDigest:digestValue(core)})}function projectPull(pull,number,markerDigest,bodyDigest){
return Object.freeze({url:pull.url,number:number,nodeId:pull.nodeId,repository:pull.repository,author:pull.author,
state:pull.state,isDraft:pull.isDraft,branch:pull.headRefName,headSha:pull.headRefOid,baseBranch:pull.baseRefName,
markerDigest:markerDigest,bodyDigest:bodyDigest})}
function assertPullExact(expected,actual,{allowProjectedBody:allowProjectedBody=false}={}){
const stable=projectPull(actual,actual.number,expected.markerDigest,expected.bodyDigest)
;for(const key of["url","number","nodeId","repository","author","state","isDraft","branch","headSha","baseBranch"]){
if(stable[key]!==expected[key])throw new Error(`Pull-request ${key} drifted.`)}
if(!allowProjectedBody&&(digestValue(actual.body)!==expected.bodyDigest||digestValue(requireMarker(actual.body))!==expected.markerDigest)){
throw new Error("Pull-request body or writer marker drifted.")}return actual}
function readPullRequest(text,pullNumber,target){
const value=JSON.parse(text("gh",["pr","view",String(pullNumber),"--repo",target,"--json","url,number,id,state,isDraft,headRefName,headRefOid,baseRefName,body,author,headRepository"]))
;return Object.freeze({url:value.url,number:value.number,nodeId:value.id,
repository:value.headRepository?.nameWithOwner||target,author:value.author?.login,state:value.state,
isDraft:value.isDraft,headRefName:value.headRefName,headRefOid:value.headRefOid,baseRefName:value.baseRefName,
body:String(value.body||"")})}function requireMarker(body){
const matches=String(body).match(/<!--\s*agentic-writer-lease\/v2\s+\{.*?\}\s*-->/gsu)||[]
;if(matches.length!==1)throw new Error("Pull request must contain exactly one writer marker.")
;const marker=parseWriterLeasePullRequestBody(matches[0])
;if(!marker)throw new Error("Pull-request writer marker is malformed.");return marker}
function cloudStatus(live,cloudAction,environment){return cloudAction({action:"status",
ledgerRepository:live.lease.cloudAuthority.ledgerRepository,request:{
targetRepository:live.lease.cloudAuthority.targetRepository},environment:environment})}
function exactClaim(claims,claimId){const found=(claims||[]).filter(claim=>claim.claimId===claimId)
;if(found.length!==1)throw new Error("Cloud inventory lacks one exact successor claim.");return found[0]}
function isActiveClaim(claim){return["current","active"].includes(claim?.state)}function phaseIndex(value){
const phases=["prepared","projection_prepared","successor_promoted","successor_bound","lease_projected","marker_projected","expansion_finalized","verified","complete"]
;const index=phases.indexOf(value);if(index<0)throw new Error("Repair phase is invalid.");return index}
function nextPhase(value){const phases=["prepared","projection_prepared","successor_promoted","successor_bound",
"lease_projected","marker_projected","expansion_finalized","verified","complete"]
;return phases[Math.min(phaseIndex(value)+1,phases.length-1)]}
function readJournal(file){if(!existsSync(file))return null;const record=JSON.parse(readFileSync(file,"utf8"))
;if(record.schema!=="agentic-task-authority-successor-projection-repair-journal/v2"||record.intentDigest!==digestValue(record.intent))throw new Error("Repair journal is malformed.")
;return record.intent}function writeJournalCas(file,expected,value,now){
if(nullableDigest(readJournal(file))!==nullableDigest(expected))throw new Error("Repair journal changed before CAS.")
;writeJson(file,{schema:"agentic-task-authority-successor-projection-repair-journal/v2",intent:value,
intentDigest:digestValue(value),updatedAt:now().toISOString()});return value}function readEffect(root,phase){
const file=`${root}.${phase}.json`;return existsSync(file)?JSON.parse(readFileSync(file,"utf8")):null}
function writeEffect(root,phase,value){const file=`${root}.${phase}.json`;if(existsSync(file)){
const current=JSON.parse(readFileSync(file,"utf8"))
;if(canonicalJson(current)!==canonicalJson(value))throw new Error(`Repair ${phase} effect record drifted.`)
}else writeJson(file,value);return value}function writeJson(file,value){const parent=path.dirname(file)
;const created=!existsSync(parent);mkdirSync(parent,{recursive:true,mode:448});if(created)syncDirectory(parent)
;const temporary=`${file}.${process.pid}.${Date.now()}.tmp`;const descriptor=openSync(temporary,"wx",384)
;try{writeSync(descriptor,`${JSON.stringify(value,null,2)}\n`);fsyncSync(descriptor)}finally{closeSync(descriptor)}
;renameSync(temporary,file);syncDirectory(parent)}function syncDirectory(directory){const descriptor=openSync(directory,"r")
;try{fsyncSync(descriptor)}finally{closeSync(descriptor)}}function seal(core){
return Object.freeze({...core,receiptDigest:digestValue(core)})}function remoteHead(raw,branch){
const value=raw("git",["ls-remote","--heads","origin",`refs/heads/${branch}`]).toString("utf8").trim()
;return sha(value.split(/\s+/u)[0],"remote head")}function splitNul(value){
return Buffer.from(value).toString("utf8").split("\0").filter(Boolean)}function writePaths(set){
return new Set(set.filter(item=>item.startsWith("path:")).map(item=>item.slice(5)))}function difference(left,right){
return left.filter(item=>!right.includes(item))}function nullableDigest(value){
return value===null?null:digestValue(value)}function requiredText(value,label){const result=String(value??"").trim()
;if(!result)throw new Error(`${label} is required.`);return result}function requiredRepository(value,label){
const result=requiredText(value,label)
;if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(result))throw new Error(`${label} must be owner/name.`);return result}
function requiredDigest(value,label){
if(!/^[0-9a-f]{64}$/u.test(String(value||"")))throw new Error(`${label} must be a SHA-256 digest.`);return value}
function sha(value,label){if(!/^[0-9a-f]{40}$/u.test(String(value||"")))throw new Error(`${label} must be a Git SHA.`)
;return value}function positiveInteger(value,label){
if(!Number.isSafeInteger(value)||value<1)throw new Error(`${label} must be positive.`);return value}
function realDirectory(value,label){const target=path.resolve(requiredText(value,label));return path.resolve(target)}
function realFile(value,label){const target=path.resolve(requiredText(value,label))
;if(!existsSync(target))throw new Error(`${label} does not exist.`);return target}function repositoryFromOrigin(value){
return String(value).match(/^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u)?.[1]||null
}
