# Central test log

Latest recorded result: **Graph — 4,511 passed, 303 failed, 4,814 total.**

This file centralizes reported validation results; executable suites remain in their source repositories. A failed full suite remains failed even when its focused checks pass.

## Graph commerce efficiency — 2026-09-07 (v49)

| Field | Recorded evidence |
| --- | --- |
| Owner | `agentic-graph` |
| Full command | `npm test` from the source repository root |
| Completed registry | 4,511 passed / 303 failed / 4,814 total |
| Aggregate exit | `1` — failed |
| Duration | 249.356 seconds; observation, not a controlled performance benchmark |
| Source HEAD | `1e1afe87835b4f2332f4fc83a135b5ca4a8ed469` |
| Source branch | `agent/huis-macbook-pro-3.local/commerce-request-efficiency-validation` |
| Source state | Admitted, uncommitted successor; HEAD alone does not identify the tested bytes |
| Full source observation digest (SHA-256) | `8da7b5a98abf2c21946419259ed8598e3171f3dd8e62d66c54d6e265d37e411a` |
| Pinned Canvas docs | `b62ba844b8c68e3b542099ee90acdcf8a5ba9e64` |
| Before/after | Source, canonical Graph and pinned docs unchanged; run completed normally with no remaining owned process |
| Previous v48 | 4,508 passed / 306 failed / 4,814 total |
| Exact case comparison | 3 fixed; 0 new failures; 0 added; 0 omitted; duplicate IDs retain occurrence identity |
| Original regression cohort | 47 passed / 0 failed / 0 omitted |

Fixed existing cases:

- `storage.enhancement.property.24.cloudOrderedRoundTrip`
- `chat.responseContract.storage.workspaceArtifactPromotionFailureNote`
- `chat.responseContract.coordinator.publishesValidatedAndAppliedPipelineSnapshots`

### Applicable checks

| Check | Result | Command / scope |
| --- | --- | --- |
| Declared Canvas checks | Passed, 55.483 s | `npm --prefix canvas run check`; TypeScript and three Node browser-harness checks |
| Payment ledger | 163 passed in six files | First stage of `npm test`; native ledger suite |
| Storage relay | 111 passed / 0 failed, 4.079 s | `npm run storage:relay:test` |
| Standalone browser exports | 4 passed, 10.636 s | `npm --prefix canvas run test:ci:standalone-export`; separate run because the failed registry stopped the aggregate before this stage |
| Two-tab recovery browser | 4 passed, 20.199 s | `npm --prefix canvas run test:storage-parent-child-browser-smoke`; real Chromium/IndexedDB, server closed |

Whole-run success and production readiness remain unproven. The 303 failures below are unresolved; independent Commerce evaluator authority, runtime inputs and deployed payment evidence are also missing. Six surviving failure diagnostics changed; five first differences were dynamic fixture values and one was a Source Files list in a persistent timeout. No failure was waived.

### Receipt fingerprints

Local receipt directory: `$CODEX_HOME/visualizations/2026/09/07/01a0794e-fdda-7310-9060-816b4837e059/`. The log is self-contained for counts and case identity; full machine receipts and bounded compressed raw logs are in that directory.

| Receipt | SHA-256 |
| --- | --- |
| `graph-v49-validation-manifest.json` | `3ad2e465ffdd6055e25b6189b5a5218ef98b19c3a1e5eac9d76afed251515a72` |
| `graph-v49-case-comparison.json` | `1d983c36eb0c15915e73af8790e3e93dd44600079a1fa54775f9b6222420f919` |
| `graph-v49-combined-freeze.json` | `538b7bd5172f35bc2ffc65584603063f7ea37f2eadd362f740c89b6f4a1fa2be` |
| `graph-v49-browser-recovery-validation.json` | `12d7fd08d9301851d00cd8f0ea51235b0f5ef0dce9ab80e5eab637f5ffe592ac` |
| `graph-v49-closeout.json` | `9918e7574ae4c4c4feba5908958ef60c7a9275a01ce31abd67a6b559d8b4c9b4` |

### Unresolved registry cases (303)

Exact case IDs and occurrences from the completed native `RUN`/`DONE` ledger follow. Preserve this identity when comparing a later run.

| Case ID | Occurrence |
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
| `ui.mainPanel.integrationsHub.serverManagedDefaultMemoryOnlyByok` | 1 |
| `ui.mainPanel.integrationsHub.surfacesBytePlusModelArkMcpConfig` | 1 |
| `mcp.server.localToolContract.sharedAndStable` | 1 |
| `ui.mainPanel.integrationsHub.openAiServerManagedKey` | 1 |
| `htmlVideoRenderer.sourceContracts.sharedOwners` | 1 |
| `videoAgent.demo.executableReplayContract` | 1 |
| `videoAgent.timeline.bottomPanelDenseFbfNoOverlap` | 1 |
| `richMedia.panel.iframeScrollResizeSourceContract` | 1 |
| `docs.agenticCanvasOsDemo.marketToArtifactPipeline` | 1 |
| `ui.mainPanel.requestedIntegrationsSearch.miromindApiKeyServerManaged` | 1 |
| `chat.providers.openaiServerManagedEnvFiles` | 1 |
| `ui.multiDimTable.structuredSource.presentationDefaults` | 1 |
| `ui.multiDimTable.structuredSource.visibleTable` | 1 |
| `ui.multiDimTable.structuredSource.strybldrValidationYamlFrontmatter` | 1 |
| `ui.multiDimTable.pivot.rowsColumns` | 1 |
| `ui.canvas.liveHero.physicsPlaygroundSourceFidelity` | 1 |
| `ui.canvas.liveHero.interactiveWorkspaceCanvas` | 1 |
| `ui.canvas.liveHero.canvasEmbedVisibleAction` | 1 |
| `canvas.xrV2.permissionsPolicy.staticAndIframe` | 1 |
| `storyboardWidget.outputWiring.documentSummaryUsesHeadlessCoordinator` | 1 |
| `ui.floatingPanelChat.apiKeyPrompt.selectedProviderRendered` | 1 |
| `ui.floatingPanelChat.videoPreset.loadsSourceBackedInvocation` | 1 |
| `ui.floatingPanelChat.videoPreset.failsClosedWithoutSource` | 1 |
| `ui.floatingPanelChat.videoPreset.defersHostArtifactUntilFinalization` | 1 |
| `ui.floatingPanelChat.newChat.sendingCreatesFreshSession` | 1 |
| `ui.floatingPanelChat.contextRail.quickActions` | 1 |
| `ui.floatingPanelChat.composer.agenticGraphProbeTreeInvocationGrammar` | 1 |
| `canvas.probeTree.outputLayout.runMaterializationFitsCapturedViewport` | 1 |
| `canvas.probeTree.outputLayout.toolbarPublicationVersionsGraph` | 1 |
| `ui.floatingPanelChat.storyboardTemplate.responseContract` | 1 |
| `ui.floatingPanelChat.noSlash.cleanSlateRuntimePrompts` | 1 |
| `ui.floatingPanelChat.prdTadSlash.mediaOnlyProviderPayload` | 1 |
| `ui.floatingPanelChat.message.mediaChip` | 1 |
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
| `storage.enhancement.conflict.sharedToastLog` | 1 |
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
| `workspace.initializationSeed.materialization.preservesCanonicalGraphLanding` | 1 |
| `baseline.mainPanel.graphFields.widgetGallery.smartMediaPreset` | 1 |
| `runtimePersistence.syncKey.ssot.sharedAcrossSubscriptions` | 1 |
| `sourceFiles.parsedState.ownership.centralized` | 1 |
| `workspace.import.focus.avoidsDuplicateGraphApply` | 1 |
| `workspace.writeThroughAndActiveDocSync.ownership.centralized` | 1 |
| `sourceFiles.githubWrite.pagesRouteDryRunDoesNotCallGitHub` | 1 |
| `sourceFiles.bootstrap.storageInboundApply.skipsQueueEcho` | 1 |
| `workspace.markdownDocumentSetter.decouplesWorkspaceViewMode` | 1 |
| `store.hydration.reusesSharedLocalStorageSnapshot` | 1 |
| `flow.widget.richMediaPanel.textMode.reusesMarkdownPreviewSsot` | 1 |
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
| `flowCanvas.integration.renderDataAndZoomState` | 1 |
| `storyboardWidget.integration.wheelPanInfiniteCanvasNoLayoutWrites` | 1 |
| `storyboardWidget.integration.dragZoomWorkspaceToggleCollectiveLayoutStable` | 1 |
| `flowCanvas.scene.rebuildsWhenPortHandlesToggleChangesSchemaPresentation` | 1 |
| `workspaceFs.activeEntry.prefersCanonicalDocsMirrorForCorruptedNodeTypeResidue` | 1 |
| `workspaceFs.activeEntry.prefersCanonicalDocsMirrorForCorruptedEdgeEndpointResidue` | 1 |
| `groupBoxNoStickRegression.deepNesting` | 1 |
| `sourceFiles.composed.boot.prefersEnabledReadmeFrontmatterPreset` | 1 |
| `sourceFiles.composed.orderOnly.noPresetReplay` | 1 |
| `sourceFiles.composed.deleteLastEnabled.clearsGraphAndWidgets` | 1 |
| `markdownWorkspace.explorer.crudActions.createDelete` | 1 |
| `markdown.sourceFiles.panel.dnd` | 1 |
| `workspaceFs.seed.noReseedAfterUserDeletesAll` | 1 |
| `workspaceFs.seedProvider.prefersCompleteStorageExportDatasetForSync` | 1 |
| `workspaceFs.seedProvider.keepsEmptyAndModelAssetDocsMirrorFiles` | 1 |
| `workspaceFs.activeEntry.prefersCanonicalDocsMirrorForCorruptedLabelResidue` | 1 |
| `workspaceFs.activeEntry.prefersCanonicalDocsMirrorForCorruptedNodeStringPropertyResidue` | 1 |
| `workspaceFs.activeEntry.prefersCanonicalDocsMirrorForCorruptedEdgeStringResidue` | 1 |
| `workspaceFs.seedProvider.runtimeReflectsSourceFilesFromDynamicDocsRoot` | 1 |
| `workspaceFs.seedProvider.runtimeSyncsFullDocsMirrorTree` | 1 |
| `workspaceFs.bootstrap.materializesActiveWorkspaceEntryIntoParsedSourceFile` | 1 |
| `workspaceFs.bootstrap.materialize.sharedSnapshotHelpersCentralizeReuseRules` | 1 |
| `workspaceFs.bootstrap.materialize.activePathRematerializeStaysHydrationOnly` | 1 |
| `workspaceFs.memory.forbidsInitializationFileDelete` | 1 |
| `workspaceFs.memory.refreshesStaleInitializationFileText` | 1 |
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
| `workspace.sourceFiles.sync.suppressesLegacyRootSeedAliasesWhenDocsMirrorExists` | 1 |
| `graph.data.frontmatterFlow.openWidgetIdsStayRegistryScoped` | 1 |
| `ui.collapsibleDefaultsCompactAndAnchoredToLsKeys` | 1 |
| `ui.export.htmlCanvas.standaloneRewriteRewritesAllUrlAttrs` | 1 |
| `ui.graphCanvasRoot.overlays.hideSet.prefersPlanned` | 1 |
| `ui.threeGraph.tableOverlays.allowedInMultiDim` | 1 |
| `ui.workspaceEditor.overlay.pointerContract.noBlockingScrim` | 1 |
| `ui.toolbar.launch.newMarkdown.sharedDocsCreator` | 1 |
| `store.composedPositionWriteback.manualOnly` | 1 |
| `ui.overlay.drag.cursorTracking.noSnapDuringMove.flow` | 1 |
| `ui.overlay.drag.cursorTracking.noSnapDuringMove.design` | 1 |
| `ui.overlay.pan.cursorTracking.ignoresSpeedMultipliers` | 1 |
| `ui.toolMenu.drag.usesSharedPointerDrag` | 1 |
| `ui.floatingPanel.defaultGeometry.commandPanelAligned` | 1 |
| `ui.mainPanel.drag.noChurn` | 1 |
| `ui.workspaceAutoOpen.skipsWhenSelectionSourceChangesToEditor` | 1 |
| `ui.sourceFiles.compose.crudSync.addNodePrefersActiveMarkdownSourceLayer` | 1 |
| `ui.sourceFiles.compose.crudSync.addNodeSeedsActiveMarkdownSourceLayerWithoutPreexistingComposedGraph` | 1 |
| `ui.lazyLoading.gates.heavyFeatureSurfaces` | 1 |
| `ui.overlayPanels.markdownDesign.usesTransformBox` | 1 |
| `d3.labels.strictCollisionWiring` | 1 |
| `flowAndDesign.budgetedCollisionRelaxWiring` | 1 |
| `workspaceFs.seedProvider.publishedStorageOwnsAgenticDocs` | 1 |
| `workspaceFs.activeDocument.blankPersistedTextFallsBackToDocsMirror` | 1 |
| `workspaceFs.applyImport.forceIncludeOnlySkipsInactiveWorkspaceRecords` | 1 |
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
