# Design

The successor-bound phase classifies the sole live successor as either its exact promoted `current`
state or its exact transition-counter-plus-one `active` response-loss state. The first path performs
the ordinary review-request-bound projection without a pull-request-number base assertion. The
second reconstructs and verifies the bound authority from live inventory before advancing the
existing durable journal. Both paths converge on the unchanged local CAS and marker phases.
