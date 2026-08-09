export function projectRootState(value) {
  const state = String(value || "").replaceAll("-", "_");
  return ({
    current: "active", active: "active",
    waiting_successor: "waiting-successor",
    reviewed: "review_ready", review_ready: "review_ready",
    integrated_preserved: "delivery_authorized", delivery_authorized: "delivery_authorized",
    dormant_preserved: "parked", parked: "parked",
    retired: "released", released: "released",
  })[state] || state;
}

export function rootStateForProjection(value) {
  const state = String(value || "").replaceAll("-", "_");
  return ({
    active: "current",
    waiting_successor: "waiting-successor",
    review_ready: "reviewed",
    delivery_authorized: "integrated-preserved",
    parked: "dormant-preserved",
    released: "retired",
  })[state] || value;
}
