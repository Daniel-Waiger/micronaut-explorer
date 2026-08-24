# Continue navigation same-step recovery

The footer's map-aware Continue action used any valid `nextDecision` route as
authoritative. A decision owned by the currently displayed step therefore
navigated to the exact same route and appeared broken. Preserve map routing
only when it takes the user to another workflow route; otherwise use the next
primary step as a normal Continue action would.

Verification must cover both branches, plus the built artifact and full test
suite. An unavailable higher-tier verifier is replaced by the project's fixed
local adversarial loop, recorded on the CMA dashboard.
