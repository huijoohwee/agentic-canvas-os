(() => {
  const svg = d3.select("#svgRoot");
  const modeChip = document.getElementById("modeChip");
  const btnNewNode = document.getElementById("btnNewNode");
  const btnGeoMode = document.getElementById("btnGeoMode");
  const btnFit = document.getElementById("btnFit");
  const btnExport = document.getElementById("btnExport");
  const toastHost = document.getElementById("toastHost");
  const dataBox = document.getElementById("dataBox");
  const btnApplyData = document.getElementById("btnApplyData");
  const btnCopyData = document.getElementById("btnCopyData");
  let exportMenu;

  const state = {
    mode: "graph",
    selected: null,
    hoveredNodeId: null,
    linking: null,
    zoomTransform: d3.zoomIdentity,
    dims: { w: 800, h: 600 },
    geoProj: null,
  };

  function nowId() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function toast(message, kind = "info") {
    const el = document.createElement("div");
    el.className = `toast${kind === "error" ? " toast--error" : kind === "success" ? " toast--success" : ""}`;
    el.textContent = message;
    toastHost.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 220ms ease";
      setTimeout(() => el.remove(), 240);
    }, 2600);
  }

  function defaultGraph() {
    return {
      nodes: [
        { id: "a", label: "Concept A", x: -120, y: -40, lon: 103.851959, lat: 1.29027, r: 18 },
        { id: "b", label: "Concept B", x: 40, y: -10, lon: -0.1276, lat: 51.5072, r: 18 },
        { id: "c", label: "Concept C", x: 140, y: 90, lon: -74.006, lat: 40.7128, r: 18 },
        { id: "d", label: "Concept D", x: -40, y: 120, lon: 139.6917, lat: 35.6895, r: 18 },
      ],
      links: [
        { id: "l1", source: "a", target: "b", label: "" },
        { id: "l2", source: "b", target: "c", label: "" },
        { id: "l3", source: "a", target: "d", label: "" },
      ],
    };
  }

  const initialGraph = window.__KG_STANDALONE_INITIAL__ ? structuredClone(window.__KG_STANDALONE_INITIAL__) : defaultGraph();
  const graph = {
    nodes: initialGraph.nodes.map((n) => ({ ...n, r: typeof n.r === "number" ? n.r : 18 })),
    links: initialGraph.links.map((l) => ({ ...l })),
  };

  // ── Multi-user/multi-device collaboration (opt-in via ?room=<id>) ─────────
  //
  // Connects to the room's Cloudflare Durable Object (worker/canvas-room.js)
  // over WebSocket. Without a `room` query param the canvas remains local.
  // `?room=new` creates a capability-strength shareable room URL.
  const collab = {
    ws: null,
    roomId: "",
    applyingRemote: false,
    reconnectTimer: null,
    reconnectAttempts: 0,
    snapshotReady: false,
    rev: 0,
    pending: [],
  };

  function createRoomCapability() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function resolveRoomId() {
    try {
      const url = new URL(window.location.href);
      const requested = url.searchParams.get("room") || "";
      if (requested !== "new") return requested;
      const generated = createRoomCapability();
      url.searchParams.set("room", generated);
      window.history.replaceState(null, "", url);
      return generated;
    } catch {
      return "";
    }
  }

  function collabWsUrl(roomId, token) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({ room: roomId, token });
    return `${proto}//${window.location.host}/api/canvas/room?${params.toString()}`;
  }

  function createOpId() {
    if (typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `${Date.now().toString(36)}_${createRoomCapability()}`;
  }

  function flushPendingOps() {
    if (!collab.snapshotReady || !collab.ws || collab.ws.readyState !== WebSocket.OPEN) return;
    for (const entry of collab.pending) {
      if (entry.sent) continue;
      try {
        collab.ws.send(JSON.stringify(entry.op));
        entry.sent = true;
      } catch {
        entry.sent = false;
        return;
      }
    }
  }

  function sendOp(input) {
    if (collab.applyingRemote) return; // never echo a remote-originated change back
    if (collab.pending.length >= 1000) {
      toast("Collaboration paused: offline operation queue is full", "error");
      return;
    }
    const op = { ...input, opId: createOpId(), baseRev: collab.rev };
    collab.pending.push({ op, sent: false });
    flushPendingOps();
  }

  function upsertNodeFromRemote(node) {
    if (!node || !node.id) return;
    const existing = findNode(node.id);
    if (existing) Object.assign(existing, node);
    else graph.nodes.push({ ...node });
    normalizeLinks();
    sim.nodes(graph.nodes);
    sim.alpha(0.3).restart();
    render();
    updateDataBox();
  }

  function deleteNodeFromRemote(id) {
    if (!id) return;
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
    graph.links = graph.links.filter((l) => {
      const s = typeof l.source === "string" ? l.source : l.source.id;
      const t = typeof l.target === "string" ? l.target : l.target.id;
      return s !== id && t !== id;
    });
    if (state.selected && state.selected.kind === "node" && state.selected.id === id) state.selected = null;
    sim.nodes(graph.nodes);
    sim.force("link").links(graph.links);
    sim.alpha(0.4).restart();
    render();
    updateDataBox();
  }

  function upsertLinkFromRemote(link) {
    if (!link || !link.id) return;
    const idx = graph.links.findIndex((l) => l.id === link.id);
    const next = { id: link.id, source: link.source, target: link.target, label: link.label || "" };
    if (idx >= 0) graph.links[idx] = next;
    else graph.links.push(next);
    normalizeLinks();
    sim.force("link").links(graph.links);
    sim.alpha(0.35).restart();
    render();
    updateDataBox();
  }

  function deleteLinkFromRemote(id) {
    if (!id) return;
    const before = graph.links.length;
    graph.links = graph.links.filter((l) => l.id !== id);
    if (graph.links.length === before) return;
    if (state.selected && state.selected.kind === "link" && state.selected.id === id) state.selected = null;
    sim.force("link").links(graph.links);
    sim.alpha(0.3).restart();
    render();
    updateDataBox();
  }

  function replaceGraphFromRemote(payload) {
    if (!payload || !Array.isArray(payload.nodes) || !Array.isArray(payload.links)) return;
    graph.nodes = payload.nodes.map((n) => ({ ...n, r: typeof n.r === "number" ? n.r : 18 }));
    graph.links = payload.links.map((l) => ({ ...l }));
    normalizeLinks();
    sim.nodes(graph.nodes);
    sim.force("link").links(graph.links);
    sim.alpha(0.7).restart();
    clearSelection();
    render();
    updateDataBox();
    fitToContents(0);
  }

  function applyRemote(fn) {
    collab.applyingRemote = true;
    try {
      fn();
    } finally {
      collab.applyingRemote = false;
    }
  }

  function replayPendingOps() {
    applyRemote(() => {
      for (const { op } of collab.pending) {
        if (op.type === "upsertNode") upsertNodeFromRemote(op.node);
        else if (op.type === "deleteNode") deleteNodeFromRemote(op.id);
        else if (op.type === "upsertLink") upsertLinkFromRemote(op.link);
        else if (op.type === "deleteLink") deleteLinkFromRemote(op.id);
        else if (op.type === "replaceGraph") replaceGraphFromRemote(op.graph);
      }
    });
  }

  function handleCollabMessage(payload) {
    if (!payload || typeof payload !== "object") return;
    if (typeof payload.rev === "number") collab.rev = Math.max(collab.rev, payload.rev);
    if (payload.type === "snapshot") {
      applyRemote(() => replaceGraphFromRemote(payload));
      replayPendingOps();
      collab.snapshotReady = true;
      collab.reconnectAttempts = 0;
      flushPendingOps();
      return;
    }
    if (payload.type === "graphReplaced") {
      applyRemote(() => replaceGraphFromRemote(payload.graph));
      return;
    }
    if (payload.type === "nodeUpserted") {
      applyRemote(() => upsertNodeFromRemote(payload.node));
      return;
    }
    if (payload.type === "nodeDeleted") {
      applyRemote(() => deleteNodeFromRemote(payload.id));
      return;
    }
    if (payload.type === "linkUpserted") {
      applyRemote(() => upsertLinkFromRemote(payload.link));
      return;
    }
    if (payload.type === "linkDeleted") {
      applyRemote(() => deleteLinkFromRemote(payload.id));
      return;
    }
    if (payload.type === "ack" && typeof payload.opId === "string") {
      collab.pending = collab.pending.filter((entry) => entry.op.opId !== payload.opId);
      return;
    }
    if (payload.type === "error") {
      toast(`Collaboration: ${payload.error || "error"}`, "error");
    }
  }

  async function fetchCollabToken(roomId) {
    const res = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomIds: [roomId] }),
    });
    if (!res.ok) throw new Error(`session request failed (${res.status})`);
    const data = await res.json();
    if (!data || typeof data.token !== "string") throw new Error("no token in response");
    return data.token;
  }

  function scheduleReconnect(roomId) {
    clearTimeout(collab.reconnectTimer);
    if (collab.reconnectAttempts >= 8) {
      toast("Collaboration stopped after 8 reconnect attempts", "error");
      return;
    }
    const delay = Math.min(30000, 1000 * (2 ** collab.reconnectAttempts));
    collab.reconnectAttempts += 1;
    collab.reconnectTimer = setTimeout(() => connectCollab(roomId), delay);
  }

  function connectCollab(roomId) {
    collab.roomId = roomId;
    collab.snapshotReady = false;
    fetchCollabToken(roomId)
      .then((token) => {
        const ws = new WebSocket(collabWsUrl(roomId, token));
        collab.ws = ws;
        ws.addEventListener("open", () => toast("Collaboration connected", "success"));
        ws.addEventListener("message", (event) => {
          let payload = null;
          try {
            payload = typeof event.data === "string" ? JSON.parse(event.data) : null;
          } catch {
            return;
          }
          handleCollabMessage(payload);
        });
        ws.addEventListener("close", () => {
          if (collab.ws !== ws) return; // superseded by a newer connection
          collab.ws = null;
          collab.snapshotReady = false;
          for (const entry of collab.pending) entry.sent = false;
          scheduleReconnect(roomId);
        });
        ws.addEventListener("error", () => {
          // onclose follows; reconnect handled there.
        });
      })
      .catch((err) => {
        toast(`Collaboration unavailable: ${err.message || err}`, "error");
        scheduleReconnect(roomId);
      });
  }

  const gRoot = svg.append("g").attr("class", "gRoot");
  const gGeo = gRoot.append("g").attr("class", "gGeo");
  const gLinks = gRoot.append("g").attr("class", "gLinks");
  const gNodes = gRoot.append("g").attr("class", "gNodes");
  const gUi = gRoot.append("g").attr("class", "gUi");
  const tempLink = gUi.append("line").attr("class", "svgTempLink").style("display", "none");
  const geoSpherePath = gGeo.append("path").attr("class", "geoSphere").style("display", "none");
  const geoGraticulePath = gGeo.append("path").attr("class", "geoGraticule").style("display", "none");

  const zoom = d3
    .zoom()
    .scaleExtent([0.08, 8])
    .on("zoom", (event) => {
      state.zoomTransform = event.transform;
      gRoot.attr("transform", state.zoomTransform);
    });

  svg.call(zoom);

  function updateModeChip() {
    const label = state.mode === "geo" ? "Mode: Geo" : "Mode: Graph";
    modeChip.textContent = label;
    modeChip.style.color = state.mode === "geo" ? "var(--accent2)" : "var(--muted)";
  }

  function linkKey(l) {
    const s = typeof l.source === "string" ? l.source : l.source.id;
    const t = typeof l.target === "string" ? l.target : l.target.id;
    return `${s}→${t}`;
  }

  function findNode(id) {
    return graph.nodes.find((n) => n.id === id) || null;
  }

  function normalizeLinks() {
    graph.links.forEach((l) => {
      if (typeof l.source === "string") l.source = findNode(l.source) || l.source;
      if (typeof l.target === "string") l.target = findNode(l.target) || l.target;
    });
  }

  normalizeLinks();

  const sim = d3
    .forceSimulation(graph.nodes)
    .force(
      "link",
      d3
        .forceLink(graph.links)
        .id((d) => d.id)
        .distance(84)
        .strength(0.12)
    )
    .force("charge", d3.forceManyBody().strength(-320))
    .force("collide", d3.forceCollide().radius((d) => (d.r || 18) + 12).strength(0.55))
    .force("center", d3.forceCenter(0, 0))
    .alphaDecay(0.035);

  function computeGeoProjection() {
    const { w, h } = state.dims;
    const scale = Math.min(w, h) / Math.PI;
    return d3.geoEquirectangular().translate([0, 0]).center([0, 0]).scale(scale);
  }

  function updateGeoProjection() {
    state.geoProj = computeGeoProjection();
    return state.geoProj;
  }

  function getGeoProjection() {
    return state.geoProj || updateGeoProjection();
  }

  function clampLat(lat) {
    return Math.max(-85, Math.min(85, lat));
  }

  function ensureGeoFields() {
    const r = () => (Math.random() - 0.5) * 140;
    graph.nodes.forEach((n) => {
      if (typeof n.lon !== "number") n.lon = r();
      if (typeof n.lat !== "number") n.lat = clampLat((Math.random() - 0.5) * 80);
    });
  }

  function setMode(mode) {
    if (mode !== "graph" && mode !== "geo") return;
    if (state.mode === mode) return;
    state.mode = mode;
    updateModeChip();
    if (state.mode === "geo") {
      ensureGeoFields();
      sim.stop();
      const proj = updateGeoProjection();
      graph.nodes.forEach((n) => {
        const [x, y] = proj([n.lon, n.lat]);
        n.x = x;
        n.y = y;
        n.fx = x;
        n.fy = y;
      });
    } else {
      graph.nodes.forEach((n) => {
        n.fx = null;
        n.fy = null;
      });
      sim.alpha(0.7).restart();
    }
    updateGeoLayer();
    render();
    updateDataBox();
    fitToContents(0);
  }

  function updateGeoLayer() {
    const visible = state.mode === "geo";
    geoSpherePath.style("display", visible ? null : "none");
    geoGraticulePath.style("display", visible ? null : "none");
    if (!visible) return;
    const proj = getGeoProjection();
    const path = d3.geoPath(proj);
    const graticule = d3.geoGraticule().step([15, 15]);
    geoSpherePath.attr("d", path({ type: "Sphere" }));
    geoGraticulePath.attr("d", path(graticule()));
  }

  function select(sel) {
    state.selected = sel;
    render();
  }

  function clearSelection() {
    if (!state.selected) return;
    state.selected = null;
    render();
  }

  function isSelectedNode(node) {
    return state.selected && state.selected.kind === "node" && state.selected.id === node.id;
  }

  function isSelectedLink(link) {
    return state.selected && state.selected.kind === "link" && state.selected.id === link.id;
  }

  function render() {
    const linksSel = gLinks.selectAll("line").data(graph.links, (d) => d.id);
    linksSel.exit().remove();
    const linksEnter = linksSel.enter().append("line").attr("class", "svgLink");
    linksEnter
      .on("pointerdown", (event, d) => {
        event.stopPropagation();
        select({ kind: "link", id: d.id });
      })
      .on("dblclick", (event) => {
        event.stopPropagation();
      });
    const linksAll = linksEnter.merge(linksSel);
    linksAll.classed("svgLink--selected", (d) => isSelectedLink(d));

    const nodesSel = gNodes.selectAll("g").data(graph.nodes, (d) => d.id);
    nodesSel.exit().remove();
    const nodesEnter = nodesSel
      .enter()
      .append("g")
      .attr("class", "svgNode")
      .on("pointerenter", (event, d) => {
        state.hoveredNodeId = d.id;
      })
      .on("pointerleave", () => {
        state.hoveredNodeId = null;
      })
      .on("pointerdown", (event, d) => {
        if (event.shiftKey) {
          event.stopPropagation();
          startLinking(d, event);
          return;
        }
        event.stopPropagation();
        select({ kind: "node", id: d.id });
      })
      .on("dblclick", (event, d) => {
        event.stopPropagation();
        beginEditLabel(d);
      });

    nodesEnter.append("circle").attr("r", (d) => d.r || 18);
    nodesEnter.append("text").attr("text-anchor", "middle").attr("dy", 4);

    const nodesAll = nodesEnter.merge(nodesSel);
    nodesAll.classed("svgNode--selected", (d) => isSelectedNode(d));

    nodesAll
      .select("text")
      .text((d) => d.label || d.id)
      .attr("y", (d) => (d.r || 18) + 14);

    nodesEnter.call(getNodeDrag());
    ticked();
  }

  let nodeDrag = null;
  function getNodeDrag() {
    if (nodeDrag) return nodeDrag;
    nodeDrag = d3
      .drag()
      .on("start", (event, d) => {
        event.sourceEvent?.stopPropagation?.();
        if (state.mode === "graph") {
          if (!event.active) sim.alphaTarget(0.15).restart();
          d.fx = d.x;
          d.fy = d.y;
        }
      })
      .on("drag", (event, d) => {
        if (state.mode === "graph") {
          d.fx = event.x;
          d.fy = event.y;
        } else {
          const proj = getGeoProjection();
          const [lon, lat] = proj.invert([event.x, event.y]) || [d.lon, d.lat];
          d.lon = lon;
          d.lat = clampLat(lat);
          const [x, y] = proj([d.lon, d.lat]);
          d.x = x;
          d.y = y;
          d.fx = x;
          d.fy = y;
        }
        ticked();
      })
      .on("end", (event, d) => {
        if (state.mode === "graph") {
          if (!event.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        } else {
          d.fx = d.x;
          d.fy = d.y;
        }
        updateDataBox();
        sendOp({ type: "upsertNode", node: { id: d.id, label: d.label, x: d.x, y: d.y, lon: d.lon, lat: d.lat, r: d.r } });
      });
    return nodeDrag;
  }

  function ticked() {
    gLinks
      .selectAll("line")
      .attr("x1", (d) => (typeof d.source === "string" ? findNode(d.source)?.x : d.source.x) || 0)
      .attr("y1", (d) => (typeof d.source === "string" ? findNode(d.source)?.y : d.source.y) || 0)
      .attr("x2", (d) => (typeof d.target === "string" ? findNode(d.target)?.x : d.target.x) || 0)
      .attr("y2", (d) => (typeof d.target === "string" ? findNode(d.target)?.y : d.target.y) || 0);

    gNodes.selectAll("g").attr("transform", (d) => `translate(${d.x || 0},${d.y || 0})`);
  }

  sim.on("tick", ticked);
  sim.on("end", updateDataBox);

  function viewportCenterWorld() {
    const { w, h } = state.dims;
    const p = state.zoomTransform.invert([w / 2, h / 2]);
    return { x: p[0], y: p[1] };
  }

  function addNodeAt(x, y) {
    const id = `n_${nowId().slice(0, 8)}`;
    const node = { id, label: "New Node", x, y, r: 18 };
    if (state.mode === "geo") {
      ensureGeoFields();
      const proj = getGeoProjection();
      const inv = proj.invert([x, y]) || [0, 0];
      node.lon = inv[0];
      node.lat = clampLat(inv[1]);
      node.fx = x;
      node.fy = y;
    }
    graph.nodes.push(node);
    sim.nodes(graph.nodes);
    sim.alpha(0.6).restart();
    render();
    select({ kind: "node", id: node.id });
    updateDataBox();
    sendOp({ type: "upsertNode", node: { id: node.id, label: node.label, x: node.x, y: node.y, lon: node.lon, lat: node.lat, r: node.r } });
  }

  function addLink(sourceId, targetId) {
    const exists = graph.links.some((l) => {
      const s = typeof l.source === "string" ? l.source : l.source.id;
      const t = typeof l.target === "string" ? l.target : l.target.id;
      return s === sourceId && t === targetId;
    });
    if (exists) {
      toast("Link already exists", "error");
      return;
    }
    const link = { id: `l_${nowId().slice(0, 8)}`, source: sourceId, target: targetId, label: "" };
    graph.links.push(link);
    normalizeLinks();
    sim.force("link").links(graph.links);
    sim.alpha(0.55).restart();
    render();
    select({ kind: "link", id: link.id });
    updateDataBox();
    sendOp({ type: "upsertLink", link: { id: link.id, source: sourceId, target: targetId, label: "" } });
  }

  function deleteSelection() {
    if (!state.selected) return;
    if (state.selected.kind === "node") {
      const nodeId = state.selected.id;
      const beforeN = graph.nodes.length;
      graph.nodes = graph.nodes.filter((n) => n.id !== nodeId);
      graph.links = graph.links.filter((l) => {
        const s = typeof l.source === "string" ? l.source : l.source.id;
        const t = typeof l.target === "string" ? l.target : l.target.id;
        return s !== nodeId && t !== nodeId;
      });
      if (graph.nodes.length !== beforeN) toast("Node deleted", "success");
      state.selected = null;
      sim.nodes(graph.nodes);
      sim.force("link").links(graph.links);
      sim.alpha(0.65).restart();
      render();
      updateDataBox();
      sendOp({ type: "deleteNode", id: nodeId });
      return;
    }
    if (state.selected.kind === "link") {
      const linkId = state.selected.id;
      const beforeL = graph.links.length;
      graph.links = graph.links.filter((l) => l.id !== linkId);
      if (graph.links.length !== beforeL) toast("Link deleted", "success");
      state.selected = null;
      sim.force("link").links(graph.links);
      sim.alpha(0.55).restart();
      render();
      updateDataBox();
      sendOp({ type: "deleteLink", id: linkId });
    }
  }

  function startLinking(node, event) {
    state.linking = { sourceId: node.id };
    tempLink.style("display", null);
    tempLink.attr("x1", node.x || 0).attr("y1", node.y || 0);
    const [mx, my] = d3.pointer(event, gRoot.node());
    tempLink.attr("x2", mx).attr("y2", my);
    svg.on("pointermove.linking", (ev) => {
      const [x, y] = d3.pointer(ev, gRoot.node());
      tempLink.attr("x2", x).attr("y2", y);
    });
    window.addEventListener(
      "pointerup",
      () => {
        finishLinking();
      },
      { once: true, capture: true }
    );
  }

  function finishLinking() {
    svg.on("pointermove.linking", null);
    tempLink.style("display", "none");
    const src = state.linking?.sourceId || null;
    const dst = state.hoveredNodeId;
    state.linking = null;
    if (!src || !dst || src === dst) return;
    addLink(src, dst);
  }

  let labelEditor = null;

  function beginEditLabel(node) {
    if (labelEditor) labelEditor.remove();
    const input = document.createElement("input");
    input.type = "text";
    input.value = node.label || "";
    input.className = "dataBox";
    input.style.position = "fixed";
    input.style.height = "34px";
    input.style.resize = "none";
    input.style.zIndex = "100";
    input.style.padding = "6px 10px";
    input.style.fontSize = "13px";

    const svgRect = svg.node().getBoundingClientRect();
    const p = state.zoomTransform.apply([node.x || 0, (node.y || 0) + (node.r || 18) + 18]);
    input.style.left = `${svgRect.left + p[0] - 140}px`;
    input.style.top = `${svgRect.top + p[1] - 18}px`;
    input.style.width = "280px";

    document.body.appendChild(input);
    labelEditor = input;
    gNodes.selectAll("g").classed("svgNode--editing", (d) => d.id === node.id);

    const commit = () => {
      node.label = input.value.trim() || node.id;
      gNodes.selectAll("g").classed("svgNode--editing", false);
      input.remove();
      labelEditor = null;
      render();
      updateDataBox();
      sendOp({ type: "upsertNode", node: { id: node.id, label: node.label, x: node.x, y: node.y, lon: node.lon, lat: node.lat, r: node.r } });
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") {
        gNodes.selectAll("g").classed("svgNode--editing", false);
        input.remove();
        labelEditor = null;
        render();
      }
    });
    input.addEventListener("blur", commit);
    input.focus();
    input.select();
  }

  function fitToContents(durationMs = 260) {
    const { w, h } = state.dims;
    if (!graph.nodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    graph.nodes.forEach((n) => {
      const r = (n.r || 18) + 26;
      const x = n.x || 0;
      const y = n.y || 0;
      minX = Math.min(minX, x - r);
      minY = Math.min(minY, y - r);
      maxX = Math.max(maxX, x + r);
      maxY = Math.max(maxY, y + r);
    });
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const padding = 28;
    const scale = Math.min((w - padding * 2) / contentW, (h - padding * 2) / contentH, 2.4);
    const tx = w / 2 - scale * (minX + contentW / 2);
    const ty = h / 2 - scale * (minY + contentH / 2);
    const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
    svg
      .transition()
      .duration(durationMs)
      .call(zoom.transform, t)
      .on("end", () => {
        state.zoomTransform = t;
      });
  }

  function updateDataBox() {
    if (!dataBox) return;
    const out = {
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        x: Math.round((n.x || 0) * 10) / 10,
        y: Math.round((n.y || 0) * 10) / 10,
        lon: typeof n.lon === "number" ? Math.round(n.lon * 1e6) / 1e6 : undefined,
        lat: typeof n.lat === "number" ? Math.round(n.lat * 1e6) / 1e6 : undefined,
        r: n.r || 18,
      })),
      links: graph.links.map((l) => ({
        id: l.id,
        source: typeof l.source === "string" ? l.source : l.source.id,
        target: typeof l.target === "string" ? l.target : l.target.id,
        label: l.label || "",
      })),
    };
    dataBox.value = JSON.stringify(out, null, 2);
  }

  function applyDataJson(text) {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.links)) throw new Error("Expected { nodes: [], links: [] }");
    const newNodes = parsed.nodes
      .map((n) => ({
        id: String(n.id),
        label: typeof n.label === "string" ? n.label : String(n.id),
        x: typeof n.x === "number" ? n.x : (Math.random() - 0.5) * 200,
        y: typeof n.y === "number" ? n.y : (Math.random() - 0.5) * 200,
        lon: typeof n.lon === "number" ? n.lon : undefined,
        lat: typeof n.lat === "number" ? clampLat(n.lat) : undefined,
        r: typeof n.r === "number" ? n.r : 18,
      }))
      .filter((n) => n.id);
    const nodeSet = new Set(newNodes.map((n) => n.id));
    const newLinks = parsed.links
      .map((l) => ({
        id: l.id ? String(l.id) : `l_${nowId().slice(0, 8)}`,
        source: String(l.source),
        target: String(l.target),
        label: typeof l.label === "string" ? l.label : "",
      }))
      .filter((l) => nodeSet.has(l.source) && nodeSet.has(l.target));

    graph.nodes = newNodes;
    graph.links = newLinks;
    normalizeLinks();

    sim.nodes(graph.nodes);
    sim.force("link").links(graph.links);
    sim.alpha(0.8).restart();
    clearSelection();
    render();
    updateDataBox();
    fitToContents(0);
    sendOp({
      type: "replaceGraph",
      graph: {
        nodes: graph.nodes.map((n) => ({ id: n.id, label: n.label, x: n.x, y: n.y, lon: n.lon, lat: n.lat, r: n.r })),
        links: graph.links.map((l) => ({
          id: l.id,
          source: typeof l.source === "string" ? l.source : l.source.id,
          target: typeof l.target === "string" ? l.target : l.target.id,
          label: l.label || "",
        })),
      },
    });
  }

  async function exportStandaloneHtml() {
    const fileName = `knowledge-graph-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.html`;
    const graphJson = JSON.stringify(
      {
        nodes: graph.nodes.map((n) => ({
          id: n.id,
          label: n.label,
          x: n.x,
          y: n.y,
          lon: n.lon,
          lat: n.lat,
          r: n.r,
        })),
        links: graph.links.map((l) => ({
          id: l.id,
          source: typeof l.source === "string" ? l.source : l.source.id,
          target: typeof l.target === "string" ? l.target : l.target.id,
          label: l.label || "",
        })),
      },
      null,
      0
    );

    let cssText = "";
    let jsText = "";

    try {
      const [cssResp, jsResp] = await Promise.all([fetch("./styles.css"), fetch("./app.js")]);
      cssText = await cssResp.text();
      jsText = await jsResp.text();
    } catch {
      cssText = document.querySelector("style[data-kg-style]")?.textContent || "";
      jsText = document.querySelector("script[data-kg-app]")?.textContent || "";
    }

    if (!cssText || !jsText) {
      toast("Export failed: could not capture assets", "error");
      return;
    }

    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Knowledge Graph (Exported)</title>
    <style data-kg-style>${cssText.replaceAll("</style>", "<\\/style>")}</style>
  </head>
  <body>
    <header class="topbar">
      <div class="topbar__left">
        <div class="brand">Knowledge Graph</div>
        <div class="chip" id="modeChip" title="Graph mode / Geospatial mode">Mode: Graph</div>
      </div>
      <div class="topbar__right">
        <button class="btn" id="btnNewNode" title="Add a node (N)">New Node</button>
        <button class="btn" id="btnGeoMode" title="Toggle geospatial mode (G)">Geo</button>
        <button class="btn" id="btnFit" title="Fit to contents (F)">Fit</button>
        <button class="btn" id="btnExport" title="Export">Export</button>
      </div>
    </header>
    <main class="main">
      <section class="canvas" aria-label="Graph canvas">
        <svg id="svgRoot" class="svgRoot" role="img" aria-label="Interactive knowledge graph"></svg>
      </section>
      <aside class="side">
        <div class="panel">
          <div class="panel__title">Editor</div>
          <div class="panel__body">
            <div class="row"><div class="k">Create</div><div class="v">Double-click empty space or press N</div></div>
            <div class="row"><div class="k">Connect</div><div class="v">Shift+Drag from a node to another node</div></div>
            <div class="row"><div class="k">Label</div><div class="v">Double-click a node label to edit</div></div>
            <div class="row"><div class="k">Delete</div><div class="v">Select node/link then press Delete/Backspace</div></div>
            <div class="row"><div class="k">Pan/Zoom</div><div class="v">Drag background / mouse wheel / trackpad</div></div>
            <div class="row"><div class="k">Select</div><div class="v">Click node/link (Esc clears)</div></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel__title">Data</div>
          <div class="panel__body">
            <textarea id="dataBox" class="dataBox" spellcheck="false"></textarea>
            <div class="sideActions">
              <button class="btn btn--secondary" id="btnApplyData" title="Apply JSON to graph">Apply JSON</button>
              <button class="btn btn--secondary" id="btnCopyData" title="Copy JSON">Copy JSON</button>
            </div>
          </div>
        </div>
      </aside>
    </main>
    <div id="toastHost" class="toastHost" aria-live="polite"></div>
    <script>
      window.__KG_STANDALONE_INITIAL__ = ${graphJson};
    </script>
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script data-kg-app>${jsText.replaceAll("</script>", "<\\/script>")}</script>
  </body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Exported ${fileName}`, "success");
  }

  function onBackgroundPointerDown(event) {
    if (event.target !== svg.node()) return;
    clearSelection();
  }

  function onBackgroundDblClick(event) {
    if (event.target !== svg.node()) return;
    const [x, y] = d3.pointer(event, gRoot.node());
    addNodeAt(x, y);
    toast("Node created", "success");
  }

  svg.on("pointerdown", onBackgroundPointerDown);
  svg.on("dblclick", onBackgroundDblClick);

  btnNewNode?.addEventListener("click", () => {
    const c = viewportCenterWorld();
    addNodeAt(c.x, c.y);
  });
  btnGeoMode?.addEventListener("click", () => setMode(state.mode === "geo" ? "graph" : "geo"));
  btnFit?.addEventListener("click", () => fitToContents(260));
  btnExport?.addEventListener("click", () => toggleExportMenu());

  btnApplyData?.addEventListener("click", () => {
    try {
      applyDataJson(dataBox.value);
      toast("Applied JSON", "success");
    } catch (e) {
      toast(`Invalid JSON: ${e.message || e}`, "error");
    }
  });

  btnCopyData?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(dataBox.value);
      toast("Copied JSON", "success");
    } catch {
      toast("Copy failed", "error");
    }
  });

  window.addEventListener("keydown", (e) => {
    if (labelEditor) return;
    if (e.key === "Escape" && exportMenu && !exportMenu.hidden) {
      hideExportMenu();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && state.selected) {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === "Escape") {
      clearSelection();
      return;
    }
    if (e.key.toLowerCase() === "g") {
      setMode(state.mode === "geo" ? "graph" : "geo");
      return;
    }
    if (e.key.toLowerCase() === "f") {
      fitToContents(260);
      return;
    }
    if (e.key.toLowerCase() === "n") {
      const c = viewportCenterWorld();
      addNodeAt(c.x, c.y);
    }
  });

  function updateDims() {
    const rect = svg.node().getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    state.dims = { w, h };
    svg.attr("viewBox", `${-w / 2} ${-h / 2} ${w} ${h}`);
  }

  exportMenu = document.createElement("div");
  exportMenu.className = "exportMenu";
  exportMenu.hidden = true;
  const exportItemHtml = document.createElement("button");
  exportItemHtml.type = "button";
  exportItemHtml.className = "exportMenuItem";
  exportItemHtml.textContent = "HTML (.html)";
  exportItemHtml.addEventListener("click", () => {
    hideExportMenu();
    exportStandaloneHtml();
  });
  exportMenu.appendChild(exportItemHtml);
  document.body.appendChild(exportMenu);

  function positionExportMenu() {
    if (!btnExport) return;
    const r = btnExport.getBoundingClientRect();
    const margin = 10;
    const top = Math.min(window.innerHeight - margin, r.bottom + 8);
    const mw = exportMenu.offsetWidth || 180;
    let left = r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - mw - margin));
    exportMenu.style.left = `${left}px`;
    exportMenu.style.top = `${top}px`;
  }

  function showExportMenu() {
    if (!btnExport) return;
    exportMenu.hidden = false;
    exportMenu.style.visibility = "hidden";
    requestAnimationFrame(() => {
      positionExportMenu();
      exportMenu.style.visibility = "";
    });
    window.addEventListener(
      "pointerdown",
      (e) => {
        const t = e.target;
        if (exportMenu.contains(t) || btnExport.contains(t)) return;
        hideExportMenu();
      },
      { capture: true, once: true }
    );
  }

  function hideExportMenu() {
    exportMenu.hidden = true;
  }

  function toggleExportMenu() {
    if (exportMenu.hidden) showExportMenu();
    else hideExportMenu();
  }

  const ro = new ResizeObserver(() => {
    updateDims();
    if (state.mode === "geo") {
      const proj = updateGeoProjection();
      graph.nodes.forEach((n) => {
        if (typeof n.lon !== "number" || typeof n.lat !== "number") return;
        const [x, y] = proj([n.lon, n.lat]);
        n.x = x;
        n.y = y;
        n.fx = x;
        n.fy = y;
      });
      updateGeoLayer();
      render();
      updateDataBox();
    }
    if (!exportMenu.hidden) positionExportMenu();
  });
  ro.observe(svg.node());

  updateDims();
  updateGeoProjection();
  updateModeChip();
  updateGeoLayer();
  render();
  updateDataBox();
  fitToContents(0);

  const roomId = resolveRoomId();
  if (roomId) connectCollab(roomId);
})();
