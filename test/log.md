# Central test log

Latest recorded result: **Graph — 4,558 passed, 268 failed, 4,826 total.**

This file centralizes validation results; executable suites remain in their source repositories. A failed full suite remains failed even when focused checks pass.

## Graph native compiler cache and fixture validation — 2026-09-07 (v70)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,558 passed / 268 failed / 4,826 total |
| Aggregate exit | `1` — failed |
| Duration | 241.309 seconds; no whole-suite speedup established |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `7c6584ba09948c067f3d9fdc3a6ed2f74c35bebef2f5afab374aa33c74bc1482` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned process |
| Exact comparison with v63 | 5 fixed; 0 regressed; 0 added; 0 omitted |
| Latest declared source check | Passed in 62.131 seconds after the final fixture edit |
| Independent standalone export | Passed in 13.160 seconds; four unchanged artifacts below 500 kB |

Canvas now enables its pinned TypeScript compiler's native incremental cache. On this machine, the complete declared check took 57.501 seconds without incremental compilation, 71.144 seconds on the first incremental run, and 6.093 seconds on an unchanged warm run. Later source edits took 17–62 seconds. The ignored per-worktree compiler metadata is approximately 1.65 MB; no test verdicts are cached. This does not establish a CI or whole-registry speedup.

The five repaired cases retain their registry identities and cover protected initialization deletion, stale initialization refresh, authoritative empty-document hydration, table overlays across 3D/XR/voxel modes, and seed alias synchronization. Alias coverage now occupies a focused module; its original module is below 600 lines. No remaining failure was waived.

Commerce's fresh diagnostic still rejects runtime setup: no enrolled issuer, missing external trust anchor, trusted Git binding and isolated executor, plus the retired lifecycle verifier. These are source migration and independent provisioning requirements. The diagnostic imported no executor and issued no attestation.

## Graph bounded import materialization — 2026-09-07 (v63)

| Field | Recorded evidence |
| --- | --- |
| Full command | `npm test` from Graph source root |
| Completed registry | 4,553 passed / 273 failed / 4,826 total |
| Aggregate exit | `1` — failed |
| Duration | 239.732 seconds; observation, not a controlled benchmark |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `6d8ea8e67eb6e33a8d592e719e402453ef149ecc0c88ba6cc99a3a07ad1f79f1` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned process |
| Exact comparison with v59 | 6 fixed; 0 regressed; 0 added; 0 omitted |
| Declared source checks | Passed in 61.172 seconds |
| Independent standalone export | Passed in 10.620 seconds; four unchanged artifacts, each below 500 kB |

Import materialization now admits requested paths, existing Source Files, and companion files registered with the imported URL. It avoids reading unrelated document text and preserves empty disabled documents. Explicit removals are published even when the surviving records are unchanged. The URL import primary-landing contract remains intact. Regression coverage retains its case ID in a focused source-owned module.

The six fixes also include the composed-document transition fixtures and export/overlay source checks from v60–v62. An intermediate v63 run had 4,551 passes and 275 failures, including two new contract regressions; that candidate was superseded. The final complete run above has no regressions against v59. This is source validation, not Production or independent Commerce evaluator evidence.

## Graph commerce efficiency — 2026-09-07 (v59)

| Field | Recorded evidence |
| --- | --- |
| Owner | `agentic-graph` |
| Full command | `npm test` from the source repository root |
| Completed registry | 4,547 passed / 279 failed / 4,826 total |
| Aggregate exit | `1` — failed |
| Duration | 233.392 seconds; observation, not a controlled benchmark |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source branch | `agent/huis-macbook-pro-3.local/commerce-request-efficiency-validation` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify tested bytes |
| Full source observation digest (SHA-256) | `f3c1409a8d9071a9220e2824c10f8d659f20c7d0f540cd1e67169d146290e15e` |
| Pinned Canvas docs | `b62ba844b8c68e3b542099ee90acdcf8a5ba9e64` |
| Before/after | Source, canonical Graph, pinned docs and native lane unchanged; no remaining owned process |
| Exact comparison with v58 | 8 fixed; 0 regressed; 0 added (0 failed); 0 omitted |
| Original regression cohort | 47 passed / 0 failed / 0 omitted |

The native test runner now composes up to 32 filters within 32 KiB, deduplicates them and rejects oversized input; previously only the first filter ran. Four composed-source cases isolate a suite stall caused by closing their browser before native surface transitions settled. The corrected group passes in under one second of case execution, without a full-registry retry. Test cleanup releases prior renderer, explorer, credential and toast state; workspace fixtures drain their native coordinator and use local snapshot inputs.

Mermaid error reporting now reuses the bounded visible-toast store (three entries) instead of retaining a second module-level error cache. A repeated error after dismissal must become visible again. Eight focused Mermaid cases pass. Source checking passes; these results do not establish production readiness or an ecosystem-wide speedup.

Fixed existing cases:

- `flow.widget.richMediaPanel.textMode.reusesMarkdownPreviewSsot` (occurrence 1)
- `sourceFiles.composed.boot.prefersEnabledReadmeFrontmatterPreset` (occurrence 1)
- `sourceFiles.composed.deleteLastEnabled.clearsGraphAndWidgets` (occurrence 1)
- `sourceFiles.composed.orderOnly.noPresetReplay` (occurrence 1)
- `storage.enhancement.conflict.sharedToastLog` (occurrence 1)
- `workspace.initializationSeed.materialization.preservesCanonicalGraphLanding` (occurrence 1)
- `workspaceFs.bootstrap.materialize.sharedSnapshotHelpersCentralizeReuseRules` (occurrence 1)
- `workspaceFs.bootstrap.materializesActiveWorkspaceEntryIntoParsedSourceFile` (occurrence 1)

### Result history

| Run | Passed | Failed | Total |
| --- | ---: | ---: | ---: |
| v49, preserved in Canvas PR #892 at `f664e09843afd1edbd665b199f5743f5c7a1fefc` | 4,511 | 303 | 4,814 |
| v55 | 4,532 | 293 | 4,825 |
| v56 | 4,533 | 292 | 4,825 |
| v57, preserved in Canvas PR #893 | 4,537 | 289 | 4,826 |
| v58, released through Canvas PR #894 | 4,539 | 287 | 4,826 |

### Applicable checks

| Check | Result | Command / scope |
| --- | --- | --- |
| Declared Canvas checks | Passed, 67.763 s | `npm --prefix canvas run check`; TypeScript and local browser-harness checks |
| Historical v58 FlowCanvas before | 48 passed / 4 failed, 24.798 s | `test:ci:unit -- flowCanvas.` |
| Historical v58 FlowCanvas after | 50 passed / 2 failed, 5.072 s | Same command, about 80% faster on this machine; two existing timeouts corrected |
| Payment ledger | 163 passed | First stage of the full `npm test` |
| v59 standalone export and browser | Passed, 10.111 s | `npm --prefix canvas run test:ci:standalone-export`; four artifacts valid and below 500 kB; source, docs and lane unchanged |
| Historical v54 browser / standalone | 4 passed / 4 passed | Original source identities retained; historical evidence only |

Whole-run success and production readiness remain unproven. Remaining registry failures, independent Commerce evaluator inputs and deployed payment evidence are unresolved. No failure was waived.

## Upstream validation time — agentic-os PR #66

The eleven-case malformed-body matrix measured **28.116 s before / 6.082 s after** (78% reduction on this machine). Nine cases reuse the production validator directly; two retain distinct CLI rejection boundaries. Valid publication, exact size/BOM and body-mutation CLI checks remain. This is not a full-suite or production speedup claim.

Full `npm run check`: **670 passed / 0 failed / 0 skipped**, plus evaluations, in **169.430 s**. Required CI `test` and `budgets` passed for `71abdccb3a2886a4dbc0943ad49b5d47efbad53b`. The source candidate remains separately unmerged; no new deployment or cleanup authority is inferred.

## Upstream reusable validation plan — agentic-os PR #67

The existing CLI, `/checks` and MCP discovery owner now plans 10 commands from 19 six-repository catalog entries. Exact npm chains retain authored order and hooks; covered commands can be omitted only after successful complete execution. Failed or filtered runs grant no inferred coverage. This is command-count reuse, not a measured ecosystem elapsed-time speedup.

Full upstream checks: 671/671 tests and evaluations passed in 181.608 seconds. Required CI passed at `07bf15291c46999f73a39e5e92b449058a74c844`; native handoff recovered. Exact source-release approval remains pending.

## Upstream bounded remote reads — agentic-os PR #69

Candidate `23edf927e837c415f8db5a2bf48cf927897013db` passed all 677 upstream tests plus evaluations and required CI. Full local checks took 176.035 seconds. Shared remote ref reads have a 15-second POSIX deadline, bounded output, and process-tree cleanup; partial output cannot establish success. Writes retain their existing behavior. The Windows path was not runtime tested on this Mac. This bounds an observed transport stall; it is not a measured whole-suite throughput improvement. Exact source release authority remains pending.

## Commerce independent evidence — provisioning readback

The committed baseline still has zero trusted dispatch issuers. Read-only GitHub metadata found zero repository environments, Actions variables and Actions secrets. No secret values were requested. The gate requires an evaluator-owned trust anchor, signer, default-deny isolated executor and exclusive artifact sink. Candidate-generated keys or signatures cannot establish that independent authority. Provisioning and a fresh signed evaluator run remain required; deployment and live payment proof remain unestablished.

### v70 receipt fingerprints

| Receipt | SHA-256 |
| --- | --- |
| `graph-v70-full.json` | `167aadda9312d18a6bea8e95d02ec572a6e2316f3379d20864455ea7dc20552a` |
| `graph-v70-case-comparison.json` | `9659394b0a2f3dc461220ccfd21c244b3536fee6011a997251a10b909b115856` |
| `graph-v70-standalone.json` | `5725d28b84772e1e65c1d5df5dbb414a8f001c9c71bd27e9feb2f1c02da1dbbd` |
| `commerce-v70-readiness.json` | `4fb820b8f71658b23d794ce790eaebff22f2ad151c154a067f395d42e7b3d362` |

### Receipt fingerprints

Local receipt directory: `$CODEX_HOME/visualizations/2026/09/07/01a0794e-fdda-7310-9060-816b4837e059/`. Counts and case identities are self-contained here; exact machine observations and raw logs remain in the named receipts.

| Receipt | SHA-256 |
| --- | --- |
| `graph-v59-standalone.json` | `ef4cb59b4696fe02b89ede21bf763df8e05463aa79708ac4546d04990bea55cc` |
| `commerce-evaluator-provisioning-readback-v59.json` | `a9be191261d12bb5cf8d4fe8b37a3ea23f9b9e71a301895286b2e4e0442a7ddd` |
| `graph-v59-full.json` | `742a57b5fde9c4e6aeec2b00c0427a6797e54736f79908b690ac8d0b6e7e8d0e` |
| `graph-v59-source-freeze.json` | `6d8856299761c8cab4818d9bb0b8420cd7a123d233f1b0f4136ddffbee8a456c` |
| `graph-v59-case-comparison.json` | `edaf150d79a3e153016fca9c5567850a5bb2f9df56b2b01b0a0a49bc9122beb3` |
| `graph-v58-case-comparison.json` | `ea82e097bd9ee841e44f34da9f99dca7d945a759823ecab93ac6318ac10c0956` |
| `graph-v58-source-freeze.json` | `193eb20ffc7c820114d6fd3f0a0681497bd6592521c7d12d5aac7c15aaf44978` |
| `graph-v58-validation-manifest.json` | `042c9f834658540efbe119a1a0424dff1fccf4032d4dd3b4e9203eb991c441d3` |
| `validation-economy-release.json` | `c64b669c9dde88e218388d048eec72c7061f3be7c4f9894123e205b047c4a311` |
| `upstream-validation-plan-release.json` | `3dc29f4e853bdf1a7b0c30a301ff124ad31ed14fc7e8f41e39cf73e84bb8ab49` |

### Unresolved registry cases (268; complete v70)

| Case ID | Failures |
| --- | --- |
| `canvas.viewSelection.xrSurfaceMode` | 1 |
| `canvas.xrMode.sharedSurfaceOwnershipBoundaries` | 1 |
| `canvas.xrMode.motionReferencePackage` | 1 |
| `canvas.xrMode.animationRuntime` | 1 |
| `canvas.xrMode.sharedAssetControlRuntime` | 1 |
| `canvas.viewSelection.shared3dSurfaceModeOwner` | 1 |
| `canvas.viewport.mobileHeavyRuntimeIntent.sourceGate` | 1 |
| `richMedia.panel.storyboardCardSharedMediaSurface` | 1 |
| `markdown.frontmatterFlowGraph.fidelity.tokenEconomicsSemanticPortHandles` | 1 |
| `markdown.frontmatterFlowGraph.fidelity.tokenEconomicsRenderableWidgetHandles` | 1 |
| `markdown.frontmatterFlowGraph.fidelity.agenticGraphVideoDemo.directorBriefShots` | 1 |
| `markdown.frontmatterFlowGraph.fidelity.agenticGraphVideoDemo.16x9CompositionContract` | 1 |
| `markdown.frontmatterFlowGraph.chatAgenticGraph.outputNodeSourceHandles.keptForWidgetAnchors` | 1 |
| `markdown.frontmatterFlowGraph.chatAgenticGraph.removesConflictingComputeAndWiringData` | 1 |
| `markdown.frontmatterFlowGraph.chatAgenticGraph.agenticOsSample.typedTurnDetailPortsOnly` | 1 |
| `markdown.frontmatterFlowGraph.chatAgenticGraph.prunesUnreferencedHandlesAndKeepsEdgeMappedPorts` | 1 |
| `importRenderPipeline.frontmatterFlow.agenticGraphVideoDemo.autoModes` | 1 |
| `importRenderPipeline.markdownGraphApply.rejectsStaleStrybldrSourceGraph` | 1 |
| `importRenderPipeline.markdownGraphApply.rejectsEmptyCachedStrybldrSourceGraph` | 1 |
| `importRenderPipeline.markdownGraphApply.requestsFitAfterViewPresetGraphApply` | 1 |
| `policy.boundary.forbidSiblingRepoSourceImports` | 1 |
| `ui.floatingPanel.geo.clickableWhenDisabledByState` | 1 |
| `modeLock.viewLock.rendererGuardsStayConsistent` | 1 |
| `viewport.d3.groups.zIndexOverrideKey` | 1 |
| `viewport.storyboardWidget.overlay.collision.convergesWithoutRetryChurn` | 1 |
| `viewport.d3.groups.altDrag.reusesSharedLookup` | 1 |
| `viewport.storyboardWidget.overlay.initCenteredGrid` | 1 |
| `viewport.storyboardWidget.overlay.initCenteredGridWithViewportOffset` | 1 |
| `viewport.storyboardWidget.overlay.reseedsAfterViewportStabilizes` | 1 |
| `viewport.storyboardWidget.overlay.reseedsWhenInitiallyStacked` | 1 |
| `viewport.storyboardWidget.overlay.reseedsWhenInitiallyVerticalStrip` | 1 |
| `viewport.storyboardWidget.overlay.indexing.rebalancesOnGraphContentRevision` | 1 |
| `ui.flowCanvas.richMediaOverlay.resizePersistsVisualSize` | 1 |
| `ui.flowCanvas.richMediaOverlay.selectionChromeParity` | 1 |
| `ui.flowWidget.portHandles.outputDomOrderPrefersCenterLane` | 1 |
| `agentReady.localMainPanelChatCanvasPipeline.renderedMcpResearchAgentDemoSuperAgentStoryboardWidget` | 1 |
| `agentReady.localMainPanelChatCanvasPipeline.researchAgentDemoSuperAgentStoryboardWidget` | 1 |
| `vdeoxpln.contract.registryProjection` | 1 |
| `ui.mainPanel.integrationsHub.surfacesBytePlusModelArkMcpConfig` | 1 |
| `mcp.server.localToolContract.sharedAndStable` | 1 |
| `htmlVideoRenderer.sourceContracts.sharedOwners` | 1 |
| `videoAgent.demo.executableReplayContract` | 1 |
| `videoAgent.timeline.bottomPanelDenseFbfNoOverlap` | 1 |
| `richMedia.panel.iframeScrollResizeSourceContract` | 1 |
| `docs.agenticCanvasOsDemo.marketToArtifactPipeline` | 1 |
| `chat.providers.openaiServerManagedEnvFiles` | 1 |
| `ui.multiDimTable.structuredSource.presentationDefaults` | 1 |
| `ui.multiDimTable.structuredSource.visibleTable` | 1 |
| `ui.multiDimTable.structuredSource.strybldrValidationYamlFrontmatter` | 1 |
| `ui.multiDimTable.pivot.rowsColumns` | 1 |
| `ui.canvas.liveHero.physicsPlaygroundSourceFidelity` | 1 |
| `ui.canvas.liveHero.interactiveWorkspaceCanvas` | 1 |
| `ui.canvas.liveHero.canvasEmbedVisibleAction` | 1 |
| `canvas.xrV2.permissionsPolicy.staticAndIframe` | 1 |
| `ui.floatingPanelChat.apiKeyPrompt.selectedProviderRendered` | 1 |
| `ui.floatingPanelChat.videoPreset.loadsSourceBackedInvocation` | 1 |
| `ui.floatingPanelChat.videoPreset.failsClosedWithoutSource` | 1 |
| `ui.floatingPanelChat.videoPreset.defersHostArtifactUntilFinalization` | 1 |
| `ui.floatingPanelChat.contextRail.quickActions` | 1 |
| `ui.floatingPanelChat.composer.agenticGraphProbeTreeInvocationGrammar` | 1 |
| `canvas.probeTree.outputLayout.runMaterializationFitsCapturedViewport` | 1 |
| `canvas.probeTree.outputLayout.toolbarPublicationVersionsGraph` | 1 |
| `ui.floatingPanelChat.storyboardTemplate.responseContract` | 1 |
| `ui.floatingPanelChat.noSlash.cleanSlateRuntimePrompts` | 1 |
| `ui.floatingPanelChat.prdTadSlash.mediaOnlyProviderPayload` | 1 |
| `ui.storyboard.fixedCardOverlay.flexInteractions` | 1 |
| `strybldr.markdown.storyboard2dTemplateRuntimeReadyNeutral` | 1 |
| `ui.flowWidget.storyboardCardTextLayout.readableChrome` | 1 |
| `ui.storyboard.probeTree.outputCommit.durableDraftAndCanonicalStore` | 1 |
| `strybldr.markdown.addedCardSyncPersistsAndRehydrates` | 1 |
| `strybldr.markdown.unownedCardEditDoesNotBackfillSource` | 1 |
| `strybldr.markdown.summaryEditSyncPersistsCardOverride` | 1 |
| `strybldr.markdown.fullGraphRichMediaTopology` | 1 |
| `canvas.xrMode.physics.nativeController.documentActivation` | 1 |
| `city.sim.mcp.inspectPurity` | 1 |
| `workspace.import.agentGraph.incompleteSkipsSourceFilesArtifact` | 1 |
| `policy.pagesHeaders.agenticGraphReportOnlyCsp.omitsIgnoredUpgradeDirective` | 1 |
| `policy.pagesHeaders.agenticGraphAppShellHtml.addsNoTransformForCloudflareJsd` | 1 |
| `policy.storage.deployScripts.seedDocsMirrorIntoD1` | 1 |
| `policy.storage.mainPanel.cloudflareMediaAssetSyncContract` | 1 |
| `policy.canvasDev5173.buildsLinkedPackagesBeforeVite` | 1 |
| `policy.docsSsotFixture.forbidHardcodedDeerFlowEndpointLiterals` | 1 |
| `policy.docsSsotFixture.hackamap.forbidHardcodedVolatileLiterals` | 1 |
| `policy.docsSsotFixture.hackamap.painpointDemoProduct.semanticMapping` | 1 |
| `ui.toolbar.touchScroll.staysSourceDriven` | 1 |
| `ui.groupGesture.dragSlop.centralized` | 1 |
| `ui.collapsedGroup.chevron.hitTargetAndDetailFallback` | 1 |
| `ui.groupResizeHandle.activeFeedbackAndInsetAnchor` | 1 |
| `ui.groupResizeHandle.visualPolish.activeOutlineAndLabelFeedback` | 1 |
| `ui.groupResizeHandle.nestedConflict.exclusiveActiveOwnership` | 1 |
| `ui.groupResizeHandle.transitions.sharedShapeAndLabel` | 1 |
| `ui.groupResizeHandle.transitions.chevronAndDot` | 1 |
| `ui.motionTokenSsoT.audit.noOtherRepoLevelCssMotionRecipes` | 1 |
| `baseline.storyboardWidget.frontmatterFlow.widgetAndTypedHandles` | 1 |
| `baseline.storyboardWidget.frontmatterFlow.upstreamVisualIsolationGuard` | 1 |
| `baseline.storyboardWidget.frontmatterFlow.overlayEdges.anchorThroughSharedOverlayRoots` | 1 |
| `baseline.storyboardWidget.frontmatterFlow.overlayEdges.persistAcrossWorkspaceToggleChurn` | 1 |
| `baseline.storyboardWidget.widget.byteplusLink.localFieldEdits` | 1 |
| `baseline.storyboardWidget.widget.output.textRunUsesSharedRichMediaPatch` | 1 |
| `baseline.storyboardWidget.widget.output.flowComputeRunsBeforeProvider` | 1 |
| `baseline.storyboardWidget.widget.output.workspaceArtifactPath` | 1 |
| `baseline.storyboardWidget.widget.output.durableArtifactDocumentContract` | 1 |
| `baseline.storyboardWidget.widget.output.runRefreshesOverlayEdges` | 1 |
| `maps.grabmaps.presetUsesPreferredStyleSetting` | 1 |
| `maps.grabmaps.workspaceSeeds.renderThroughYamlFrontmatterPipeline` | 1 |
| `baseline.storyboardWidget.widget.kvTable.portKeyValuePort` | 1 |
| `workspace.import.frontmatterPreset.canonicalTokensAndTableMode` | 1 |
| `baseline.mainPanel.graphFields.widgetGallery.smartMediaPreset` | 1 |
| `runtimePersistence.syncKey.ssot.sharedAcrossSubscriptions` | 1 |
| `sourceFiles.parsedState.ownership.centralized` | 1 |
| `workspace.import.focus.avoidsDuplicateGraphApply` | 1 |
| `workspace.writeThroughAndActiveDocSync.ownership.centralized` | 1 |
| `sourceFiles.githubWrite.pagesRouteDryRunDoesNotCallGitHub` | 1 |
| `sourceFiles.bootstrap.storageInboundApply.skipsQueueEcho` | 1 |
| `workspace.markdownDocumentSetter.decouplesWorkspaceViewMode` | 1 |
| `store.hydration.reusesSharedLocalStorageSnapshot` | 1 |
| `ui.storyboardWidgetOverlayLayering.overlayMode.noBlankWithoutOverlays` | 1 |
| `ui.storyboardWidgetOverlayLayering.workspacePanesElevated` | 1 |
| `ui.workspaceView.update.storyboardWidgetCollectiveLayoutRefresh` | 1 |
| `ui.designWireframe.cacheClearEpoch` | 1 |
| `layout.datasetKey.reusesSharedReaders` | 1 |
| `pipeline.2dRenderer.sharedSurfaceHelpers` | 1 |
| `layout.init.seedsOnlyMissingWhenStable` | 1 |
| `chat.floatingPanel.sharedLookup.rootFix` | 1 |
| `selection.normalization.sharedHook.rootFix` | 1 |
| `frontmatterMode.effective.whenSeedsExist` | 1 |
| `flow.dataflow.registeredWidgetCompute.propagatesOutputPorts` | 1 |
| `chat.responseContract.storage.agenticOsDeterministicFallbackStructuredAndValid` | 1 |
| `chat.responseContract.storage.agenticOsHeadlessStrybldrResponseFirst` | 1 |
| `chat.responseContract.storage.agenticOsIdentityNormalizationScalars` | 1 |
| `chat.responseContract.storage.agenticOsRejectsLegacyDocsWorkspacePath` | 1 |
| `chat.responseContract.structuredContent.tablesPersistAsMarkdownBlockScalars` | 1 |
| `store.persistence.schemaAndHistoryUseSharedDedupeFunnels` | 1 |
| `storyboardWidget.widget.toolbarVisibleWhenViewLockOn` | 1 |
| `parser.mermaid.typedDiagrams.neutralFlowTimelinePayload` | 1 |
| `ui.mermaidPanels.gitGraphGantt.sharedRouting` | 1 |
| `chat.responseContract.storage.agenticOsUniversalFlowDiagramsDynamicPanels` | 1 |
| `chat.responseContract.storage.agenticOsShapesCreativeScriptWithoutTrademarkCarryover` | 1 |
| `chat.responseContract.storage.agenticOsFallbackNeutralForGenericRequest` | 1 |
| `flow.widget.bundle.reusesSharedPlainObjectGuard` | 1 |
| `flow.widget.eligibility.reusesSharedReaders` | 1 |
| `ui.videoSequence.timelineBar.clickRequiresDragIntent` | 1 |
| `ui.videoSequence.timelineSurfaces.runtimeReady` | 1 |
| `workspace.import.localFiles.videoStackedSequenceDocument` | 1 |
| `ui.videoSequence.export.stability` | 1 |
| `floatingPanel.storyboardWidget.reusesSharedChrome` | 1 |
| `floatingPanel.formControls.sharedDensity` | 1 |
| `floatingPanel.formControls.chatModelCredentials.sharedStoryboardFlow` | 1 |
| `richMediaPanel.markdownPreview.disablesGlobalTokenStoreSync` | 1 |
| `searchPanel.selection.requestsSharedSelectionZoom` | 1 |
| `floatingPanel.media.storyboardCanvasNestedDropTargets` | 1 |
| `flow.widget.richMediaPanel.proxyAttrsAlignWithFlowWidget` | 1 |
| `flow.widget.richMediaPanel.dragHandlers.rendererScoped` | 1 |
| `storyboardWidget.integration.wheelPanInfiniteCanvasNoLayoutWrites` | 1 |
| `storyboardWidget.integration.dragZoomWorkspaceToggleCollectiveLayoutStable` | 1 |
| `groupBoxNoStickRegression.deepNesting` | 1 |
| `markdownWorkspace.explorer.crudActions.createDelete` | 1 |
| `markdown.sourceFiles.panel.dnd` | 1 |
| `workspaceFs.seed.noReseedAfterUserDeletesAll` | 1 |
| `workspaceFs.seedProvider.runtimeReflectsSourceFilesFromDynamicDocsRoot` | 1 |
| `workspaceFs.bootstrap.materialize.activePathRematerializeStaysHydrationOnly` | 1 |
| `geospatial.host.overlayNotGatedBySidebar` | 1 |
| `geospatial.canvas.forbidGraphWhenGeoEnabled` | 1 |
| `geospatial.widgetPanels.defaultFloatingAndHideDots` | 1 |
| `geospatial.widgetPanels.pendingOpenResolvesRenderedGraph` | 1 |
| `geospatial.widgetPanels.discoveryNotCoordinateBound` | 1 |
| `geospatial.widgetPanels.overrideStalePinnedReuse` | 1 |
| `geospatial.floatingPanel.requestedGeoView.enablesGeospatial` | 1 |
| `geospatial.host.supportsMapLibreGlobeRenderer` | 1 |
| `geospatial.host.remoteFetchProxy.noAbortOrTruncate` | 1 |
| `geospatial.gympgrphMapLibre.fallbackOnUnsafeRuntimeError` | 1 |
| `geospatial.host.maplibreHealthy.noSvgOverlayInterference` | 1 |
| `geospatial.host.maplibreBlank.svgFallbackVisible` | 1 |
| `canvas.viewport.geospatial.poiPreview.noAutoPanelWriteback` | 1 |
| `toolbar.launchDropdownFallback.activatesFirstImportedWorkspaceFile` | 1 |
| `markdown.workspace.folderModeContract.opensDocs` | 1 |
| `markdown.workspace.switch.immediatelySyncsPlainDocument` | 1 |
| `docs.careAgentDemo.runtimeReady` | 1 |
| `docs.careAgentDemo.runReadyMode` | 1 |
| `docs.riskCopilotDemo.runtimeReady` | 1 |
| `docs.riskCopilotDemo.runReadyMode` | 1 |
| `markdown.htmlBlocks.rendersGridAndPreCode` | 1 |
| `markdown.preview.viewerMedia.defaultInlineChip` | 1 |
| `webpageSandbox.promotesLazyImageDataSrc` | 1 |
| `commandMenu.graphMediaSelection.selectsPreviewMedia` | 1 |
| `commandMenu.mediaLayoutSelector.togglesGridAndList` | 1 |
| `commandMenu.markdownMediaRename.syncsWorkspaceHrefReferences` | 1 |
| `commandMenu.mediaInventory.deduplicatesMarkdownAndGraphSameUrl` | 1 |
| `preview.panel.graphMediaSelection.deduplicatesBytePlusVideoToCanonicalRichMediaPanel` | 1 |
| `preview.panel.graphMediaSelection.textPreviewCanonicalPanelSurface` | 1 |
| `preview.panel.standaloneLinks.webpageAndTweetSelectable` | 1 |
| `export.svg.3d.edgeRgba.alphaIsOpacity` | 1 |
| `export.svg.3d.shaderLine.opaqueEdges` | 1 |
| `export.svg.3d.nodeVisualOpacity` | 1 |
| `markdownPanelOverlay.worldScale.cardLayout` | 1 |
| `markdownPanelOverlay.viewportOrigin.clamp` | 1 |
| `markdownPanelOverlay.viewportOrigin.collectiveFit` | 1 |
| `markdownPanelOverlay.cardMarkdown.tableWidth` | 1 |
| `export.htmlWorkspace.viewerFallbackNoWarning` | 1 |
| `ui.tokens.ssot.indexCssDefinesAll` | 1 |
| `researchAgent.demo.ingestParseRender` | 1 |
| `ui.agenticOs.dictionary.consumerMetadata` | 1 |
| `ui.floatingPanelScrollBodies.sharedResponsiveOwner` | 1 |
| `ui.mainPanel.ktvRows.sharedEditableValueCell` | 1 |
| `semanticHtml.repo.forbidsGenericDivisionMarkup` | 1 |
| `ui.mainPanel.helpIconLibrary.sharedSsot` | 1 |
| `design.editor.importUrl.activatesSurface` | 1 |
| `routing.pagesShareRouteFallback.publishedDocRoutesFunctionOwned` | 1 |
| `ui.inlineCardEditor.viewerSurface.reusesMarkdownViewerWysiwygOwner` | 1 |
| `ui.inlineCardEditor.attachedMedia.staysOutOfTextareaEditValue` | 1 |
| `ui.floatingPanel.mediaActionInvoke.targetsActiveCardField` | 1 |
| `ui.floatingPanel.mediaPointerDownInvoke.targetsActiveCardField` | 1 |
| `ui.floatingPanel.mediaUploadedNameInvoke.targetsActiveCardField` | 1 |
| `ui.inlineCardEditor.markdownCommandMenus.completeDashboardKeywordContext` | 1 |
| `docs.guidelines.forbidAbsoluteRepoPathHardcodes` | 1 |
| `docs.e2eVideoFixtures.useTypedFrontmatterWrappers` | 1 |
| `docs.storyboardDemo.usesTypedFrontmatterWrappers` | 1 |
| `docs.canonicalAnimaticAndStoryboard.usePlainYamlFrontmatter` | 1 |
| `docs.guidelines.describeCanonicalAndNormalizedFrontmatterContracts` | 1 |
| `docs.storyboardWidget.publishedDocsMachineSsot` | 1 |
| `canvas.storyboard.nativeSourceContract` | 1 |
| `canvas.storyboard.toolbarProps.buildSharedToolbarConfig` | 1 |
| `canvas.storyboard.mediaDrop.actualReleasePoint` | 1 |
| `canvas.mediaInventory.audioSharedRenderOwners` | 1 |
| `overlay.widget.storyboardWidgetFrontmatterManualPlacementAuthority` | 1 |
| `layout.graphElementCentroid.2dRendererOwnersReuseSharedUtils` | 1 |
| `workspace.import.localFiles.svgFidelity` | 1 |
| `workspace.import.localFiles.activateImportedDocFrontmatterLanding` | 1 |
| `workspace.import.localFiles.videoDemo.runtimeRendererIsolation` | 1 |
| `workspace.import.localFiles.videoDemo.runtimeRendererIsolation.flowchart` | 1 |
| `workspace.import.localFiles.videoDemo.runtimeRendererIsolation.flow` | 1 |
| `workspace.import.localFiles.videoDemo.runtimeWidgetVisibility` | 1 |
| `workspace.sourceFiles.videoDemo.runtimeCollectiveBalancedFit.1920x1080` | 1 |
| `workspace.sourceFiles.videoDemo.screenAuthorityProjectsZoomLayout` | 1 |
| `workspace.sourceFiles.videoDemo.screenAuthorityDragPinUnpinStable` | 1 |
| `workspace.sourceFiles.videoDemo.runtimeOpenCloseReopen.inView.1920x1080` | 1 |
| `workspace.sourceFiles.videoDemo.runtimeInitialWorkspaceOpen.inView.1920x1080` | 1 |
| `graph.data.frontmatterFlow.openWidgetIdsStayRegistryScoped` | 1 |
| `ui.collapsibleDefaultsCompactAndAnchoredToLsKeys` | 1 |
| `ui.graphCanvasRoot.overlays.hideSet.prefersPlanned` | 1 |
| `ui.toolbar.launch.newMarkdown.sharedDocsCreator` | 1 |
| `store.composedPositionWriteback.manualOnly` | 1 |
| `ui.overlay.drag.cursorTracking.noSnapDuringMove.flow` | 1 |
| `ui.overlay.drag.cursorTracking.noSnapDuringMove.design` | 1 |
| `ui.overlay.pan.cursorTracking.ignoresSpeedMultipliers` | 1 |
| `ui.toolMenu.drag.usesSharedPointerDrag` | 1 |
| `ui.floatingPanel.defaultGeometry.commandPanelAligned` | 1 |
| `ui.mainPanel.drag.noChurn` | 1 |
| `ui.workspaceAutoOpen.skipsWhenSelectionSourceChangesToEditor` | 1 |
| `ui.lazyLoading.gates.heavyFeatureSurfaces` | 1 |
| `d3.labels.strictCollisionWiring` | 1 |
| `flowAndDesign.budgetedCollisionRelaxWiring` | 1 |
| `workspaceFs.seedProvider.publishedStorageOwnsAgenticDocs` | 1 |
| `chat.responseContract.docs.agenticOsPromptContractCanonical` | 1 |
| `queryableCorpus.mediaImport.metadataSourceUnit` | 1 |
| `strybldr.markdown.consolidatedDemoRoutesPanelsAndStoryboardRenderers` | 1 |
| `strybldr.markdown.starterTemplateRunnableNeutral` | 1 |
| `strybldr.markdown.workflowGanttSyncsWithStoryboardCards` | 1 |
| `strybldr.card.fieldCommitPersistsWithoutFloatingPanel` | 1 |
| `xr.spatialCaptureFallback.readiness` | 1 |
| `xr.spatialCaptureFallback.runtimeReady` | 1 |
| `strybldr.markdown.workspaceStructuredGraphFeedsStoryboardRenderers` | 1 |
| `strybldr.markdown.appendElementPersistsToStructuredPayload` | 1 |
| `strybldr.markdown.removeElementPersistsToStructuredPayload` | 1 |
| `strybldr.markdown.workflowEdgeSyncPersistsStructuredPayload` | 1 |
| `strybldr.videoHandoff.byteplusFallbackArtifact` | 1 |
| `strybldr.videoHandoff.generatedUpdatesStoryboardOutputMedia` | 1 |
| `strybldr.videoHandoff.consolidatedDemoLocalAnimatic` | 1 |
